import { getOfflineMapFeaturesNearby } from './offlineMapData.js';
import { loadPersistentMapSnapshots, savePersistentMapSnapshot } from './mapDataStore.js';

const WATER_TAG_PATTERNS = [
  tags => tags.natural === 'water',
  tags => tags.natural === 'wetland',
  tags => tags.landuse === 'reservoir',
  tags => tags.man_made === 'reservoir_covered',
  tags => Boolean(tags.water && /lake|pond|reservoir|basin|lagoon|oxbow|fishpond|canal|river|stream/i.test(tags.water)),
  tags => Boolean(tags.waterway && /^(river|stream|canal|tidal_channel|riverbank)$/i.test(tags.waterway)),
];

const CONTEXT_TAGS = [
  ['man_made', 'wastewater_plant', 'Wastewater treatment facility', 'Review its discharge pathway and permit data; its presence on the map is not evidence of a release.'],
  ['amenity', 'wastewater_plant', 'Wastewater facility', 'Review its discharge pathway and permit data; its presence on the map is not evidence of a release.'],
  ['waterway', 'drain', 'Mapped drain', 'Check flow direction and whether it receives stormwater or wastewater. The map does not establish the drain contents.'],
  ['waterway', 'ditch', 'Mapped ditch', 'Check whether runoff enters the nearby water body, especially after rainfall.'],
  ['landuse', 'industrial', 'Industrial land use', 'A nearby industrial land-use tag is context for investigation, not proof of water pollution.'],
  ['industrial', '*', 'Industrial facility / activity', 'Confirm the facility type, discharge permits, and any monitoring records before inferring environmental impact.'],
  ['landuse', 'farmland', 'Agricultural land use', 'Depending on local practices, runoff may carry sediment or nutrients; this tag does not prove runoff reached the water.'],
  ['amenity', 'waste_disposal', 'Waste-disposal site', 'Verify site status, handling practices, and drainage connections before assessing water risk.'],
  ['man_made', 'water_works', 'Water-works infrastructure', 'This is water infrastructure context, not a contamination indicator.'],
  ['landuse', 'residential', 'Residential land use', 'May help describe the local setting; it is not itself evidence of contamination.'],
];

