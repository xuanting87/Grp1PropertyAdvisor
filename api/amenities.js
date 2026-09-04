/**
 * api/amenities.js
 * Serverless function for Singapore Property Amenities & POI Lookup.
 * Evaluates nearby MRT/LRT stations, schools (MOE), shopping malls,
 * hawker centres (NEA), and parks within a configurable radius.
 * 
 * Target environment: Vercel serverless / Express server.
 * Uses authoritative Singapore coordinates and Haversine distance formula.
 */

// Singapore Mass Rapid Transit (MRT) & LRT Stations Reference Coordinates
const MRT_STATIONS = [
  { name: 'Raffles Place', line: 'NS26 / EW14', lat: 1.2830, lng: 103.8513 },
  { name: 'City Hall', line: 'NS25 / EW13', lat: 1.2931, lng: 103.8522 },
  { name: 'Orchard', line: 'NS22 / TE14', lat: 1.3040, lng: 103.8318 },
  { name: 'Somerset', line: 'NS23', lat: 1.3002, lng: 103.8390 },
  { name: 'Dhoby Ghaut', line: 'NS24 / NE6 / CC1', lat: 1.2987, lng: 103.8457 },
  { name: 'Bugis', line: 'EW12 / DT14', lat: 1.3006, lng: 103.8559 },
  { name: 'Marina Bay', line: 'NS27 / CE2 / TE20', lat: 1.2764, lng: 103.8546 },
  { name: 'Tanjong Pagar', line: 'EW15', lat: 1.2764, lng: 103.8458 },
  { name: 'Outram Park', line: 'EW16 / NE3 / TE17', lat: 1.2803, lng: 103.8395 },
  { name: 'Chinatown', line: 'NE4 / DT19', lat: 1.2843, lng: 103.8441 },
  { name: 'Clarke Quay', line: 'NE5', lat: 1.2884, lng: 103.8466 },
  { name: 'Little India', line: 'NE7 / DT12', lat: 1.3068, lng: 103.8492 },
  { name: 'Farrer Park', line: 'NE8', lat: 1.3125, lng: 103.8542 },
  { name: 'Boon Keng', line: 'NE9', lat: 1.3194, lng: 103.8617 },
  { name: 'Potong Pasir', line: 'NE10', lat: 1.3314, lng: 103.8691 },
  { name: 'Woodleigh', line: 'NE11', lat: 1.3392, lng: 103.8708 },
  { name: 'Serangoon', line: 'NE12 / CC13', lat: 1.3498, lng: 103.8736 },
  { name: 'Kovan', line: 'NE13', lat: 1.3601, lng: 103.8850 },
  { name: 'Hougang', line: 'NE14', lat: 1.3713, lng: 103.8924 },
  { name: 'Buangkok', line: 'NE15', lat: 1.3829, lng: 103.8931 },
  { name: 'Sengkang', line: 'NE16 / STC', lat: 1.3916, lng: 103.8954 },
  { name: 'Punggol', line: 'NE17 / PTC / CP4', lat: 1.4052, lng: 103.9022 },
  { name: 'Bishan', line: 'NS17 / CC15', lat: 1.3508, lng: 103.8481 },
  { name: 'Ang Mo Kio', line: 'NS16 / CR11', lat: 1.3699, lng: 103.8496 },
  { name: 'Yio Chu Kang', line: 'NS15', lat: 1.3817, lng: 103.8449 },
  { name: 'Khatib', line: 'NS14', lat: 1.4173, lng: 103.8330 },
  { name: 'Yishun', line: 'NS13', lat: 1.4294, lng: 103.8350 },
  { name: 'Canberra', line: 'NS12', lat: 1.4431, lng: 103.8297 },
  { name: 'Sembawang', line: 'NS11', lat: 1.4490, lng: 103.8201 },
  { name: 'Admiralty', line: 'NS10', lat: 1.4406, lng: 103.8010 },
  { name: 'Woodlands', line: 'NS9 / TE2', lat: 1.4369, lng: 103.7865 },
  { name: 'Marsiling', line: 'NS8', lat: 1.4326, lng: 103.7743 },
  { name: 'Kranji', line: 'NS7', lat: 1.4251, lng: 103.7621 },
  { name: 'Yew Tee', line: 'NS5', lat: 1.3973, lng: 103.7474 },
  { name: 'Choa Chu Kang', line: 'NS4 / JS1 / BP1', lat: 1.3853, lng: 103.7444 },
  { name: 'Bukit Gombak', line: 'NS3', lat: 1.3586, lng: 103.7519 },
  { name: 'Bukit Batok', line: 'NS2', lat: 1.3490, lng: 103.7496 },
  { name: 'Jurong East', line: 'NS1 / EW24 / JE5', lat: 1.3332, lng: 103.7423 },
  { name: 'Chinese Garden', line: 'EW25', lat: 1.3424, lng: 103.7326 },
  { name: 'Lakeside', line: 'EW26', lat: 1.3442, lng: 103.7210 },
  { name: 'Boon Lay', line: 'EW27 / JS8', lat: 1.3386, lng: 103.7060 },
  { name: 'Pioneer', line: 'EW28', lat: 1.3376, lng: 103.6973 },
  { name: 'Joo Koon', line: 'EW29', lat: 1.3277, lng: 103.6784 },
  { name: 'Clementi', line: 'EW23 / CR17', lat: 1.3151, lng: 103.7652 },
  { name: 'Dover', line: 'EW22', lat: 1.3114, lng: 103.7786 },
  { name: 'Buona Vista', line: 'EW21 / CC22', lat: 1.3073, lng: 103.7900 },
  { name: 'Commonwealth', line: 'EW20', lat: 1.3024, lng: 103.7983 },
  { name: 'Queenstown', line: 'EW19', lat: 1.2945, lng: 103.8061 },
  { name: 'Redhill', line: 'EW18', lat: 1.2896, lng: 103.8168 },
  { name: 'Tiong Bahru', line: 'EW17', lat: 1.2861, lng: 103.8270 },
  { name: 'Lavender', line: 'EW11', lat: 1.3074, lng: 103.8629 },
  { name: 'Kallang', line: 'EW10', lat: 1.3115, lng: 103.8714 },
  { name: 'Aljunied', line: 'EW9', lat: 1.3164, lng: 103.8829 },
  { name: 'Paya Lebar', line: 'EW8 / CC9', lat: 1.3182, lng: 103.8931 },
  { name: 'Eunos', line: 'EW7', lat: 1.3197, lng: 103.9031 },
  { name: 'Kembangan', line: 'EW6', lat: 1.3211, lng: 103.9129 },
  { name: 'Bedok', line: 'EW5', lat: 1.3240, lng: 103.9300 },
  { name: 'Tanah Merah', line: 'EW4', lat: 1.3272, lng: 103.9464 },
  { name: 'Simei', line: 'EW3', lat: 1.3432, lng: 103.9533 },
  { name: 'Tampines', line: 'EW2 / DT32', lat: 1.3533, lng: 103.9452 },
  { name: 'Pasir Ris', line: 'EW1 / CP1', lat: 1.3730, lng: 103.9493 },
  { name: 'Expo', line: 'CG1 / DT35', lat: 1.3354, lng: 103.9618 },
  { name: 'Changi Airport', line: 'CG2', lat: 1.3573, lng: 103.9885 },
  { name: 'Toa Payoh', line: 'NS19', lat: 1.3327, lng: 103.8476 },
  { name: 'Braddell', line: 'NS18', lat: 1.3405, lng: 103.8468 },
  { name: 'Novena', line: 'NS20', lat: 1.3204, lng: 103.8438 },
  { name: 'Newton', line: 'NS21 / DT11', lat: 1.3129, lng: 103.8380 },
  { name: 'Mayflower', line: 'TE6', lat: 1.3715, lng: 103.8365 },
  { name: 'Bright Hill', line: 'TE7 / CR13', lat: 1.3633, lng: 103.8335 },
  { name: 'Upper Thomson', line: 'TE8', lat: 1.3544, lng: 103.8329 },
  { name: 'Caldecott', line: 'CC17 / TE9', lat: 1.3376, lng: 103.8396 },
  { name: 'Stevens', line: 'DT10 / TE11', lat: 1.3201, lng: 103.8260 },
  { name: 'Napier', line: 'TE12', lat: 1.3068, lng: 103.8184 },
  { name: 'Great World', line: 'TE15', lat: 1.2934, lng: 103.8321 },
  { name: 'Havelock', line: 'TE16', lat: 1.2882, lng: 103.8299 },
  { name: 'Maxwell', line: 'TE18', lat: 1.2805, lng: 103.8439 },
  { name: 'Shenton Way', line: 'TE19', lat: 1.2777, lng: 103.8504 },
  { name: 'Gardens by the Bay', line: 'TE22', lat: 1.2790, lng: 103.8672 },
  { name: 'Tanjong Rhu', line: 'TE23', lat: 1.2974, lng: 103.8732 },
  { name: 'Katong Park', line: 'TE24', lat: 1.2982, lng: 103.8856 },
  { name: 'Tanjong Katong', line: 'TE25', lat: 1.3005, lng: 103.8988 },
  { name: 'Marine Parade', line: 'TE26', lat: 1.3031, lng: 103.9067 },
  { name: 'Marine Terrace', line: 'TE27', lat: 1.3065, lng: 103.9161 },
  { name: 'Siglap', line: 'TE28', lat: 1.3099, lng: 103.9304 },
  { name: 'Bayshore', line: 'TE29', lat: 1.3129, lng: 103.9439 },
  { name: 'Bukit Panjang', line: 'DT1 / BP6', lat: 1.3786, lng: 103.7618 },
  { name: 'Cashew', line: 'DT2', lat: 1.3698, lng: 103.7644 },
  { name: 'Hillview', line: 'DT3', lat: 1.3623, lng: 103.7674 },
  { name: 'Beauty World', line: 'DT5', lat: 1.3413, lng: 103.7758 },
  { name: 'King Albert Park', line: 'DT6', lat: 1.3357, lng: 103.7834 },
  { name: 'Sixth Avenue', line: 'DT7', lat: 1.3308, lng: 103.7969 },
  { name: 'Tan Kah Kee', line: 'DT8', lat: 1.3256, lng: 103.8075 },
  { name: 'Botanic Gardens', line: 'CC19 / DT9', lat: 1.3224, lng: 103.8160 }
];

