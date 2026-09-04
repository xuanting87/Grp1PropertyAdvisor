/**
 * api/trends.js
 * Serverless function for Singapore Property Price Trends & Multi-Town Comparison.
 * Aggregates live transaction data from data.gov.sg over past 3M, 6M, and 12M.
 * 
 * Supports:
 * 1. Single-town monthly timeline trends (median price, PSF, volume, % change)
 * 2. Side-by-side comparison for 2–4 towns/planning areas
 */

const DATA_GOV_SG_HDB_RESOURCE_ID = 'd_8b84c4ee58e3cfc0ece0d773c8ca6abc';

/**
 * Calculates a given percentile value from an already-sorted array of numbers.
 * @param {number[]} sortedValues 
 * @param {number} p 
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
 * Fetches transactions for a specific town and flat type from data.gov.sg.
 * @param {string} town 
 * @param {string} flatType 
 * @returns {Promise<Array>}
 */
async function fetchTownRecords(town, flatType) {
  const filterObj = { town: town.toUpperCase() };
  if (flatType && flatType !== 'ALL') {
    filterObj.flat_type = flatType.toUpperCase();
  }

  const encodedFilters = encodeURIComponent(JSON.stringify(filterObj));
  const url = `https://data.gov.sg/api/action/datastore_search?resource_id=${DATA_GOV_SG_HDB_RESOURCE_ID}&filters=${encodedFilters}&sort=month%20desc&limit=1000`;

  const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) {
    throw new Error(`data.gov.sg returned HTTP ${response.status} for ${town}`);
  }

  const data = await response.json();
  return data?.result?.records || [];
}