export function parseCoordinatesInput(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('Paste latitude/longitude or a map link that contains coordinates.');
  const decoded = (() => { try { return decodeURIComponent(raw.replace(/\+/g, '%2B')); } catch { return raw; } })();
  const candidates = [];
  const add = (latText, lonText, source) => {
    if (latText == null || lonText == null) return;
    const lat = Number(String(latText).replace(/[°\s]/g, ''));
    const lon = Number(String(lonText).replace(/[°\s]/g, ''));
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      candidates.push({ lat, lon, source });
    }
  };

  // Decimal degrees with hemisphere labels, e.g. 25.5941° N, 85.1376° E.
  let hemisphereMatch = decoded.match(/(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([NS])\s*[,; ]+\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])/i);
  if (hemisphereMatch) {
    const lat = Math.abs(Number(hemisphereMatch[1])) * (/S/i.test(hemisphereMatch[2]) ? -1 : 1);
    const lon = Math.abs(Number(hemisphereMatch[3])) * (/W/i.test(hemisphereMatch[4]) ? -1 : 1);
    add(lat, lon, 'Coordinates with hemisphere labels');
  }
  // Degrees/minutes/seconds with hemisphere labels, e.g. 25°35'38.8"N 85°08'15.4"E.
  const dmsPattern = /(\d{1,3})\s*[°º]\s*(\d{1,2})?\s*(?:['′’]\s*(\d{1,2}(?:\.\d+)?)?\s*["″”]?)?\s*([NSEW])/gi;
  const dmsParts = [...decoded.matchAll(dmsPattern)];
  const dmsLat = dmsParts.find(item => /[NS]/i.test(item[4]));
  const dmsLon = dmsParts.find(item => /[EW]/i.test(item[4]));
  if (dmsLat && dmsLon) {
    const toDecimal = item => {
      const sign = /[SW]/i.test(item[4]) ? -1 : 1;
      return sign * (Number(item[1]) + Number(item[2] || 0) / 60 + Number(item[3] || 0) / 3600);
    };
    add(toDecimal(dmsLat), toDecimal(dmsLon), 'Degrees/minutes/seconds coordinates');
  }

  // Google Maps place URLs: .../@lat,lon,zoom and ...!3dLAT!4dLON
  let match = decoded.match(/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/i);
  if (match) add(match[1], match[2], 'Google Maps place coordinates');
  match = decoded.match(/@(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i);
  if (match) add(match[1], match[2], 'Map URL coordinates');

  // OpenStreetMap links and common query-parameter map links.
  match = decoded.match(/#map=\d+(?:\.\d+)?\/(-?\d{1,2}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)/i);
  if (match) add(match[1], match[2], 'OpenStreetMap coordinates');
  try {
    const url = new URL(raw);
    const params = url.searchParams;
    const lat = params.get('lat') ?? params.get('latitude') ?? params.get('mlat');
    const lon = params.get('lon') ?? params.get('lng') ?? params.get('long') ?? params.get('longitude') ?? params.get('mlon');
    if (lat != null && lon != null) add(lat, lon, 'Map URL coordinates');
    for (const key of ['q', 'query', 'll', 'center', 'cp', 'where']) {
      const value = params.get(key);
      if (!value) continue;
      const pair = value.match(/(-?\d{1,2}(?:\.\d+)?)\s*[,;/]\s*(-?\d{1,3}(?:\.\d+)?)/);
      if (pair) add(pair[1], pair[2], 'Coordinates from map URL');
    }
  } catch { /* The input may be a coordinate pair rather than a URL. */ }

  // Plain text such as “25.5941, 85.1376”, copied from a map details panel.
  match = decoded.match(/(?:^|[^\d.])(-?\d{1,2}(?:\.\d+)?)\s*[,;/]\s*(-?\d{1,3}(?:\.\d+)?)(?![\d.])/);
  if (match) add(match[1], match[2], 'Pasted coordinates');
  if (candidates.length === 0) {
    throw new Error('Could not find coordinates in that input. Paste a pair like 25.5941, 85.1376 or a map URL that visibly contains latitude and longitude. Shortened links may need you to copy the coordinates from the map first.');
  }
  return candidates[0];
}

export function haversineMeters(a, b) {
  const radians = degrees => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const lat1 = radians(a.lat);
  const lat2 = radians(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function pointForElement(element) {
  if (Number.isFinite(element.lat) && Number.isFinite(element.lon)) return { lat: element.lat, lon: element.lon };
  if (Number.isFinite(element.center?.lat) && Number.isFinite(element.center?.lon)) return { lat: element.center.lat, lon: element.center.lon };
  return null;
}

export function waterFeatureKind(tags = {}) {
  if (tags.waterway) {
    const key = String(tags.waterway).toLowerCase();
    const kinds = { river: 'River', riverbank: 'River bank', stream: 'Stream', canal: 'Canal', ditch: 'Ditch', drain: 'Drain', tidal_channel: 'Tidal channel' };
    if (kinds[key]) return kinds[key];
  }
  if (tags.landuse === 'reservoir' || tags.man_made === 'reservoir_covered' || tags.water === 'reservoir') return 'Reservoir';
  if (tags.natural === 'wetland') return 'Wetland';
  if (tags.natural === 'water' || tags.water) {
    const subtype = String(tags.water || '').toLowerCase();
    const kinds = { lake: 'Lake', pond: 'Pond', basin: 'Basin', lagoon: 'Lagoon', oxbow: 'Oxbow lake', fishpond: 'Fish pond', canal: 'Canal' };
    if (kinds[subtype]) return kinds[subtype];
    return 'Mapped water body';
  }
  return 'Water feature';
}

export function isWaterFeature(tags = {}) {
  return WATER_TAG_PATTERNS.some(test => test(tags));
}

export function contextInfo(tags = {}) {
  const tag = (key, label, explanation, category) => ({ label, explanation, tag: `${key}=${tags[key]}`, category });
  if (tags.waterway && /^(sewer|drain|ditch|culvert|weir|dam|lock_gate|spillway)$/i.test(tags.waterway)) {
    const value = String(tags.waterway).toLowerCase();
    const drainage = /sewer|drain|ditch|culvert/i.test(value);
    return tag('waterway', drainage ? 'Mapped drainage / sewer feature' : 'Mapped water-control structure', drainage
      ? 'This mapped drainage or sewer feature may carry stormwater or wastewater. Inspect its route, flow direction, outfall, and contents; the map does not prove that it discharges into the selected water body.'
      : 'This mapped water-control structure may influence flow or water levels. Confirm its function and operating condition with local records and field inspection.', drainage ? 'drainage' : 'water-infrastructure');
  }
  if (tags.man_made && /^(pumping_station|water_tower|water_works|wastewater_plant|pipeline|reservoir_covered|water_tap|water_well|monitoring_station)$/i.test(tags.man_made)) {
    const value = String(tags.man_made).toLowerCase();
    const category = /wastewater/i.test(value) ? 'drainage' : 'water-infrastructure';
    return tag('man_made', 'Mapped water / utility infrastructure', `OpenStreetMap tags this as ${value.replaceAll('_', ' ')}. Confirm its actual function, network connections, and operating state; the map does not establish a discharge or contamination event.`, category);
  }
  if (tags.man_made === 'wastewater_plant' || tags.amenity === 'wastewater_plant') {
    return { label: 'Wastewater treatment facility', explanation: 'A mapped wastewater facility is a relevant feature for reviewing permits, discharge routes, and monitoring records. Its presence is not evidence of a release or pollution.', tag: `facility=${tags.man_made || tags.amenity}`, category: 'drainage' };
  }
  if (tags.industrial) return tag('industrial', 'Mapped industrial activity', 'The map records an industrial activity here. Check verified permits, materials handled, discharge records, and drainage connections; this map tag does not prove pollution.', 'industrial');
  if (tags.landuse === 'industrial') return tag('landuse', 'Industrial land use', 'A mapped industrial land-use area is a location for environmental review, not proof of a pollutant release. Check discharge records and sample relevant inflows/outflows.', 'industrial');
  if (tags.landuse === 'farmland' || tags.landuse === 'farmyard' || tags.landuse === 'orchard' || tags.landuse === 'plant_nursery') {
    return tag('landuse', 'Mapped agricultural land', 'Agricultural land can be relevant to runoff investigations. Check slope, rainfall, field practices, and drainage routes; proximity alone does not prove runoff entered the water body.', 'agriculture');
  }
  if (tags.amenity === 'waste_disposal') return tag('amenity', 'Mapped waste-disposal site', 'Verify the site status, waste handling, leachate controls, and drainage connections before assessing water risk.', 'facility');
  if (tags.bridge) return tag('bridge', 'Mapped bridge / crossing', 'A mapped bridge or crossing is shown for geographic context. Its footprint and dimensions are schematic in the hologram.', 'bridge');
  if (tags.building || tags['building:part']) {
    const type = String(tags.building || tags['building:part']);
    return tag('building', 'Mapped building', `OpenStreetMap marks a ${type} building here. The hologram uses an approximate block at its mapped representative point; it is not a surveyed 3D building model.`, 'building');
  }
  if (tags.highway) return tag('highway', 'Mapped road / path', `OpenStreetMap classifies this corridor as ${tags.highway}. It is shown for access and catchment context; the map does not establish runoff direction or a drainage connection to the water body.`, 'road');
  if (tags.railway) return tag('railway', 'Mapped railway infrastructure', `OpenStreetMap classifies this feature as ${tags.railway}. It is shown for geographic context; its presence alone does not establish a water-quality impact.`, 'railway');
  if (tags.power) return tag('power', 'Mapped power infrastructure', `OpenStreetMap tags this as power=${tags.power}. It is shown as local infrastructure context, not as evidence of contamination.`, 'utility');
  if (tags.barrier) return tag('barrier', `Mapped ${String(tags.barrier).replaceAll('_', ' ')} barrier`, `OpenStreetMap records a barrier=${tags.barrier} feature. It may affect access or movement, but its exact function and condition need field verification.`, 'utility');
  if (tags.aeroway) return tag('aeroway', `Mapped ${String(tags.aeroway).replaceAll('_', ' ')} aviation feature`, `OpenStreetMap records an aeroway=${tags.aeroway} feature. It is included as built-environment context only; its presence does not establish any water-quality impact.`, 'facility');
  if (tags.healthcare) return tag('healthcare', `Mapped ${String(tags.healthcare).replaceAll('_', ' ')} healthcare facility`, `OpenStreetMap records a healthcare=${tags.healthcare} feature. This describes a mapped service location, not a verified wastewater discharge or contamination source.`, 'facility');
  if (tags.emergency) return tag('emergency', `Mapped ${String(tags.emergency).replaceAll('_', ' ')} emergency facility`, `OpenStreetMap records an emergency=${tags.emergency} feature. It is shown for local infrastructure context only.`, 'facility');
  if (tags.craft) return tag('craft', `Mapped ${String(tags.craft).replaceAll('_', ' ')} workshop`, `OpenStreetMap records a craft=${tags.craft} activity. Confirm the actual operation, materials, drainage, and permits before assessing any possible environmental relevance.`, 'facility');
  if (tags.sport) return tag('sport', `Mapped ${String(tags.sport).replaceAll('_', ' ')} sports facility`, `OpenStreetMap records a sport=${tags.sport} feature. This is recreational context, not evidence of contamination.`, 'landuse');
  if (tags.historic) return tag('historic', `Mapped historic ${String(tags.historic).replaceAll('_', ' ')}`, `OpenStreetMap records a historic=${tags.historic} feature. It is included to describe the surroundings; verify the feature and its current use in the field.`, 'landuse');
  if (tags.man_made) return tag('man_made', `Mapped ${String(tags.man_made).replaceAll('_', ' ')} infrastructure`, `OpenStreetMap records a man_made=${tags.man_made} feature here. The map identifies its mapped category but does not establish its operating condition or connection to the water body.`, 'utility');
  if (tags.amenity) return tag('amenity', `Mapped ${String(tags.amenity).replaceAll('_', ' ')} facility`, `OpenStreetMap records an amenity=${tags.amenity} feature here. This describes mapped local services; it does not prove that the facility affects water quality.`, 'facility');
  if (tags.public_transport) return tag('public_transport', 'Mapped public transport facility', `This feature is tagged public_transport=${tags.public_transport}. It provides transport context only and does not establish an environmental impact.`, 'facility');
  if (tags.landuse) return tag('landuse', `Mapped ${String(tags.landuse).replaceAll('_', ' ')} land use`, `OpenStreetMap classifies this area as landuse=${tags.landuse}. It helps describe surrounding land use; it is not a water-quality measurement.`, /farm|orchard|allotments|plant_nursery/i.test(tags.landuse) ? 'agriculture' : 'landuse');
  if (tags.leisure) return tag('leisure', `Mapped ${String(tags.leisure).replaceAll('_', ' ')} leisure area`, `OpenStreetMap records a leisure=${tags.leisure} feature. This describes nearby recreational land use; actual activity and water impacts need field verification.`, 'landuse');
  if (tags.tourism) return tag('tourism', `Mapped ${String(tags.tourism).replaceAll('_', ' ')} tourism feature`, `OpenStreetMap records a tourism=${tags.tourism} feature. It is included as surrounding context, not as evidence of contamination.`, 'facility');
  if (tags.office) return tag('office', `Mapped ${String(tags.office).replaceAll('_', ' ')} office`, `OpenStreetMap records an office=${tags.office} feature. This is a mapped building/use description only.`, 'building');
  if (tags.shop) return tag('shop', `Mapped ${String(tags.shop).replaceAll('_', ' ')} shop`, `OpenStreetMap records a shop=${tags.shop} feature. This is local built-environment context only.`, 'building');
  if (tags.natural && /^(wood|scrub|tree_row|grassland|bare_rock)$/i.test(tags.natural)) return tag('natural', `Mapped natural ${tags.natural.replaceAll('_', ' ')}`, `OpenStreetMap marks a natural=${tags.natural} feature. This helps describe vegetation or terrain around the water body; it is not a water-quality measurement.`, 'landuse');
  return null;
}

function displayName(tags = {}, fallback = 'Unnamed mapped feature') {
  return tags.name || tags['name:en'] || tags.loc_name || fallback;
}

function tagsSummary(tags = {}) {
  const preferred = ['natural', 'water', 'waterway', 'landuse', 'building', 'building:levels', 'height', 'highway', 'bridge', 'railway', 'power', 'man_made', 'amenity', 'description', 'intermittent', 'seasonal', 'operator', 'wikidata', 'wikipedia'];
  return preferred.filter(key => tags[key]).map(key => ({ key, value: String(tags[key]) }));
}

function normalizeElement(element, inputPoint) {
  const tags = element.tags || {};
  const point = pointForElement(element);
  if (!point) return null;
  const distanceM = haversineMeters(inputPoint, point);
  const id = `${element.type}/${element.id}`;
  return {
    id,
    osmType: element.type,
    osmId: element.id,
    name: displayName(tags),
    kind: waterFeatureKind(tags),
    lat: point.lat,
    lon: point.lon,
    distanceM,
    tags,
    tagSummary: tagsSummary(tags),
    mapUrl: `https://www.openstreetmap.org/?mlat=${point.lat.toFixed(6)}&mlon=${point.lon.toFixed(6)}#map=16/${point.lat.toFixed(6)}/${point.lon.toFixed(6)}`,
  };
}

// Prefer the two globally available community instances currently listed by the
// OpenStreetMap wiki, and keep the main FOSSGIS instance as the final fallback.
// Public Overpass servers are best-effort services: no endpoint can guarantee uptime.
// Global instances documented by the OpenStreetMap Overpass project.
// All public instances remain best-effort and may be unavailable at times.
export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

export const CUSTOM_OVERPASS_ENDPOINT_STORAGE_KEY = 'jalrakshak:custom-overpass-endpoint:v1';

export function validateCustomOverpassEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length > 500) throw new Error('The custom map-provider URL is too long.');
  let url;
  try { url = new URL(raw); } catch { throw new Error('Enter a complete HTTPS Overpass interpreter URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('The custom provider must be an HTTP(S) URL without embedded username or password. HTTPS is recommended.');
  }
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error('Use HTTPS for remote custom map providers. HTTP is allowed only for a local server.');
  }
  return url.toString();
}

export function getConfiguredOverpassEndpoints(customEndpoint = '') {
  const custom = validateCustomOverpassEndpoint(customEndpoint);
  return [...new Set([...OVERPASS_ENDPOINTS, ...(custom ? [custom] : [])])];
}

export function radiusFallbackSequence(radiusM) {
  const radius = Math.round(Number(radiusM));
  const sequences = {
    500: [500],
    1000: [1000, 500],
    1500: [1500, 1000],
    3000: [3000, 1500],
    5000: [5000, 3000],
  };
  return sequences[radius] || [radius];
}

// Keep the v1 cache namespace so saved results from earlier releases can be reused.
const MAP_CACHE_PREFIX = 'jalrakshak:osm-cache:v1:';
const MAP_CACHE_FRESH_TTL_MS = 30 * 60 * 1000;
const MAP_CACHE_MAX_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const MAP_CACHE_MAX_ENTRIES = 24;
const OVERPASS_REQUEST_TIMEOUT_MS = 7000; // hard cap per provider; providers are queried concurrently
const PROVIDER_BACKOFF_BASE_MS = 0;

function makeQuery(lat, lon, radiusM) {
  // The first query is deliberately focused on water features, so a large
  // building inventory cannot prevent the core waterbody result from loading.
  return `[out:json][timeout:20][maxsize:67108864];\n(` +
    `nwr(around:${radiusM},${lat},${lon})["natural"="water"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["natural"="wetland"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["landuse"="reservoir"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["man_made"="reservoir_covered"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["waterway"~"^(river|stream|canal|tidal_channel|riverbank)$"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["water"~"^(lake|pond|reservoir|basin|lagoon|oxbow|fishpond|canal)$"];\n` +
    `);out center tags 250;`;
}

function makeBuiltEnvironmentQuery(lat, lon, radiusM) {
  // Preserve the v1.4 inventory categories, but cap the response at 500 objects
  // to reduce payload size on shared public map services.
  return `[out:json][timeout:20][maxsize:67108864];\n(` +
    `nwr(around:${radiusM},${lat},${lon})["building"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["building:part"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|footway|path)$"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["bridge"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["railway"~"^(rail|light_rail|tram|subway|narrow_gauge|station|halt)$"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["power"~"^(plant|substation|generator|line|minor_line|tower|pole)$"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["man_made"~"^(wastewater_plant|water_works|pumping_station|water_tower|reservoir_covered|pipeline|water_well|monitoring_station|storage_tank|works)$"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["waterway"~"^(drain|ditch|sewer|culvert|weir|dam|lock_gate|spillway)$"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["industrial"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["landuse"~"^(industrial|farmland|farmyard|residential|commercial|retail)$"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["amenity"~"^(wastewater_plant|waste_disposal|hospital|school|university|fuel|recycling|marketplace)$"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["healthcare"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["emergency"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["barrier"~"^(dam|retaining_wall|fence|wall)$"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["aeroway"];\n` +
    `nwr(around:${radiusM},${lat},${lon})["public_transport"~"^(station|platform)$"];\n` +
    `);out center tags 500;`;
}

function cacheKeyFor(lat, lon, radiusM) {
  return `${MAP_CACHE_PREFIX}${lat.toFixed(4)}:${lon.toFixed(4)}:${radiusM}`;
}

function cachePrefixForPoint(lat, lon) {
  return `${MAP_CACHE_PREFIX}${lat.toFixed(4)}:${lon.toFixed(4)}:`;
}

function getCacheStorage(storage) {
  if (storage !== undefined) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}

function parseCacheRecord(storage, key, now = Date.now()) {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.result || !Number.isFinite(cached.savedAt)) return null;
    const ageMs = Math.max(0, now - cached.savedAt);
    if (ageMs > MAP_CACHE_MAX_STALE_MS) {
      storage.removeItem(key);
      return null;
    }
    return { key, result: cached.result, savedAt: cached.savedAt, ageMs };
  } catch {
    return null;
  }
}

function readMapCache(key, options = {}) {
  const storage = getCacheStorage(options.storage);
  if (!storage) return null;
  const record = parseCacheRecord(storage, key, options.now ?? Date.now());
  if (!record) return null;
  if (!options.allowStale && record.ageMs > MAP_CACHE_FRESH_TTL_MS) return null;
  return {
    ...record.result,
    cacheHit: true,
    staleCache: record.ageMs > MAP_CACHE_FRESH_TTL_MS,
    cacheAgeMs: record.ageMs,
    cacheSavedAt: new Date(record.savedAt).toISOString(),
  };
}

function findBestCachedMapResult(lat, lon, radiusM, options = {}) {
  const storage = getCacheStorage(options.storage);
  if (!storage) return null;
  const now = options.now ?? Date.now();
  let keys = [];
  try { keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(key => key?.startsWith(MAP_CACHE_PREFIX)); } catch { return null; }
  const requestedPoint = { lat, lon };
  const maxCentreOffsetM = Math.max(150, Math.min(500, radiusM * 0.3));
  const records = keys.map(key => {
    const record = parseCacheRecord(storage, key, now);
    if (!record) return null;
    const keyParts = key.slice(MAP_CACHE_PREFIX.length).split(':');
    const savedLat = Number(keyParts[0]);
    const savedLon = Number(keyParts[1]);
    const savedRadius = Number(keyParts[2]);
    if (!Number.isFinite(savedLat) || !Number.isFinite(savedLon) || !Number.isFinite(savedRadius)) return null;
    const centreOffsetM = haversineMeters(requestedPoint, { lat: savedLat, lon: savedLon });
    if (centreOffsetM > maxCentreOffsetM) return null;
    return { ...record, savedLat, savedLon, savedRadius, centreOffsetM };
  }).filter(Boolean);
  records.sort((a, b) => a.centreOffsetM - b.centreOffsetM || Math.abs(a.savedRadius - radiusM) - Math.abs(b.savedRadius - radiusM) || a.ageMs - b.ageMs);
  if (!records.length) return null;
  const record = records[0];
  return {
    ...record.result,
    cacheHit: true,
    staleCache: record.ageMs > MAP_CACHE_FRESH_TTL_MS,
    cacheAgeMs: record.ageMs,
    cacheSavedAt: new Date(record.savedAt).toISOString(),
    cacheSourceRadiusM: record.result.radiusM,
    cacheSourceOffsetM: record.centreOffsetM,
    requestedRadiusM: radiusM,
    requestedCoordinates: { lat, lon },
  };
}

function writeMapCache(key, result, options = {}) {
  const storage = getCacheStorage(options.storage);
  if (!storage) return false;
  try {
    const prefix = MAP_CACHE_PREFIX;
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter(item => item?.startsWith(prefix));
    if (!keys.includes(key) && keys.length >= MAP_CACHE_MAX_ENTRIES) {
      const oldest = keys.map(item => ({ key: item, savedAt: Number(JSON.parse(storage.getItem(item) || '{}').savedAt) || 0 }))
        .sort((a, b) => a.savedAt - b.savedAt)[0];
      if (oldest) storage.removeItem(oldest.key);
    }
    storage.setItem(key, JSON.stringify({ savedAt: options.now ?? Date.now(), result }));
    return true;
  } catch {
    // Storage can be disabled or full. A map lookup should still succeed.
    return false;
  }
}

function delay(ms, sleep = defaultSleep) {
  return sleep(ms);
}

function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function mapServiceError(error) {
  let message;
  if (error?.status === 429) {
    message = 'All available public map providers are rate-limiting or unavailable. Wait at least 30 seconds before trying again. Previously saved map results will be shown automatically when available.';
  } else if (error?.name === 'AbortError' || error?.code === 'ETIMEDOUT') {
    message = 'The map providers did not finish this request in time. Smaller-radius retries and saved / imported map-data fallback are enabled for this search.';
  } else if ([502, 503, 504].includes(error?.status)) {
    message = 'The public map providers are temporarily overloaded. Smaller-radius retries and partial-result preservation are enabled for this search.';
  } else {
    message = `Could not reach the public map-data providers. Check your internet connection or try again later. ${error?.message || ''}`.trim();
  }
  const mapped = new Error(message);
  mapped.status = error?.status;
  mapped.cause = error;
  mapped.retryable = error?.status === 429 ? false : (error?.name === 'AbortError' || error?.code === 'ETIMEDOUT' || [502, 503, 504].includes(error?.status) || error instanceof TypeError || !error?.status);
  mapped.attemptedEndpoints = error?.attemptedEndpoints || [];
  return mapped;
}

export async function fetchOverpass(query, onProgress, options = {}) {
  const endpoints = options.endpoints || getConfiguredOverpassEndpoints(options.customEndpoint);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? OVERPASS_REQUEST_TIMEOUT_MS;
  if (typeof fetchImpl !== 'function') throw new Error('This browser does not support network requests needed for map lookup.');
  if (!endpoints.length) throw new Error('No map-data providers are configured.');

  // Race independent public endpoints instead of waiting 12 seconds on each one.
  // The first valid response wins; remaining requests are cancelled immediately.
  onProgress?.(`Checking ${endpoints.length} map sources at the same time…`);
  const controllers = endpoints.map(() => new AbortController());
  const attemptedEndpoints = [...endpoints];
  const requests = endpoints.map(async (endpoint, index) => {
    const controller = controllers[index];
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({ data: query }),
        signal: controller.signal,
        referrerPolicy: 'strict-origin-when-cross-origin',
      });
      if (!response.ok) {
        const error = new Error(`Map-data provider ${new URL(endpoint).host} returned HTTP ${response.status}.`);
        error.status = response.status;
        error.retryAfter = response.headers?.get?.('Retry-After') || null;
        throw error;
      }
      const data = await response.json();
      if (!Array.isArray(data.elements)) throw new Error('The map-data response did not include a feature list.');
      return { ...data, endpoint, attemptedEndpoints };
    } finally {
      clearTimeout(timer);
    }
  });

  try {
    const result = await Promise.any(requests);
    controllers.forEach((controller, index) => {
      if (endpoints[index] !== result.endpoint) controller.abort();
    });
    onProgress?.(`Map data received from ${new URL(result.endpoint).host}.`);
    return result;
  } catch (aggregate) {
    const errors = aggregate?.errors || [aggregate];
    const lastError = errors.find(error => error?.status === 429) || errors.find(error => error?.status) || errors[0] || new Error('No map provider responded.');
    lastError.attemptedEndpoints = attemptedEndpoints;
    throw mapServiceError(lastError);
  }
}