// Singapore Major Primary & Secondary Schools Reference
const SCHOOLS = [
  { name: 'Ai Tong School (Primary)', type: 'Primary School', lat: 1.3606, lng: 103.8344 },
  { name: 'Rosyth School (Primary)', type: 'Primary School', lat: 1.3729, lng: 103.8744 },
  { name: 'Catholic High School', type: 'Primary / Secondary', lat: 1.3547, lng: 103.8447 },
  { name: 'Raffles Institution', type: 'Secondary / JC', lat: 1.3468, lng: 103.8463 },
  { name: 'Raffles Girls\' Primary School', type: 'Primary School', lat: 1.3292, lng: 103.8066 },
  { name: 'Anglo-Chinese School (Primary)', type: 'Primary School', lat: 1.3183, lng: 103.8378 },
  { name: 'Anglo-Chinese School (Junior)', type: 'Primary School', lat: 1.3101, lng: 103.8415 },
  { name: 'St. Joseph\'s Institution Junior', type: 'Primary School', lat: 1.3189, lng: 103.8486 },
  { name: 'CHIJ St. Nicholas Girls\' School', type: 'Primary / Secondary', lat: 1.3736, lng: 103.8342 },
  { name: 'Nan Hua Primary School', type: 'Primary School', lat: 1.3189, lng: 103.7644 },
  { name: 'Tao Nan School (Primary)', type: 'Primary School', lat: 1.3057, lng: 103.9103 },
  { name: 'Maha Bodhi School', type: 'Primary School', lat: 1.3283, lng: 103.9022 },
  { name: 'Red Swastika School', type: 'Primary School', lat: 1.3323, lng: 103.9317 },
  { name: 'St. Hilda\'s Primary School', type: 'Primary School', lat: 1.3491, lng: 103.9378 },
  { name: 'Poi Ching School', type: 'Primary School', lat: 1.3582, lng: 103.9388 },
  { name: 'Chongfu School', type: 'Primary School', lat: 1.4398, lng: 103.8398 },
  { name: 'South View Primary School', type: 'Primary School', lat: 1.3813, lng: 103.7472 },
  { name: 'Rulang Primary School', type: 'Primary School', lat: 1.3469, lng: 103.7188 },
  { name: 'Pei Chun Public School', type: 'Primary School', lat: 1.3377, lng: 103.8554 },
  { name: 'Henry Park Primary School', type: 'Primary School', lat: 1.3168, lng: 103.7844 },
  { name: 'Kong Hwa School', type: 'Primary School', lat: 1.3118, lng: 103.8863 },
  { name: 'Maris Stella High School', type: 'Primary / Secondary', lat: 1.3418, lng: 103.8778 },
  { name: 'Radin Mas Primary School', type: 'Primary School', lat: 1.2753, lng: 103.8242 },
  { name: 'River Valley Primary School', type: 'Primary School', lat: 1.2952, lng: 103.8361 },
  { name: 'Methodist Girls\' School', type: 'Primary / Secondary', lat: 1.3332, lng: 103.7806 },
  { name: 'Temasek Primary School', type: 'Primary School', lat: 1.3175, lng: 103.9416 },
  { name: 'Gongshang Primary School', type: 'Primary School', lat: 1.3569, lng: 103.9492 },
  { name: 'Waterway Primary School', type: 'Primary School', lat: 1.4031, lng: 103.9136 },
  { name: 'Anchor Green Primary School', type: 'Primary School', lat: 1.3912, lng: 103.8879 },
  { name: 'Kuo Chuan Presbyterian Primary', type: 'Primary School', lat: 1.3496, lng: 103.8548 }
];

