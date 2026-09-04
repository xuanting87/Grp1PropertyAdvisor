/**
 * api/data.js
 * Unified serverless endpoint (/api/data) for Singapore Government Property & Spatial APIs:
 * 
 * 1. URA Daily Token Trading & Caching:
 *    - Trades AccessKey for today's daily token:
 *      GET https://eservice.ura.gov.sg/uraDataService/insertNewToken/v1 (Header: AccessKey)
 * 2. URA Private Residential Property Transactions:
 *    - Sends BOTH headers (AccessKey + Token):
 *      GET https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1?service=PMI_Resi_Transaction&batch={1|2|3|4}
 *      (Fetches 4 batches by postal district and merges if batch=all or unspecified)
 * 3. OneMap Elastic Geocode & Search:
 *    - GET https://www.onemap.gov.sg/api/common/elastic/search?searchVal=...&returnGeom=Y&getAddrDetails=Y&pageNum=1
 * 4. OneMap Reverse Geocode:
 *    - GET https://www.onemap.gov.sg/api/public/revgeocode?location=lat,lng&buffer=40&addressType=All (Token required)
 * 5. OneMap Multi-Modal Routing:
 *    - GET https://www.onemap.gov.sg/api/public/routingsvc/route?start=lat,lng&end=lat,lng&routeType={walk|drive|cycle|pt} (Token required)
 * 
 * GUARDRAIL: No API keys are hardcoded. All keys are read securely from process.env.
 */

// In-memory token cache for daily URA token
let cachedUraToken = {
  token: null,
  sgDate: null, // YYYY-MM-DD in Asia/Singapore timezone
  fetchedAt: null
};

// In-memory token cache for OneMap v2 token (if email/password authentication is used)
let cachedOneMapToken = {
  token: null,
  expiresAt: null
};

/**
 * Returns current date string formatted as YYYY-MM-DD in Singapore Time (SGT, UTC+8).
 */
function getSingaporeDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
}

/**
 * Trades URA AccessKey for today's daily Token at:
 * https://eservice.ura.gov.sg/uraDataService/insertNewToken/v1
 * Header: AccessKey: <key>
 * Caches the token for the calendar day (Asia/Singapore timezone).
 * 
 * @param {Object} req - Incoming request
 * @param {boolean} forceRefresh - Force exchange a new token regardless of cache
 * @returns {Promise<string>} Today's URA Token
 */