export async function fetchOverpassWithRadiusFallback(queryForRadius, requestedRadiusM, onProgress, options = {}) {
  const radii = options.radiusSequence || radiusFallbackSequence(requestedRadiusM);
  let lastError = null;
  const triedRadii = [];
  for (let index = 0; index < radii.length; index += 1) {
    const radiusM = radii[index];
    triedRadii.push(radiusM);
    try {
      if (index > 0) onProgress?.(`The ${triedRadii[index - 1]} m map search did not finish. Retrying this dataset at ${radiusM} m…`);
      const response = await fetchOverpass(queryForRadius(radiusM), onProgress, options);
      return { ...response, radiusUsed: radiusM, requestedRadiusM, fallbackRadiiTried: triedRadii };
    } catch (error) {
      lastError = error;
      if (!error?.retryable || index === radii.length - 1) break;
      onProgress?.(`Map search at ${radiusM} m failed. Preparing a smaller-radius retry…`);
    }
  }
  if (lastError) {
    lastError.radiiTried = triedRadii;
    throw lastError;
  }
  throw new Error('No map search radius was available.');
}

function mergeUniqueById(primary = [], secondary = []) {
  return [...new Map([...primary, ...secondary].map(item => [item.id, item])).values()];
}

function cacheFallbackResult(cached, liveError, requestedRadiusM) {
  return {
    ...cached,
    cacheHit: true,
    staleCache: true,
    liveLookupFailed: true,
    requestedRadiusM,
    mapLookupError: liveError?.message || 'Live map lookup failed.',
    contextLookupWarning: cached.contextLookupWarning || 'Live map data could not be refreshed; surrounding features are from the saved map result.',
  };
}