// Singapore Hawker Centres (NEA) Reference
const HAWKER_CENTRES = [
  { name: 'Maxwell Food Centre', address: '1 Kadayanallur St', lat: 1.2803, lng: 103.8447 },
  { name: 'Chinatown Complex Market & Food Centre', address: '335 Smith St', lat: 1.2825, lng: 103.8431 },
  { name: 'Old Airport Road Food Centre', address: '51 Old Airport Rd', lat: 1.3082, lng: 103.8858 },
  { name: 'Amoy Street Food Centre', address: '7 Maxwell Rd', lat: 1.2793, lng: 103.8466 },
  { name: 'Lau Pa Sat (Telok Ayer Market)', address: '18 Raffles Quay', lat: 1.2807, lng: 103.8504 },
  { name: 'Tiong Bahru Market & Food Centre', address: '30 Seng Poh Rd', lat: 1.2848, lng: 103.8324 },
  { name: 'Newton Food Centre', address: '500 Clemenceau Ave North', lat: 1.3129, lng: 103.8395 },
  { name: 'Chomp Chomp Food Centre', address: '20 Kensington Park Rd', lat: 1.3644, lng: 103.8665 },
  { name: 'Bedok 85 Fengshan Market & Food Centre', address: '85 Bedok North St 4', lat: 1.3318, lng: 103.9385 },
  { name: 'Bedok Interchange Hawker Centre', address: '208B New Upper Changi Rd', lat: 1.3243, lng: 103.9304 },
  { name: 'Bishan Bus Interchange Food Centre', address: '514 Bishan St 13', lat: 1.3506, lng: 103.8490 },
  { name: 'Ang Mo Kio Central Market & Food Centre', address: 'Blk 724 Ang Mo Kio Ave 6', lat: 1.3721, lng: 103.8475 },
  { name: 'Kebun Baru Market and Food Centre', address: '226H Ang Mo Kio St 22', lat: 1.3670, lng: 103.8378 },
  { name: 'Mayflower Market & Food Centre', address: '162 Ang Mo Kio Ave 4', lat: 1.3737, lng: 103.8385 },
  { name: 'Toa Payoh West Market & Food Centre', address: '127 Lorong 1 Toa Payoh', lat: 1.3409, lng: 103.8450 },
  { name: 'Whampoa Drive Makan Place', address: '91 Whampoa Dr', lat: 1.3235, lng: 103.8550 },
  { name: 'Geylang Serai Market and Food Centre', address: '1 Geylang Serai', lat: 1.3168, lng: 103.8980 },
  { name: 'Tampines Round Market & Food Centre', address: '137 Tampines St 11', lat: 1.3456, lng: 103.9448 },
  { name: 'Marine Parade Central Market and Food Centre', address: '84 Marine Parade Central', lat: 1.3025, lng: 103.9064 },
  { name: 'Yishun Park Hawker Centre', address: '51 Yishun Ave 11', lat: 1.4230, lng: 103.8448 },
  { name: 'Bukit Panjang Hawker Centre and Market', address: '2 Bukit Panjang Ring Rd', lat: 1.3774, lng: 103.7719 },
  { name: 'Jurong West 505 Market & Food Centre', address: '505 Jurong West St 52', lat: 1.3498, lng: 103.7180 },
  { name: 'Yuhua Market & Hawker Centre', address: '347 Jurong East Ave 1', lat: 1.3444, lng: 103.7314 },
  { name: 'Clementi 448 Market & Food Centre', address: '448 Clementi Ave 3', lat: 1.3134, lng: 103.7645 },
  { name: 'One Punggol Hawker Centre', address: '1 Punggol Dr', lat: 1.4082, lng: 103.9056 }
];

