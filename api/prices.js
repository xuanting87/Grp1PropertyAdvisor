/**
 * api/prices.js
 * Serverless function for Singapore Property Price Advisor.
 * Queries the official Singapore Government Datastore (data.gov.sg)
 * for real, un-fabricated HDB resale transactions.
 * 
 * Target environment: Vercel serverless / Express server.
 * Returns statistical price ranges (p25, median, p75, PSF) and individual comparable transactions.
 * Guardrail: Flags if sample size < 5 rather than averaging tiny samples.
 */

// Singapore HDB Resale Data Resource ID on data.gov.sg (Official open dataset)
const DATA_GOV_SG_HDB_RESOURCE_ID = 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc';

/**
 * Parses remaining lease string like "61 years 04 months" into decimal years.
 * @param {string} leaseStr 
 * @returns {number} Decimal years (e.g. 61.33)
 */
function parseLeaseToYears(leaseStr) {
  if (!leaseStr) return null;
  const match = leaseStr.match(/(\d+)\s*years?(?:\s*(\d+)\s*months?)?/i);
  if (!match) {
    const numOnly = parseInt(leaseStr, 10);
    return isNaN(numOnly) ? null : numOnly;
  }
  const years = parseInt(match[1], 10) || 0;
  const months = parseInt(match[2], 10) || 0;
  return Number((years + (months / 12)).toFixed(1));
}

/**
 * Calculates a given percentile value from an already-sorted array of numbers.
 * @param {number[]} sortedValues - Ascending sorted numerical array
 * @param {number} p - Percentile between 0 and 1 (e.g. 0.25, 0.50, 0.75)
 * @returns {number}
 */
function calculatePercentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index % 1;

  if (lower === upper) return sortedValues[lower];
  return Math.round(sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight);
}