export async function lookupNearbyWater(inputCoords, radiusM = 1500, onProgress, options = {}) {
  const lat = Number(inputCoords?.lat);
  const lon = Number(inputCoords?.lon);
  const radius = Math.round(Number(radiusM));
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error('Latitude or longitude is invalid.');
  }
  if (![500, 1000, 1500, 3000, 5000].includes(radius)) throw new Error('Choose a search radius between 500 m and 5 km from the available options.');

  const cacheKey = cacheKeyFor(lat, lon, radius);
  const inputPoint = { lat, lon };
  const offline = await getOfflineMapFeaturesNearby(inputPoint, radius, { storage: options.offlineStorage });
  const mergeOffline = result => {
    const waterBodies = mergeUniqueById(offline.waterBodies || [], result.waterBodies || []);
    const contextFeatures = mergeUniqueById(offline.contextFeatures || [], result.contextFeatures || []);
    return {
      ...result,
      waterBodies,
      contextFeatures,
      offlineLayersAvailable: offline.layers.length,
      offlineFeaturesIncluded: (offline.waterBodies.length + offline.contextFeatures.length),
      offlineLayerNames: offline.layers.map(layer => layer.name),
      featureCount: waterBodies.length + contextFeatures.length,
    };
  };

  if (options.offlineOnly) {
    if (!offline.waterBodies.length && !offline.contextFeatures.length) {
      throw new Error('No imported offline map features were found within this search radius. Import a GeoJSON or Overpass JSON file first, or increase the radius.');
    }
    return mergeOffline({
      coordinates: inputPoint,
      requestedCoordinates: inputPoint,
      radiusM: radius,
      requestedRadiusM: radius,
      queriedAt: new Date(options.now ?? Date.now()).toISOString(),
      waterBodies: [],
      contextFeatures: [],
      contextLookupWarning: null,
      contextIsCached: false,
      contextDataQueriedAt: null,
      contextDataRadiusM: radius,
      featureCount: 0,
      source: 'Imported offline map files',
      endpointsUsed: {},
      providersTried: {},
      cacheHit: false,
      staleCache: true,
      offlineDataOnly: true,
      offlineSearchOnly: true,
      mapLookupError: null,
      mapUrl: `https://www.openstreetmap.org/#map=16/${lat.toFixed(6)}/${lon.toFixed(6)}`,
    });
  }
  const freshCached = options.forceRefresh ? null : readMapCache(cacheKey, { storage: options.storage, now: options.now });
  if (freshCached && !freshCached.contextLookupWarning && !freshCached.contextIsCached) {
    onProgress?.('Showing a recent saved map result and checking imported offline layers. Use Refresh live data to request an update.');
    return mergeOffline(freshCached);
  }

  let lastKnown = findBestCachedMapResult(lat, lon, radius, { storage: options.storage, now: options.now });
  if (!lastKnown) {
    try {
      const snapshots = await loadPersistentMapSnapshots({ storage: options.storage });
      const candidates = snapshots.map(record => {
        const result = record?.result;
        const point = result?.coordinates;
        if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon) || !Number.isFinite(record.savedAt)) return null;
        const ageMs = Math.max(0, (options.now ?? Date.now()) - record.savedAt);
        if (ageMs > MAP_CACHE_MAX_STALE_MS) return null;
        const centreOffsetM = haversineMeters(inputPoint, point);
        if (centreOffsetM > Math.max(150, Math.min(500, radius * 0.3))) return null;
        return { ...record, ageMs, centreOffsetM };
      }).filter(Boolean).sort((a, b) => a.centreOffsetM - b.centreOffsetM || a.ageMs - b.ageMs);
      if (candidates.length) {
        const match = candidates[0];
        lastKnown = {
          ...match.result,
          cacheHit: true,
          staleCache: match.ageMs > MAP_CACHE_FRESH_TTL_MS,
          cacheAgeMs: match.ageMs,
          cacheSavedAt: new Date(match.savedAt).toISOString(),
          cacheSourceOffsetM: match.centreOffsetM,
          requestedCoordinates: inputPoint,
          requestedRadiusM: radius,
        };
      }
    } catch { /* Existing localStorage cache and offline imports remain available. */ }
  }

  const queriedAt = new Date(options.now ?? Date.now()).toISOString();
  const fetchOptions = {
    endpoints: options.endpoints,
    customEndpoint: options.customEndpoint,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    sleep: options.sleep,
  };

  let waterData;
  onProgress?.('Searching for nearby rivers, lakes, ponds, reservoirs and wetlands…');
  try {
    waterData = await fetchOverpassWithRadiusFallback(
      searchRadius => makeQuery(lat.toFixed(6), lon.toFixed(6), searchRadius),
      radius,
      message => onProgress?.(`Waterbody search: ${message}`),
      fetchOptions,
    );
  } catch (error) {
    if (lastKnown) {
      onProgress?.('Live map providers are unavailable. Restoring saved map information…');
      return mergeOffline(cacheFallbackResult(lastKnown, error, radius));
    }
    if (offline.waterBodies.length || offline.contextFeatures.length) {
      onProgress?.('Live map providers are unavailable. Showing imported offline map information.');
      const offlineResult = {
        coordinates: inputPoint,
        requestedCoordinates: inputPoint,
        radiusM: radius,
        requestedRadiusM: radius,
        queriedAt,
        waterBodies: [],
        contextFeatures: [],
        contextLookupWarning: 'Live map lookup failed. The displayed features come from imported offline map files.',
        contextIsCached: true,
        contextDataQueriedAt: null,
        contextDataRadiusM: radius,
        featureCount: 0,
        source: 'Imported offline map files',
        endpointsUsed: {},
        providersTried: {},
        cacheHit: false,
        staleCache: true,
        offlineDataOnly: true,
        mapLookupError: error.message,
        mapUrl: `https://www.openstreetmap.org/#map=16/${lat.toFixed(6)}/${lon.toFixed(6)}`,
      };
      return mergeOffline(offlineResult);
    }
    throw error;
  }

  const waterBodies = (waterData.elements || [])
    .map(element => normalizeElement(element, inputPoint)).filter(Boolean)
    .filter(item => isWaterFeature(item.tags))
    .sort((a, b) => a.distanceM - b.distanceM);

  let builtEnvironmentData = { elements: [] };
  let contextLookupWarning = null;
  let contextEndpoint = null;
  onProgress?.('Waterbody search complete. Searching nearby buildings, roads, drains, bridges and utilities separately…');
  try {
    builtEnvironmentData = await fetchOverpassWithRadiusFallback(
      searchRadius => makeBuiltEnvironmentQuery(lat.toFixed(6), lon.toFixed(6), searchRadius),
      waterData.radiusUsed || radius,
      message => onProgress?.(`Infrastructure search: ${message}`),
      fetchOptions,
    );
    contextEndpoint = builtEnvironmentData.endpoint;
  } catch (error) {
    contextLookupWarning = error instanceof Error ? error.message : 'Nearby building and infrastructure data could not be loaded.';
  }

  const liveContext = (builtEnvironmentData.elements || [])
    .map(element => normalizeElement(element, inputPoint)).filter(Boolean)
    .map(item => ({ ...item, context: contextInfo(item.tags) }))
    .filter(item => item.context)
    .sort((a, b) => a.distanceM - b.distanceM);

  // An infrastructure timeout never discards successfully retrieved waterbody data.
  const contextFeatures = contextLookupWarning && lastKnown?.contextFeatures?.length
    ? mergeUniqueById(lastKnown.contextFeatures, liveContext)
    : liveContext;
  const contextIsCached = Boolean(contextLookupWarning && lastKnown?.contextFeatures?.length);
  const uniqueWater = [...new Map(waterBodies.map(item => [item.id, item])).values()];
  const uniqueContext = [...new Map(contextFeatures.map(item => [item.id, item])).values()];
  const result = mergeOffline({
    coordinates: inputPoint,
    requestedCoordinates: inputPoint,
    radiusM: waterData.radiusUsed || radius,
    requestedRadiusM: radius,
    queriedAt,
    waterBodies: uniqueWater,
    contextFeatures: uniqueContext,
    contextLookupWarning,
    contextIsCached,
    contextDataQueriedAt: contextIsCached ? (lastKnown.contextDataQueriedAt || lastKnown.queriedAt) : queriedAt,
    contextDataRadiusM: contextIsCached ? (lastKnown.contextDataRadiusM || lastKnown.radiusM) : (builtEnvironmentData.radiusUsed || waterData.radiusUsed || radius),
    contextRequestedRadiusM: waterData.radiusUsed || radius,
    waterFallbackRadiiTried: waterData.fallbackRadiiTried || [radius],
    contextFallbackRadiiTried: builtEnvironmentData.fallbackRadiiTried || [],
    featureCount: uniqueWater.length + uniqueContext.length,
    source: 'OpenStreetMap via Overpass API, with imported offline layers where available',
    endpointsUsed: { water: waterData.endpoint, context: contextEndpoint || (contextIsCached ? lastKnown.endpointsUsed?.context : null) },
    providersTried: { water: waterData.attemptedEndpoints || [], context: builtEnvironmentData.attemptedEndpoints || [] },
    cacheHit: false,
    staleCache: false,
    mapUrl: `https://www.openstreetmap.org/#map=16/${lat.toFixed(6)}/${lon.toFixed(6)}`,
  });

  // Persist both in the compatible localStorage cache and in the IndexedDB map database.
  if (!contextIsCached) writeMapCache(cacheKey, result, { storage: options.storage, now: options.now });
  try { await savePersistentMapSnapshot(cacheKey, result, options.now ?? Date.now(), { storage: options.storage }); } catch { /* Map lookup should not fail because persistence is unavailable. */ }
  return result;
}