// Singapore Shopping Malls Reference
const SHOPPING_MALLS = [
  { name: 'AMK Hub', address: '53 Ang Mo Kio Ave 3', lat: 1.3694, lng: 103.8485 },
  { name: 'Junction 8', address: '9 Bishan Place', lat: 1.3502, lng: 103.8488 },
  { name: 'Nex', address: '23 Serangoon Central', lat: 1.3508, lng: 103.8726 },
  { name: 'Tampines Mall', address: '4 Tampines Central 5', lat: 1.3528, lng: 103.9448 },
  { name: 'Century Square', address: '2 Tampines Central 5', lat: 1.3524, lng: 103.9436 },
  { name: 'Tampines 1', address: '10 Tampines Central 1', lat: 1.3541, lng: 103.9452 },
  { name: 'Bedok Mall', address: '311 New Upper Changi Rd', lat: 1.3246, lng: 103.9293 },
  { name: 'Waterway Point', address: '83 Punggol Central', lat: 1.4067, lng: 103.9020 },
  { name: 'Compass One', address: '1 Sengkang Square', lat: 1.3922, lng: 103.8946 },
  { name: 'Northpoint City', address: '930 Yishun Ave 2', lat: 1.4297, lng: 103.8360 },
  { name: 'Causeway Point', address: '1 Woodlands Square', lat: 1.4361, lng: 103.7859 },
  { name: 'Jem', address: '50 Jurong Gateway Rd', lat: 1.3333, lng: 103.7431 },
  { name: 'Westgate', address: '3 Gateway Dr', lat: 1.3337, lng: 103.7424 },
  { name: 'IMM Outlet Mall', address: '2 Jurong East St 21', lat: 1.3347, lng: 103.7468 },
  { name: 'Jurong Point', address: '1 Jurong West Central 2', lat: 1.3398, lng: 103.7067 },
  { name: 'VivoCity', address: '1 HarbourFront Walk', lat: 1.2642, lng: 103.8223 },
  { name: 'ION Orchard', address: '2 Orchard Turn', lat: 1.3040, lng: 103.8320 },
  { name: 'Parkway Parade', address: '80 Marine Parade Rd', lat: 1.3015, lng: 103.9052 },
  { name: 'PLQ Mall (Paya Lebar Quarter)', address: '10 Paya Lebar Rd', lat: 1.3175, lng: 103.8925 },
  { name: 'The Clementi Mall', address: '3155 Commonwealth Ave West', lat: 1.3153, lng: 103.7651 },
  { name: 'Hillion Mall', address: '17 Petir Rd', lat: 1.3782, lng: 103.7630 },
  { name: 'Lot One Shoppers\' Mall', address: '21 Choa Chu Kang Ave 4', lat: 1.3853, lng: 103.7447 },
  { name: 'Jewel Changi Airport', address: '78 Airport Blvd', lat: 1.3602, lng: 103.9897 },
  { name: 'Sun Plaza', address: '30 Sembawang Dr', lat: 1.4480, lng: 103.8197 },
  { name: 'White Sands', address: '1 Pasir Ris Central St 3', lat: 1.3725, lng: 103.9497 }
];

