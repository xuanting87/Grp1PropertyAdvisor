/**
 * api/geocode.js
 * Serverless function for geocoding Singapore addresses and postal codes.
 * Uses the official Singapore OneMap API (/api/common/elastic/search)
 * and maps postal sectors to Singapore planning areas / HDB towns.
 * 
 * Target environment: Vercel serverless / Node Express server.
 * All secrets read from process.env, never exposed to client.
 */

// Singapore Postal Code Sector (first 2 digits) to Planning Area & Town Mapping
const POSTAL_SECTOR_MAP = {
  '01': { town: 'CENTRAL AREA', district: 'D01 (Raffles Place, Marina, Cecil)' },
  '02': { town: 'CENTRAL AREA', district: 'D01 (Tanjong Pagar, Marina)' },
  '03': { town: 'CENTRAL AREA', district: 'D01 (Chinatown, Tanjong Pagar)' },
  '04': { town: 'CENTRAL AREA', district: 'D01 (City Hall, Raffles Place)' },
  '05': { town: 'CENTRAL AREA', district: 'D01 (Raffles Place, Marina)' },
  '06': { town: 'CENTRAL AREA', district: 'D01 (Shenton Way, Tanjong Pagar)' },
  '07': { town: 'CENTRAL AREA', district: 'D02 (Anson, Tanjong Pagar)' },
  '08': { town: 'CENTRAL AREA', district: 'D02 (Tanjong Pagar, Chinatown)' },
  '09': { town: 'BUKIT MERAH', district: 'D04 (Telok Blangah, Harbourfront)' },
  '10': { town: 'BUKIT MERAH', district: 'D04 (Telok Blangah, Keppel)' },
  '11': { town: 'QUEENSTOWN', district: 'D05 (Pasir Panjang, Hong Leong)' },
  '12': { town: 'QUEENSTOWN', district: 'D05 (Pasir Panjang, West Coast)' },
  '13': { town: 'QUEENSTOWN', district: 'D05 (Clementi New Town, West Coast)' },
  '14': { town: 'QUEENSTOWN', district: 'D03 (Queenstown, Tiong Bahru)' },
  '15': { town: 'BUKIT MERAH', district: 'D03 (Tiong Bahru, Bukit Merah)' },
  '16': { town: 'BUKIT MERAH', district: 'D03 (Tiong Bahru, Bukit Ho Swee)' },
  '17': { town: 'CENTRAL AREA', district: 'D06 (High Street, Beach Road)' },
  '18': { town: 'CENTRAL AREA', district: 'D07 (Middle Road, Golden Mile)' },
  '19': { town: 'CENTRAL AREA', district: 'D07 (Bugis, Beach Road)' },
  '20': { town: 'KALLANG/WHAMPOA', district: 'D08 (Little India, Farrer Park)' },
  '21': { town: 'KALLANG/WHAMPOA', district: 'D08 (Little India, Serangoon)' },
  '22': { town: 'CENTRAL AREA', district: 'D09 (Orchard, River Valley)' },
  '23': { town: 'CENTRAL AREA', district: 'D09 (Killiney, Somerset, Orchard)' },
  '24': { town: 'BUKIT TIMAH', district: 'D10 (Tanglin, Bukit Timah)' },
  '25': { town: 'BUKIT TIMAH', district: 'D10 (Holland, Tanglin)' },
  '26': { town: 'BUKIT TIMAH', district: 'D10 (Bukit Timah, Holland)' },
  '27': { town: 'QUEENSTOWN', district: 'D10 (Holland Village, Ulu Pandan)' },
  '28': { town: 'BUKIT TIMAH', district: 'D11 (Novena, Newton, Thomson)' },
  '29': { town: 'TOA PAYOH', district: 'D11 (Dunearn, Thomson)' },
  '30': { town: 'TOA PAYOH', district: 'D11 (Novena, Thomson)' },
  '31': { town: 'TOA PAYOH', district: 'D12 (Toa Payoh)' },
  '32': { town: 'KALLANG/WHAMPOA', district: 'D12 (Balestier, Boon Keng)' },
  '33': { town: 'KALLANG/WHAMPOA', district: 'D12 (Boon Keng, Bendemeer)' },
  '34': { town: 'GEYLANG', district: 'D13 (Macpherson, Braddell)' },
  '35': { town: 'TOA PAYOH', district: 'D13 (Potong Pasir, Macpherson)' },
  '36': { town: 'GEYLANG', district: 'D13 (Aljunied, Macpherson)' },
  '37': { town: 'GEYLANG', district: 'D13 (Potong Pasir)' },
  '38': { town: 'GEYLANG', district: 'D14 (Geylang, Paya Lebar)' },
  '39': { town: 'GEYLANG', district: 'D14 (Eunos, Geylang)' },
  '40': { town: 'GEYLANG', district: 'D14 (Kembangan, Eunos)' },
  '41': { town: 'BEDOK', district: 'D14 (Kembangan, Chai Chee)' },
  '42': { town: 'MARINE PARADE', district: 'D15 (Katong, Joo Chiat)' },
  '43': { town: 'MARINE PARADE', district: 'D15 (Marine Parade, Tanjong Rhu)' },
  '44': { town: 'MARINE PARADE', district: 'D15 (Marine Parade, Telok Kurau)' },
  '45': { town: 'BEDOK', district: 'D15 (Siglap, Frankell)' },
  '46': { town: 'BEDOK', district: 'D16 (Bedok South, Bayshore)' },
  '47': { town: 'BEDOK', district: 'D16 (Bedok Reservoir, Bedok Central)' },
  '48': { town: 'BEDOK', district: 'D16 (Upper East Coast, Eastwood)' },
  '49': { town: 'PASIR RIS', district: 'D17 (Loyang, Changi)' },
  '50': { town: 'PASIR RIS', district: 'D17 (Changi Village, Flora)' },
  '51': { town: 'PASIR RIS', district: 'D18 (Pasir Ris Central, Elias)' },
  '52': { town: 'TAMPINES', district: 'D18 (Tampines, Simei)' },
  '53': { town: 'HOUGANG', district: 'D19 (Serangoon Garden, Hougang)' },
  '54': { town: 'SENGKANG', district: 'D19 (Sengkang, Rivervale, Compassvale)' },
  '55': { town: 'SERANGOON', district: 'D19 (Serangoon Central, Lorong Chuan)' },
  '56': { town: 'ANG MO KIO', district: 'D20 (Ang Mo Kio, Kebun Baru)' },
  '57': { town: 'BISHAN', district: 'D20 (Bishan, Marymount, Sin Ming)' },
  '58': { town: 'BUKIT TIMAH', district: 'D21 (Upper Bukit Timah, Clementi Park)' },
  '59': { town: 'BUKIT TIMAH', district: 'D21 (Bukit Timah, Toh Tuck)' },
  '60': { town: 'JURONG EAST', district: 'D22 (Jurong East, Teban Gardens)' },
  '61': { town: 'JURONG WEST', district: 'D22 (Boon Lay, Pioneer)' },
  '62': { town: 'JURONG WEST', district: 'D22 (Jurong West)' },
  '63': { town: 'JURONG WEST', district: 'D22 (Pioneer, Tuas)' },
  '64': { town: 'JURONG WEST', district: 'D22 (Jurong West, Boon Lay)' },
  '65': { town: 'BUKIT BATOK', district: 'D23 (Bukit Batok, Hillview)' },
  '66': { town: 'BUKIT BATOK', district: 'D23 (Bukit Gombak, Hillview)' },
  '67': { town: 'BUKIT PANJANG', district: 'D23 (Bukit Panjang, Choa Chu Kang)' },
  '68': { town: 'CHOA CHU KANG', district: 'D23 (Choa Chu Kang, Yew Tee)' },
  '69': { town: 'CHOA CHU KANG', district: 'D24 (Lim Chu Kang, Tengah)' },
  '70': { town: 'CHOA CHU KANG', district: 'D24 (Tengah)' },
  '71': { town: 'CHOA CHU KANG', district: 'D24 (Lim Chu Kang)' },
  '72': { town: 'WOODLANDS', district: 'D25 (Woodlands, Kranji)' },
  '73': { town: 'WOODLANDS', district: 'D25 (Woodlands Central, Admiralty)' },
  '75': { town: 'SEMBAWANG', district: 'D27 (Sembawang, Canberra)' },
  '76': { town: 'YISHUN', district: 'D27 (Yishun, Khatib)' },
  '77': { town: 'YISHUN', district: 'D27 (Yishun Ring, Springleaf)' },
  '78': { town: 'YISHUN', district: 'D27 (Mandai, Springleaf)' },
  '79': { town: 'SENGKANG', district: 'D28 (Seletar, Fernvale)' },
  '80': { town: 'SENGKANG', district: 'D28 (Seletar Hills, Jalan Kayu)' },
  '82': { town: 'PUNGGOL', district: 'D19 (Punggol, Edgedale, Waterway)' }
};