export function buildWaterBodyExplanation(feature, contextFeatures = [], radiusM = 1500) {
  if (!feature) return 'No mapped water body was found in the selected search radius. This does not prove that no water body exists; map coverage and feature tagging vary by location.';
  // Overpass has already filtered these features by their mapped geometry. A large polygon
  // can have a representative centre outside the radius, so do not filter it by centre distance.
  const nearbyContext = contextFeatures;
  const sourceLike = nearbyContext.filter(item => /drain|ditch|wastewater|industrial|waste-disposal|agricultural/i.test(item.context?.label || ''));
  const providerLabel = feature.providerLabel || feature.tags?.source_provider || (feature.offlineImported ? 'Imported map data' : 'OpenStreetMap');
  const isPlaceSearch = /Google Maps|Apple Maps/i.test(providerLabel);
  const clauses = [isPlaceSearch
    ? `${providerLabel} returned “${feature.name}” as a nearby ${feature.kind.toLowerCase()} search candidate, about ${formatDistance(feature.distanceM)} from the coordinates you supplied. This is a place-search result, not a surveyed waterbody boundary.`
    : `${providerLabel} identifies this feature as a ${feature.kind.toLowerCase()}${feature.name && !/^Unnamed/.test(feature.name) ? ` named “${feature.name}”` : ''}. Its representative mapped point is about ${formatDistance(feature.distanceM)} from the coordinates you supplied.`];
  if (sourceLike.length) {
    clauses.push(`${providerLabel} also returned ${sourceLike.length} nearby place result(s) worth checking in a local survey, such as ${sourceLike.slice(0, 3).map(item => `${item.context.label.toLowerCase()} (${formatDistance(item.distanceM)} away)`).join(', ')}. These are contextual clues, not proof that any feature is discharging pollutants.`);
  } else {
    clauses.push('No matching industrial, wastewater, drainage, or agricultural context results were returned in this search. Provider coverage and search matching are incomplete; this does not establish that these features are absent.');
  }
  clauses.push('A location lookup cannot determine pH, turbidity, microbes, dissolved chemicals, toxicity, or whether the water is safe. That requires current measurements and, for health or regulatory decisions, suitable laboratory testing.');
  return clauses.join(' ');
}

export function formatDistance(distanceM) {
  if (!Number.isFinite(distanceM)) return 'unknown distance';
  return distanceM < 1000 ? `${Math.round(distanceM)} m` : `${(distanceM / 1000).toFixed(2)} km`;
}