async function getUraDailyToken(req = null, forceRefresh = false) {
  const accessKey = req?.headers?.accesskey || req?.headers?.['access-key'] || process.env.URA_ACCESS_KEY;
  if (!accessKey) {
    const err = new Error('URA_ACCESS_KEY environment variable is not configured. Please add it in AI Studio Settings/Secrets or provide via AccessKey header.');
    err.code = 'MISSING_URA_ACCESS_KEY';
    throw err;
  }

  const todaySg = getSingaporeDate();

  // Return cached token if valid for today
  if (!forceRefresh && cachedUraToken.token && cachedUraToken.sgDate === todaySg) {
    return cachedUraToken.token;
  }

  const tokenUrl = 'https://eservice.ura.gov.sg/uraDataService/insertNewToken/v1';
  const response = await fetch(tokenUrl, {
    method: 'GET',
    headers: {
      'AccessKey': accessKey,
      'User-Agent': 'SingaporePropertyAdvisor/1.0'
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    throw new Error(`URA Token Exchange failed with HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  
  // URA response schema: { Status: "Success", Message: "...", Result: "<token_string>" }
  const token = data.Result || data.token;
  if (!token || (data.Status && data.Status !== 'Success')) {
    throw new Error(`URA Token Exchange rejected: ${data.Message || JSON.stringify(data)}`);
  }

  // Update in-memory cache for today
  cachedUraToken = {
    token: token,
    sgDate: todaySg,
    fetchedAt: Date.now()
  };

  return token;
}

/**
 * Obtains an active OneMap API Token from environment or auth endpoint:
 * Priority:
 * 1. Client-supplied token in request header / query
 * 2. process.env.ONEMAP_TOKEN
 * 3. process.env.ONEMAP_EMAIL + process.env.ONEMAP_PASSWORD via /api/auth/post/getToken
 * 
 * @param {Object} req - HTTP request object
 * @returns {Promise<string|null>} OneMap Access Token or null
 */
async function getOneMapToken(req) {
  // Check client request header or query
  const authHeader = req.headers?.authorization;
  if (authHeader) {
    return authHeader.replace(/^Bearer\s+/i, '').trim();
  }
  if (req.query?.onemap_token) {
    return req.query.onemap_token;
  }

  // Check direct environment token
  if (process.env.ONEMAP_TOKEN) {
    return process.env.ONEMAP_TOKEN.trim();
  }

  // Check cached email/password login token
  if (cachedOneMapToken.token && cachedOneMapToken.expiresAt && Date.now() < cachedOneMapToken.expiresAt - 60000) {
    return cachedOneMapToken.token;
  }

  // Attempt login if credentials exist in env
  const email = process.env.ONEMAP_EMAIL;
  const password = process.env.ONEMAP_PASSWORD;
  if (email && password) {
    try {
      const loginRes = await fetch('https://www.onemap.gov.sg/api/auth/post/getToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(8000)
      });

      if (loginRes.ok) {
        const loginData = await loginRes.json();
        if (loginData.access_token) {
          cachedOneMapToken = {
            token: loginData.access_token,
            expiresAt: loginData.expiry_timestamp ? Number(loginData.expiry_timestamp) * 1000 : Date.now() + 3 * 24 * 3600 * 1000
          };
          return loginData.access_token;
        }
      }
    } catch (e) {
      console.warn('OneMap credential login failed:', e.message);
    }
  }

  return null;
}

/**
 * Fetches a single batch of URA Private Residential Transactions.
 * Sends BOTH headers (AccessKey + Token) as required by URA Data Service.
 * 
 * @param {number} batchNum - Batch number (1, 2, 3, or 4)
 * @param {string} accessKey - URA Access Key
 * @param {string} token - Today's URA Token
 * @returns {Promise<Array>} List of project objects from URA
 */
async function fetchUraBatch(batchNum, accessKey, token) {
  const url = `https://eservice.ura.gov.sg/uraDataService/invokeUraDS/v1?service=PMI_Resi_Transaction&batch=${batchNum}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'AccessKey': accessKey,
      'Token': token,
      'User-Agent': 'SingaporePropertyAdvisor/1.0'
    },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`URA PMI_Resi_Transaction batch ${batchNum} failed with HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();
  if (data.Status && data.Status !== 'Success' && data.Status !== 'Live') {
    throw new Error(`URA API Error (Batch ${batchNum}): ${data.Message || 'Failed to fetch batch'}`);
  }

  return Array.isArray(data.Result) ? data.Result : [];
}

/**
 * Fetches private residential transactions from URA.
 * If batch is specified (1..4), fetches that batch.
 * If batch is 'all' or omitted, fetches all 4 batches and merges them.
 */
async function handleUraTransactions(req, res) {
  const accessKey = req?.headers?.accesskey || req?.headers?.['access-key'] || process.env.URA_ACCESS_KEY;
  if (!accessKey) {
    return res.status(200).json({
      success: false,
      service: 'PMI_Resi_Transaction',
      error: 'URA_ACCESS_KEY is not configured in environment variables. Please add URA_ACCESS_KEY in Settings/Secrets to fetch live private residential transactions.',
      code: 'MISSING_URA_ACCESS_KEY',
      disclaimer: 'Indicative only. Not a substitute for a CEA-licensed property agent or lawyer.'
    });
  }

  try {
    const todayToken = await getUraDailyToken(req);
    const batchParam = (req.query?.batch || 'all').toString().toLowerCase();

    let projects = [];
    let batchesFetched = [];

    if (batchParam === '1' || batchParam === '2' || batchParam === '3' || batchParam === '4') {
      const b = parseInt(batchParam, 10);
      projects = await fetchUraBatch(b, accessKey, todayToken);
      batchesFetched = [b];
    } else {
      // Fetch all 4 batches by postal district and merge
      const batchPromises = [1, 2, 3, 4].map(b => fetchUraBatch(b, accessKey, todayToken));
      const batchResults = await Promise.all(batchPromises);
      projects = batchResults.flat();
      batchesFetched = [1, 2, 3, 4];
    }

    // Optional query filters
    const districtFilter = req.query?.district ? req.query.district.trim().toUpperCase() : null;
    const projectFilter = req.query?.project ? req.query.project.trim().toUpperCase() : null;
    const propertyTypeFilter = req.query?.propertyType ? req.query.propertyType.trim().toUpperCase() : null;
    const limit = req.query?.limit ? parseInt(req.query.limit, 10) : null;

    if (districtFilter || projectFilter || propertyTypeFilter) {
      projects = projects.filter(p => {
        let match = true;
        // URA project objects include: project, street, x, y, transaction: [...]
        if (projectFilter && p.project && !p.project.toUpperCase().includes(projectFilter)) {
          match = false;
        }
        return match;
      });
    }

    // Count total transactions across projects
    let totalTransactions = 0;
    projects.forEach(p => {
      if (Array.isArray(p.transaction)) {
        totalTransactions += p.transaction.length;
      }
    });

    if (limit && limit > 0) {
      projects = projects.slice(0, limit);
    }

    return res.status(200).json({
      success: true,
      service: 'PMI_Resi_Transaction',
      date: getSingaporeDate(),
      batchesFetched,
      totalProjects: projects.length,
      totalTransactions,
      projects,
      disclaimer: 'Data sourced from Urban Redevelopment Authority (URA) Singapore. Indicative only.'
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      service: 'PMI_Resi_Transaction',
      error: err.message || 'Failed to query URA private residential transactions',
      code: err.code || 'URA_REQUEST_ERROR'
    });
  }
}

/**
 * Handles OneMap Elastic Search / Geocoding:
 * GET https://www.onemap.gov.sg/api/common/elastic/search?searchVal=...&returnGeom=Y&getAddrDetails=Y&pageNum=1
 */
async function handleOneMapSearch(req, res) {
  const searchVal = req.query?.searchVal || req.query?.q || req.query?.address || '';
  if (!searchVal.trim()) {
    return res.status(400).json({
      success: false,
      error: 'searchVal query parameter is required (e.g. /api/data?type=search&searchVal=raffles%20place)'
    });
  }

  const returnGeom = req.query?.returnGeom || 'Y';
  const getAddrDetails = req.query?.getAddrDetails || 'Y';
  const pageNum = req.query?.pageNum || '1';

  const token = await getOneMapToken(req);
  const targetUrl = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${encodeURIComponent(searchVal)}&returnGeom=${encodeURIComponent(returnGeom)}&getAddrDetails=${encodeURIComponent(getAddrDetails)}&pageNum=${encodeURIComponent(pageNum)}`;

  try {
    const headers = {
      'User-Agent': 'SingaporePropertyAdvisor/1.0'
    };
    if (token) {
      headers['Authorization'] = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
    }

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      throw new Error(`OneMap Search returned HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return res.status(200).json({
      success: true,
      service: 'onemap_search',
      tokenAttached: Boolean(token),
      totalResults: data.totalNumPages || data.found || 0,
      results: data.results || []
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      service: 'onemap_search',
      error: err.message || 'Failed to search OneMap'
    });
  }
}

/**
 * Handles OneMap Reverse Geocoding:
 * GET https://www.onemap.gov.sg/api/public/revgeocode?location=1.3,103.8&buffer=40&addressType=All
 * Note: Token is strictly required by OneMap; returns 401 without one.
 */
async function handleOneMapRevGeocode(req, res) {
  const location = req.query?.location || req.query?.latlng || '';
  if (!location.trim()) {
    return res.status(400).json({
      success: false,
      error: 'location query parameter is required in "lat,lng" format (e.g. /api/data?type=revgeocode&location=1.3,103.8)'
    });
  }

  const buffer = req.query?.buffer || '40';
  const addressType = req.query?.addressType || 'All';

  const token = await getOneMapToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      service: 'onemap_revgeocode',
      error: 'OneMap API Token is required for reverse geocoding. Please configure ONEMAP_TOKEN (or ONEMAP_EMAIL + ONEMAP_PASSWORD) in environment variables.',
      code: 'MISSING_ONEMAP_TOKEN'
    });
  }

  const targetUrl = `https://www.onemap.gov.sg/api/public/revgeocode?location=${encodeURIComponent(location)}&buffer=${encodeURIComponent(buffer)}&addressType=${encodeURIComponent(addressType)}`;

  try {
    const headers = {
      'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
      'User-Agent': 'SingaporePropertyAdvisor/1.0'
    };

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(8000)
    });

    if (response.status === 401) {
      return res.status(401).json({
        success: false,
        service: 'onemap_revgeocode',
        error: 'OneMap rejected the token (HTTP 401 Unauthorized). The token may have expired or is invalid.',
        code: 'INVALID_ONEMAP_TOKEN'
      });
    }

    if (!response.ok) {
      throw new Error(`OneMap RevGeocode returned HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return res.status(200).json({
      success: true,
      service: 'onemap_revgeocode',
      location,
      data
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      service: 'onemap_revgeocode',
      error: err.message || 'Failed to reverse geocode'
    });
  }
}

/**
 * Handles OneMap Routing:
 * GET https://www.onemap.gov.sg/api/public/routingsvc/route?start=1.320981,103.844150&end=1.326762,103.8559&routeType=walk
 * Note: Token is strictly required by OneMap; returns 401 without one.
 * routeType: walk | drive | cycle | pt
 */
async function handleOneMapRouting(req, res) {
  const start = req.query?.start || '';
  const end = req.query?.end || '';
  if (!start.trim() || !end.trim()) {
    return res.status(400).json({
      success: false,
      error: 'start and end parameters are required in "lat,lng" format (e.g. /api/data?type=route&start=1.320981,103.844150&end=1.326762,103.8559&routeType=walk)'
    });
  }

  const routeType = (req.query?.routeType || req.query?.mode || 'walk').toLowerCase();
  const validModes = ['walk', 'drive', 'cycle', 'pt'];
  if (!validModes.includes(routeType)) {
    return res.status(400).json({
      success: false,
      error: `Invalid routeType "${routeType}". Must be one of: ${validModes.join(', ')}`
    });
  }

  const token = await getOneMapToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      service: 'onemap_routing',
      error: 'OneMap API Token is required for routing. Please configure ONEMAP_TOKEN (or ONEMAP_EMAIL + ONEMAP_PASSWORD) in environment variables.',
      code: 'MISSING_ONEMAP_TOKEN'
    });
  }

  let targetUrl = `https://www.onemap.gov.sg/api/public/routingsvc/route?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&routeType=${encodeURIComponent(routeType)}`;
  
  // Public transport optional date/time parameters
  if (routeType === 'pt') {
    if (req.query?.date) targetUrl += `&date=${encodeURIComponent(req.query.date)}`;
    if (req.query?.time) targetUrl += `&time=${encodeURIComponent(req.query.time)}`;
    if (req.query?.mode) targetUrl += `&mode=${encodeURIComponent(req.query.mode)}`;
    if (req.query?.maxWalkDistance) targetUrl += `&maxWalkDistance=${encodeURIComponent(req.query.maxWalkDistance)}`;
  }

  try {
    const headers = {
      'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
      'User-Agent': 'SingaporePropertyAdvisor/1.0'
    };

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000)
    });

    if (response.status === 401) {
      return res.status(401).json({
        success: false,
        service: 'onemap_routing',
        error: 'OneMap rejected the token (HTTP 401 Unauthorized). The token may have expired or is invalid.',
        code: 'INVALID_ONEMAP_TOKEN'
      });
    }

    if (!response.ok) {
      throw new Error(`OneMap Routing returned HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return res.status(200).json({
      success: true,
      service: 'onemap_routing',
      start,
      end,
      routeType,
      data
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      service: 'onemap_routing',
      error: err.message || 'Failed to calculate route'
    });
  }
}

/**
 * Main serverless request handler for /api/data
 */
export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, AccessKey, Token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Determine requested action/service
  const urlPath = (req.url || req.path || '').split('?')[0].replace(/^\/api\/data\/?/, '');
  const actionParam = (
    req.query?.service ||
    req.query?.type ||
    req.query?.action ||
    req.query?.endpoint ||
    urlPath
  ).toLowerCase();

  // 1. Direct query matching for OneMap search
  if (req.query?.searchVal || actionParam === 'search' || actionParam === 'geocode') {
    return handleOneMapSearch(req, res);
  }

  // 2. Direct query matching for OneMap reverse geocode
  if ((req.query?.location && !req.query?.start) || actionParam === 'revgeocode' || actionParam === 'reverse_geocode') {
    return handleOneMapRevGeocode(req, res);
  }

  // 3. Direct query matching for OneMap routing
  if ((req.query?.start && req.query?.end) || actionParam === 'route' || actionParam === 'routing') {
    return handleOneMapRouting(req, res);
  }

  // 4. URA Daily Token Trading endpoint
  if (
    actionParam === 'insertnewtoken' ||
    actionParam === 'token' ||
    actionParam === 'ura_token' ||
    req.query?.token === 'true'
  ) {
    try {
      const force = req.query?.force === 'true' || req.query?.refresh === 'true';
      const token = await getUraDailyToken(req, force);
      return res.status(200).json({
        success: true,
        service: 'insertNewToken',
        date: getSingaporeDate(),
        cached: !force && cachedUraToken.sgDate === getSingaporeDate(),
        token: token,
        note: 'Send this token along with AccessKey in data requests: headers { AccessKey, Token }'
      });
    } catch (err) {
      const status = err.code === 'MISSING_URA_ACCESS_KEY' ? 400 : 500;
      return res.status(status).json({
        success: false,
        service: 'insertNewToken',
        error: err.message,
        code: err.code || 'URA_TOKEN_ERROR'
      });
    }
  }

  // 5. URA Private Residential Property Transactions
  if (
    actionParam === 'pmi_resi_transaction' ||
    actionParam === 'ura_transactions' ||
    actionParam === 'transactions' ||
    actionParam === 'ura' ||
    actionParam === 'private'
  ) {
    return handleUraTransactions(req, res);
  }

  // 6. Root / Discovery Summary
  const hasUraKey = Boolean(process.env.URA_ACCESS_KEY);
  const hasOneMapToken = Boolean(process.env.ONEMAP_TOKEN || (process.env.ONEMAP_EMAIL && process.env.ONEMAP_PASSWORD));

  return res.status(200).json({
    status: 'ok',
    service: 'Singapore Property Price Advisor Unified Data API',
    endpoints: {
      uraToken: {
        description: "Trade URA AccessKey for today's daily token",
        url: '/api/data?service=insertNewToken',
        method: 'GET',
        headersRequired: 'AccessKey: <URA_ACCESS_KEY>'
      },
      uraTransactions: {
        description: 'Fetch URA Private Residential Transactions (4 batches merged)',
        url: '/api/data?service=PMI_Resi_Transaction&batch=all',
        method: 'GET',
        headersRequired: 'AccessKey + Token'
      },
      onemapSearch: {
        description: 'Search & geocode Singapore addresses via OneMap Elastic',
        url: '/api/data?searchVal=raffles%20place&returnGeom=Y&getAddrDetails=Y&pageNum=1',
        method: 'GET'
      },
      onemapRevGeocode: {
        description: 'Reverse geocode coordinates into address details (Token required)',
        url: '/api/data?location=1.3,103.8&buffer=40&addressType=All',
        method: 'GET'
      },
      onemapRouting: {
        description: 'Calculate multi-modal routes (walk, drive, cycle, pt) (Token required)',
        url: '/api/data?start=1.320981,103.844150&end=1.326762,103.8559&routeType=walk',
        method: 'GET'
      }
    },
    credentialsStatus: {
      URA_ACCESS_KEY: hasUraKey ? 'Configured' : 'Missing (add in Settings/Secrets)',
      ONEMAP_TOKEN: hasOneMapToken ? 'Configured' : 'Missing (add in Settings/Secrets)',
      uraDailyTokenCached: Boolean(cachedUraToken.token && cachedUraToken.sgDate === getSingaporeDate())
    }
  });
}