// Singapore Parks & Nature Reserves Reference
const PARKS = [
  { name: 'Bishan-Ang Mo Kio Park', type: 'Regional Park', lat: 1.3627, lng: 103.8449 },
  { name: 'East Coast Park', type: 'Coastal Park', lat: 1.3012, lng: 103.9126 },
  { name: 'Singapore Botanic Gardens', type: 'UNESCO World Heritage Site', lat: 1.3152, lng: 103.8162 },
  { name: 'MacRitchie Reservoir Park', type: 'Nature Reserve', lat: 1.3439, lng: 103.8344 },
  { name: 'Jurong Lake Gardens', type: 'National Garden', lat: 1.3364, lng: 103.7297 },
  { name: 'Fort Canning Park', type: 'Historical Park', lat: 1.2952, lng: 103.8465 },
  { name: 'Punggol Waterway Park', type: 'Riverine Park', lat: 1.4098, lng: 103.9042 },
  { name: 'Sengkang Riverside Park', type: 'Riverine Park', lat: 1.3976, lng: 103.8856 },
  { name: 'Lower Peirce Reservoir Park', type: 'Nature Reserve', lat: 1.3712, lng: 103.8260 },
  { name: 'Pasir Ris Park', type: 'Coastal Park', lat: 1.3792, lng: 103.9515 },
  { name: 'Bedok Reservoir Park', type: 'Reservoir Park', lat: 1.3417, lng: 103.9318 },
  { name: 'Bukit Timah Nature Reserve', type: 'Nature Reserve', lat: 1.3547, lng: 103.7764 },
  { name: 'West Coast Park', type: 'Coastal Park', lat: 1.2917, lng: 103.7661 },
  { name: 'Admiralty Park', type: 'Nature Area', lat: 1.4468, lng: 103.7844 },
  { name: 'Yishun Park', type: 'Neighbourhood Park', lat: 1.4239, lng: 103.8419 }
];