/**
 * Normalizes query string and resolves town name from postal sector or address text.
 * @param {string} postal - 6-digit postal code
 * @param {string} address - Full address line
 * @returns {string} HDB Town name in uppercase
 */
function resolveTown(postal, address = '') {
  if (postal && postal.length === 6) {
    const sector = postal.substring(0, 2);
    if (POSTAL_SECTOR_MAP[sector]) {
      return POSTAL_SECTOR_MAP[sector].town;
    }
  }

  // Fallback heuristic: check if any HDB town name appears in address string
  const TOWNS = [
    'ANG MO KIO', 'BEDOK', 'BISHAN', 'BUKIT BATOK', 'BUKIT MERAH',
    'BUKIT PANJANG', 'BUKIT TIMAH', 'CENTRAL AREA', 'CHOA CHU KANG',
    'CLEMENTI', 'GEYLANG', 'HOUGANG', 'JURONG EAST', 'JURONG WEST',
    'KALLANG/WHAMPOA', 'MARINE PARADE', 'PASIR RIS', 'PUNGGOL',
    'QUEENSTOWN', 'SEMBAWANG', 'SENGKANG', 'SERANGOON', 'TAMPINES',
    'TOA PAYOH', 'WOODLANDS', 'YISHUN'
  ];

  const upper = address.toUpperCase();
  for (const t of TOWNS) {
    if (upper.includes(t)) {
      return t;
    }
  }

  // Specific common road substrings
  if (upper.includes('TAMPINES')) return 'TAMPINES';
  if (upper.includes('BEDOK')) return 'BEDOK';
  if (upper.includes('JURONG')) return upper.includes('EAST') ? 'JURONG EAST' : 'JURONG WEST';
  if (upper.includes('WOODLANDS')) return 'WOODLANDS';
  if (upper.includes('YISHUN')) return 'YISHUN';
  if (upper.includes('PUNGGOL')) return 'PUNGGOL';
  if (upper.includes('SENGKANG')) return 'SENGKANG';
  if (upper.includes('HOUGANG')) return 'HOUGANG';
  if (upper.includes('ANG MO KIO')) return 'ANG MO KIO';
  if (upper.includes('BISHAN')) return 'BISHAN';
  if (upper.includes('TOA PAYOH')) return 'TOA PAYOH';
  if (upper.includes('PASIR RIS')) return 'PASIR RIS';

  return 'ANG MO KIO'; // Default fallback town if indeterminate
}