/**
 * Main handler function for /api/prices
 */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const propertyType = (req.query?.propertyType || 'hdb').toLowerCase();
  const town = (req.query?.town || 'ANG MO KIO').trim().toUpperCase();
  const flatType = (req.query?.flatType || '4 ROOM').trim().toUpperCase();
  const leaseMin = req.query?.leaseMin ? parseFloat(req.query.leaseMin) : null;
  const leaseMax = req.query?.leaseMax ? parseFloat(req.query.leaseMax) : null;
  const minArea = req.query?.minArea ? parseFloat(req.query.minArea) : null;
  const maxArea = req.query?.maxArea ? parseFloat(req.query.maxArea) : null;
  const street = req.query?.street ? req.query.street.trim().toUpperCase() : null;
  const windowMonths = parseInt(req.query?.windowMonths, 10) || 12;

  // Handle Private Property requests
  if (propertyType === 'private') {
    const uraKey = process.env.URA_ACCESS_KEY;
    if (!uraKey) {
      return res.status(200).json({
        success: false,
        dataAvailable: false,
        error: 'Private property transactions require an active URA API key (set in server environment as URA_ACCESS_KEY). Live HDB resale transactions from data.gov.sg are available keyless.',
        disclaimer: 'Indicative only. Not a substitute for a CEA-licensed property agent, lawyer, or your bank.'
      });
    }
  }

  try {
    // Construct data.gov.sg datastore search query
    const filterObj = {
      town: town
    };
    if (flatType && flatType !== 'ALL') {
      filterObj.flat_type = flatType;
    }

    const encodedFilters = encodeURIComponent(JSON.stringify(filterObj));
    const datastoreUrl = `https://data.gov.sg/api/action/datastore_search?resource_id=${DATA_GOV_SG_HDB_RESOURCE_ID}&filters=${encodedFilters}&sort=month%20desc&limit=1000`;

    const response = await fetch(datastoreUrl, {
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      throw new Error(`Data.gov.sg returned HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data.success || !data.result || !data.result.records) {
      throw new Error('Invalid response structure from Singapore Government Datastore');
    }

    const allRecords = data.result.records;

    // Determine current month boundary based on dataset's newest month
    // so calculations reflect recent months from the latest recorded transaction
    const latestMonthStr = allRecords.length > 0 ? allRecords[0].month : '2026-09';
    const [latestYear, latestM] = latestMonthStr.split('-').map(Number);
    const cutoffDate = new Date(latestYear, latestM - 1 - windowMonths, 1);

    // Filter and normalize records
    const filteredComparables = [];
    for (const record of allRecords) {
      const price = parseFloat(record.resale_price);
      const floorAreaSqm = parseFloat(record.floor_area_sqm);
      if (isNaN(price) || isNaN(floorAreaSqm) || price <= 0 || floorAreaSqm <= 0) continue;

      // Filter by recency window
      const [rYear, rM] = record.month.split('-').map(Number);
      const recordDate = new Date(rYear, rM - 1, 1);
      if (recordDate < cutoffDate) continue;

      // Filter by remaining lease if requested
      const leaseYears = parseLeaseToYears(record.remaining_lease);
      if (leaseMin !== null && leaseYears !== null && leaseYears < leaseMin) continue;
      if (leaseMax !== null && leaseYears !== null && leaseYears > leaseMax) continue;

      // Filter by floor area if requested
      if (minArea !== null && floorAreaSqm < minArea) continue;
      if (maxArea !== null && floorAreaSqm > maxArea) continue;

      // Optional hyper-local street filter
      if (street && !record.street_name.toUpperCase().includes(street)) continue;

      const floorAreaSqft = Math.round(floorAreaSqm * 10.7639);
      const psf = Math.round(price / floorAreaSqft);

      filteredComparables.push({
        id: record._id,
        month: record.month,
        town: record.town,
        flatType: record.flat_type,
        block: record.block,
        streetName: record.street_name,
        storeyRange: record.storey_range,
        floorAreaSqm: floorAreaSqm,
        floorAreaSqft: floorAreaSqft,
        flatModel: record.flat_model,
        leaseCommenceDate: record.lease_commence_date,
        remainingLease: record.remaining_lease,
        remainingLeaseYears: leaseYears,
        resalePrice: price,
        psf: psf
      });
    }

    const sampleSize = filteredComparables.length;
    const hasSufficientData = sampleSize >= 5;

    // If insufficient data (< 5 transactions), do not fabricate or average a tiny sample
    if (!hasSufficientData) {
      return res.status(200).json({
        success: true,
        town: town,
        flatType: flatType,
        windowMonths: windowMonths,
        sampleSize: sampleSize,
        hasSufficientData: false,
        warningMessage: sampleSize === 0 
          ? `No comparable transactions found for ${flatType} in ${town} in the past ${windowMonths} months with the chosen filters.`
          : `Only ${sampleSize} comparable transaction(s) found in ${town} for ${flatType} in the past ${windowMonths} months. Because a reliable statistical range requires at least 5 transactions, an indicative estimate cannot be reliably determined. You can broaden the recency window or adjust lease filters to view more data.`,
        comparables: filteredComparables,
        disclaimer: 'Indicative only. Not a substitute for a CEA-licensed property agent, lawyer, or your bank.'
      });
    }

    // Sort prices ascending to compute quartiles
    const sortedPrices = filteredComparables.map(c => c.resalePrice).sort((a, b) => a - b);
    const sortedPsfs = filteredComparables.map(c => c.psf).sort((a, b) => a - b);
    const sortedAreas = filteredComparables.map(c => c.floorAreaSqm).sort((a, b) => a - b);

    const p25 = calculatePercentile(sortedPrices, 0.25);
    const median = calculatePercentile(sortedPrices, 0.50);
    const p75 = calculatePercentile(sortedPrices, 0.75);
    const minPrice = sortedPrices[0];
    const maxPrice = sortedPrices[sortedPrices.length - 1];

    const medianPsf = calculatePercentile(sortedPsfs, 0.50);
    const medianAreaSqm = calculatePercentile(sortedAreas, 0.50);
    const medianAreaSqft = Math.round(medianAreaSqm * 10.7639);

    const sumPrice = sortedPrices.reduce((acc, p) => acc + p, 0);
    const avgPrice = Math.round(sumPrice / sortedPrices.length);

    const sumPsf = sortedPsfs.reduce((acc, p) => acc + p, 0);
    const avgPsf = Math.round(sumPsf / sortedPsfs.length);

    return res.status(200).json({
      success: true,
      town: town,
      flatType: flatType,
      windowMonths: windowMonths,
      sampleSize: sampleSize,
      hasSufficientData: true,
      priceRange: {
        low: p25,
        median: median,
        high: p75,
        min: minPrice,
        max: maxPrice,
        average: avgPrice,
        spreadIqr: p75 - p25
      },
      psfMetrics: {
        medianPsf: medianPsf,
        averagePsf: avgPsf,
        minPsf: sortedPsfs[0],
        maxPsf: sortedPsfs[sortedPsfs.length - 1]
      },
      areaMetrics: {
        medianAreaSqm: medianAreaSqm,
        medianAreaSqft: medianAreaSqft
      },
      latestTransactionMonth: latestMonthStr,
      comparables: filteredComparables.slice(0, 30), // Latest 30 detailed comparables
      disclaimer: 'Indicative only. Not a substitute for a CEA-licensed property agent, lawyer, or your bank.'
    });

  } catch (error) {
    console.error('Prices API error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve transaction data from Singapore Government Datastore.',
      details: error.message,
      disclaimer: 'Indicative only. Not a substitute for a CEA-licensed property agent, lawyer, or your bank.'
    });
  }
}