/**
 * Main handler function for /api/trends
 */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const flatType = (req.query?.flatType || '4 ROOM').trim().toUpperCase();
  const townsParam = req.query?.towns || req.query?.town || 'ANG MO KIO';
  const towns = townsParam.split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
  const windowMonths = parseInt(req.query?.windowMonths, 10) || 12;

  try {
    // Determine whether this is a multi-town comparison or single-town timeline
    const isComparison = towns.length > 1;

    if (isComparison) {
      // 2 to 4 Towns Side-by-Side Comparison
      const comparisonResults = [];

      for (const town of towns.slice(0, 4)) {
        try {
          const records = await fetchTownRecords(town, flatType);
          
          // Filter records by windowMonths
          const latestMonthStr = records.length > 0 ? records[0].month : '2026-09';
          const [latestYear, latestM] = latestMonthStr.split('-').map(Number);
          const cutoffDate = new Date(latestYear, latestM - 1 - windowMonths, 1);

          const validPrices = [];
          const validPsfs = [];

          for (const r of records) {
            const price = parseFloat(r.resale_price);
            const sqm = parseFloat(r.floor_area_sqm);
            if (isNaN(price) || isNaN(sqm) || price <= 0 || sqm <= 0) continue;

            const [rY, rM] = r.month.split('-').map(Number);
            if (new Date(rY, rM - 1, 1) < cutoffDate) continue;

            const sqft = sqm * 10.7639;
            const psf = Math.round(price / sqft);

            validPrices.push(price);
            validPsfs.push(psf);
          }

          validPrices.sort((a, b) => a - b);
          validPsfs.sort((a, b) => a - b);

          const sampleSize = validPrices.length;
          const hasSufficientData = sampleSize >= 5;

          if (!hasSufficientData) {
            comparisonResults.push({
              town,
              flatType,
              hasSufficientData: false,
              sampleSize,
              warningMessage: sampleSize === 0 
                ? 'No transactions found in this period.' 
                : `Only ${sampleSize} transactions found (minimum 5 required for statistical reliability).`
            });
          } else {
            const medianPrice = calculatePercentile(validPrices, 0.50);
            const p25 = calculatePercentile(validPrices, 0.25);
            const p75 = calculatePercentile(validPrices, 0.75);
            const medianPsf = calculatePercentile(validPsfs, 0.50);
            const avgPrice = Math.round(validPrices.reduce((a, b) => a + b, 0) / sampleSize);
            const avgPsf = Math.round(validPsfs.reduce((a, b) => a + b, 0) / sampleSize);

            comparisonResults.push({
              town,
              flatType,
              hasSufficientData: true,
              sampleSize,
              medianPrice,
              p25Price: p25,
              p75Price: p75,
              minPrice: validPrices[0],
              maxPrice: validPrices[validPrices.length - 1],
              averagePrice: avgPrice,
              medianPsf,
              averagePsf: avgPsf,
              minPsf: validPsfs[0],
              maxPsf: validPsfs[validPsfs.length - 1]
            });
          }
        } catch (err) {
          console.error(`Error processing town ${town}:`, err);
          comparisonResults.push({
            town,
            flatType,
            hasSufficientData: false,
            sampleSize: 0,
            error: err.message
          });
        }
      }

      return res.status(200).json({
        success: true,
        type: 'comparison',
        flatType,
        windowMonths,
        results: comparisonResults,
        disclaimer: 'Indicative only. Not a substitute for a CEA-licensed property agent, lawyer, or your bank.'
      });

    } else {
      // Single Town Timeline Trend
      const town = towns[0];
      const records = await fetchTownRecords(town, flatType);

      if (records.length === 0) {
        return res.status(200).json({
          success: true,
          type: 'timeline',
          town,
          flatType,
          hasSufficientData: false,
          timeline: [],
          warningMessage: `No transaction records found for ${flatType} in ${town}.`,
          disclaimer: 'Indicative only. Not a substitute for a CEA-licensed property agent, lawyer, or your bank.'
        });
      }

      // Group by month
      const monthlyGroups = {};
      for (const r of records) {
        const price = parseFloat(r.resale_price);
        const sqm = parseFloat(r.floor_area_sqm);
        if (isNaN(price) || isNaN(sqm) || price <= 0 || sqm <= 0) continue;

        const m = r.month;
        if (!monthlyGroups[m]) {
          monthlyGroups[m] = {
            prices: [],
            psfs: [],
            count: 0
          };
        }

        const sqft = sqm * 10.7639;
        const psf = Math.round(price / sqft);

        monthlyGroups[m].prices.push(price);
        monthlyGroups[m].psfs.push(psf);
        monthlyGroups[m].count++;
      }

      // Sort all months chronological
      const sortedMonths = Object.keys(monthlyGroups).sort();
      
      // Limit to past 15 months of data
      const recentMonths = sortedMonths.slice(-15);

      const timelineData = recentMonths.map(month => {
        const group = monthlyGroups[month];
        group.prices.sort((a, b) => a - b);
        group.psfs.sort((a, b) => a - b);

        const medianPrice = calculatePercentile(group.prices, 0.50);
        const medianPsf = calculatePercentile(group.psfs, 0.50);
        const avgPrice = Math.round(group.prices.reduce((a, b) => a + b, 0) / group.count);
        const avgPsf = Math.round(group.psfs.reduce((a, b) => a + b, 0) / group.count);

        return {
          month,
          volume: group.count,
          medianPrice,
          medianPsf,
          averagePrice: avgPrice,
          averagePsf: avgPsf,
          minPrice: group.prices[0],
          maxPrice: group.prices[group.prices.length - 1]
        };
      });

      return res.status(200).json({
        success: true,
        type: 'timeline',
        town,
        flatType,
        hasSufficientData: timelineData.length >= 2,
        timeline: timelineData,
        disclaimer: 'Indicative only. Not a substitute for a CEA-licensed property agent, lawyer, or your bank.'
      });
    }

  } catch (error) {
    console.error('Trends API error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to generate trend timelines from Singapore Government Datastore.',
      details: error.message,
      disclaimer: 'Indicative only. Not a substitute for a CEA-licensed property agent, lawyer, or your bank.'
    });
  }
}