/**
 * Main handler function for /api/geocode
 * Handles both Vercel serverless (req, res) and Express (req, res)
 */
export default async function handler(req, res) {
  // Set CORS and JSON headers
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = req.query?.q || req.query?.searchVal || '';
  if (!query || query.trim().length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Query parameter "q" (address or 6-digit postal code) is required.'
    });
  }

  const trimmedQuery = query.trim();

  try {
    // 1. Call OneMap Elastic Search
    // OneMap is Singapore SLA's official authoritative geocoder
    const onemapUrl = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(trimmedQuery)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    
    const headers = {};
    if (process.env.ONEMAP_TOKEN) {
      headers['Authorization'] = `Bearer ${process.env.ONEMAP_TOKEN}`;
    }

    const response = await fetch(onemapUrl, {
      headers,
      signal: AbortSignal.timeout(6000)
    });

    if (response.ok) {
      const data = await response.json();
      if (data.results && data.results.length > 0) {
        const enrichedResults = data.results.slice(0, 8).map(item => {
          const postal = item.POSTAL && item.POSTAL !== 'NIL' ? item.POSTAL : '';
          const sector = postal.length === 6 ? postal.substring(0, 2) : '';
          const sectorMeta = POSTAL_SECTOR_MAP[sector] || null;
          const town = resolveTown(postal, `${item.ROAD_NAME} ${item.SEARCHVAL} ${item.ADDRESS}`);
          
          return {
            searchValue: item.SEARCHVAL,
            blockNo: item.BLK_NO || '',
            roadName: item.ROAD_NAME || '',
            building: item.BUILDING && item.BUILDING !== 'NIL' ? item.BUILDING : '',
            address: item.ADDRESS,
            postal: postal,
            latitude: parseFloat(item.LATITUDE),
            longitude: parseFloat(item.LONGITUDE),
            town: town,
            district: sectorMeta ? sectorMeta.district : 'Singapore',
            x: item.X,
            y: item.Y
          };
        });

        return res.status(200).json({
          success: true,
          source: 'OneMap Singapore SLA',
          count: enrichedResults.length,
          results: enrichedResults
        });
      }
    }

    // 2. Fallback: If 6 digits postal code was searched and OneMap didn't return (or was rate limited)
    const postalMatch = trimmedQuery.match(/\b\d{6}\b/);
    if (postalMatch) {
      const postal = postalMatch[0];
      const sector = postal.substring(0, 2);
      const sectorMeta = POSTAL_SECTOR_MAP[sector];
      const town = sectorMeta ? sectorMeta.town : resolveTown(postal);
      
      return res.status(200).json({
        success: true,
        source: 'Singapore Postal Sector Index',
        count: 1,
        results: [{
          searchValue: `Singapore ${postal}`,
          blockNo: '',
          roadName: `Sector ${sector}`,
          building: '',
          address: `Singapore Postal Code ${postal}`,
          postal: postal,
          latitude: 1.3521, // Centroid of Singapore
          longitude: 103.8198,
          town: town,
          district: sectorMeta ? sectorMeta.district : 'Singapore'
        }]
      });
    }

    return res.status(200).json({
      success: true,
      source: 'OneMap',
      count: 0,
      results: [],
      message: `No Singapore address or building found matching "${trimmedQuery}". Please check postal code or road name.`
    });

  } catch (error) {
    console.error('Geocode API error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to complete geocoding lookup with government service.',
      details: error.message
    });
  }
}