/**
 * Calculates straight-line distance in meters between two coordinates using Haversine formula.
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} Distance in meters
 */
function getHaversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

/**
 * Main handler function for /api/amenities
 */
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const lat = parseFloat(req.query?.lat);
  const lng = parseFloat(req.query?.lng);
  const radius = parseInt(req.query?.radius, 10) || 1000; // default 1km

  if (isNaN(lat) || isNaN(lng)) {
    return res.status(400).json({
      success: false,
      error: 'Valid numeric latitude and longitude query parameters ("lat", "lng") are required.'
    });
  }

  try {
    const nearbyItems = [];

    // 1. Process MRT & LRT Stations
    for (const station of MRT_STATIONS) {
      const dist = getHaversineDistanceMeters(lat, lng, station.lat, station.lng);
      if (dist <= radius) {
        nearbyItems.push({
          category: 'mrt',
          categoryLabel: 'MRT / LRT Station',
          name: `${station.name} MRT`,
          details: station.line,
          lat: station.lat,
          lng: station.lng,
          distanceMeters: dist,
          walkingMinutes: Math.max(1, Math.round(dist / 80))
        });
      }
    }

    // 2. Process Schools
    for (const school of SCHOOLS) {
      const dist = getHaversineDistanceMeters(lat, lng, school.lat, school.lng);
      if (dist <= radius) {
        nearbyItems.push({
          category: 'school',
          categoryLabel: 'School (MOE)',
          name: school.name,
          details: school.type,
          lat: school.lat,
          lng: school.lng,
          distanceMeters: dist,
          walkingMinutes: Math.max(1, Math.round(dist / 80))
        });
      }
    }

    // 3. Process Hawker Centres
    for (const hawker of HAWKER_CENTRES) {
      const dist = getHaversineDistanceMeters(lat, lng, hawker.lat, hawker.lng);
      if (dist <= radius) {
        nearbyItems.push({
          category: 'hawker',
          categoryLabel: 'Hawker Centre (NEA)',
          name: hawker.name,
          details: hawker.address,
          lat: hawker.lat,
          lng: hawker.lng,
          distanceMeters: dist,
          walkingMinutes: Math.max(1, Math.round(dist / 80))
        });
      }
    }

    // 4. Process Shopping Malls
    for (const mall of SHOPPING_MALLS) {
      const dist = getHaversineDistanceMeters(lat, lng, mall.lat, mall.lng);
      if (dist <= radius) {
        nearbyItems.push({
          category: 'mall',
          categoryLabel: 'Shopping Mall',
          name: mall.name,
          details: mall.address,
          lat: mall.lat,
          lng: mall.lng,
          distanceMeters: dist,
          walkingMinutes: Math.max(1, Math.round(dist / 80))
        });
      }
    }

    // 5. Process Parks & Green Spaces
    for (const park of PARKS) {
      const dist = getHaversineDistanceMeters(lat, lng, park.lat, park.lng);
      if (dist <= radius) {
        nearbyItems.push({
          category: 'park',
          categoryLabel: 'Park & Nature',
          name: park.name,
          details: park.type,
          lat: park.lat,
          lng: park.lng,
          distanceMeters: dist,
          walkingMinutes: Math.max(1, Math.round(dist / 80))
        });
      }
    }

    // Sort all nearby items by distance ascending
    nearbyItems.sort((a, b) => a.distanceMeters - b.distanceMeters);

    // Compute category counts
    const summary = {
      mrtCount: nearbyItems.filter(i => i.category === 'mrt').length,
      schoolCount: nearbyItems.filter(i => i.category === 'school').length,
      hawkerCount: nearbyItems.filter(i => i.category === 'hawker').length,
      mallCount: nearbyItems.filter(i => i.category === 'mall').length,
      parkCount: nearbyItems.filter(i => i.category === 'park').length,
      totalCount: nearbyItems.length
    };

    // Find nearest MRT even if slightly outside radius if none found within radius
    let nearestMrt = nearbyItems.find(i => i.category === 'mrt');
    if (!nearestMrt) {
      let closestStation = null;
      let minStationDist = Infinity;
      for (const s of MRT_STATIONS) {
        const d = getHaversineDistanceMeters(lat, lng, s.lat, s.lng);
        if (d < minStationDist) {
          minStationDist = d;
          closestStation = s;
        }
      }
      if (closestStation) {
        nearestMrt = {
          category: 'mrt',
          categoryLabel: 'MRT / LRT Station',
          name: `${closestStation.name} MRT`,
          details: closestStation.line,
          lat: closestStation.lat,
          lng: closestStation.lng,
          distanceMeters: minStationDist,
          walkingMinutes: Math.max(1, Math.round(minStationDist / 80)),
          outsideRadius: true
        };
      }
    }

    return res.status(200).json({
      success: true,
      center: { lat, lng },
      radiusMeters: radius,
      summary,
      nearestMrt,
      items: nearbyItems,
      disclaimer: 'Indicative only. Not a substitute for a CEA-licensed property agent, lawyer, or your bank.'
    });

  } catch (error) {
    console.error('Amenities API error:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to compute nearby amenities and POI lookup.',
      details: error.message
    });
  }
}
