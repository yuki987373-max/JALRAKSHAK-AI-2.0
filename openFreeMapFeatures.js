import { contextInfo, formatDistance, haversineMeters, waterFeatureKind } from './locationWaterLookup.js';

export const OPEN_FREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const MAX_SEARCH_RADIUS_M = 5000;
export const OPEN_FREEMAP_ATTRIBUTION = '© OpenStreetMap contributors · Map tiles and styles: OpenFreeMap';

export function clampSearchRadius(radiusM) {
  const value = Number(radiusM);
  if (!Number.isFinite(value)) return MAX_SEARCH_RADIUS_M;
  return Math.min(MAX_SEARCH_RADIUS_M, Math.max(100, Math.round(value)));
}

export function buildSearchBounds(center, radiusM) {
  const radius = clampSearchRadius(radiusM);
  const latDelta = radius / 111320;
  const cosLat = Math.max(0.15, Math.cos((center.lat * Math.PI) / 180));
  const lonDelta = radius / (111320 * cosLat);
  return [
    [center.lon - lonDelta, center.lat - latDelta],
    [center.lon + lonDelta, center.lat + latDelta],
  ];
}

function coordinatePairs(geometry) {
  const pairs = [];
  const visit = value => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
      pairs.push([Number(value[0]), Number(value[1])]);
      return;
    }
    for (const child of value) visit(child);
  };
  visit(geometry?.coordinates);
  return pairs;
}

export function representativePointForGeometry(geometry) {
  const points = coordinatePairs(geometry);
  if (!points.length) return null;
  // This is a representative point from the visible vector-tile geometry,
  // not a surveyed centroid or nearest-edge calculation.
  const sum = points.reduce((acc, point) => [acc[0] + point[0], acc[1] + point[1]], [0, 0]);
  const lon = sum[0] / points.length;
  const lat = sum[1] / points.length;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

function classifyTileFeature(feature) {
  const sourceLayer = String(feature?.sourceLayer || feature?.layer?.['source-layer'] || '').toLowerCase();
  const properties = feature?.properties || {};
  const classValue = String(properties.class || '').toLowerCase();
  const subclass = String(properties.subclass || '').toLowerCase();
  const type = String(properties.type || '').toLowerCase();
  const descriptor = `${classValue} ${subclass} ${type}`;

  if (sourceLayer === 'water' || sourceLayer === 'water_name' || sourceLayer === 'waterway_name') return { group: 'water', label: 'Mapped water body' };
  if (sourceLayer === 'waterway') {
    if (/drain|ditch|sewer|culvert/.test(descriptor)) return { group: 'context', label: 'Mapped drainage / sewer feature' };
    if (/river|stream|canal|tidal_channel|waterway/.test(descriptor) || !descriptor.trim()) return { group: 'water', label: 'Mapped waterway' };
    return { group: 'context', label: 'Mapped waterway infrastructure' };
  }
  if (sourceLayer === 'building') return { group: 'context', label: 'Mapped building' };
  if (sourceLayer === 'transportation') {
    if (String(properties.brunnel || '').toLowerCase() === 'bridge') return { group: 'context', label: 'Mapped bridge / crossing' };
    if (/rail|subway|tram|monorail|light_rail/.test(descriptor)) return { group: 'context', label: 'Mapped railway / transit corridor' };
    return { group: 'context', label: 'Mapped road / transport corridor' };
  }
  if (sourceLayer === 'landuse') {
    if (/industrial|commercial|retail|quarry|landfill|garages/.test(descriptor)) return { group: 'context', label: 'Mapped industrial / commercial land use' };
    if (/farmland|farmyard|orchard|vineyard|plant_nursery|allotments/.test(descriptor)) return { group: 'context', label: 'Mapped agricultural land use' };
    if (/residential/.test(descriptor)) return { group: 'context', label: 'Mapped residential land use' };
    return { group: 'context', label: 'Mapped land-use area' };
  }
  if (sourceLayer === 'park') return { group: 'context', label: 'Mapped green space / park' };
  if (sourceLayer === 'poi') {
    if (/wastewater|sewage|waste_disposal|recycling|landfill/.test(descriptor)) return { group: 'context', label: 'Mapped waste / wastewater facility' };
    if (/industrial|factory|works|power_plant/.test(descriptor)) return { group: 'context', label: 'Mapped industrial / utility facility' };
    if (/water|reservoir|dam|pump/.test(descriptor)) return { group: 'context', label: 'Mapped water infrastructure / facility' };
    return { group: 'context', label: 'Mapped point of interest' };
  }
  if (sourceLayer === 'aeroway') return { group: 'context', label: 'Mapped aviation infrastructure' };
  if (sourceLayer === 'railway') return { group: 'context', label: 'Mapped railway infrastructure' };
  if (sourceLayer === 'place') return { group: 'context', label: 'Mapped settlement / place' };
  return null;
}

function toOsmLikeTags(feature, classification) {
  const properties = feature?.properties || {};
  const sourceLayer = String(feature?.sourceLayer || feature?.layer?.['source-layer'] || '').toLowerCase();
  const tags = {};
  for (const key of ['name', 'name:en', 'description', 'wikidata', 'wikipedia', 'operator', 'height', 'render_height', 'surface', 'intermittent', 'seasonal', 'brunnel', 'class', 'subclass', 'type']) {
    if (properties[key] != null && properties[key] !== '') tags[key] = String(properties[key]);
  }
  if (sourceLayer === 'water' || sourceLayer === 'water_name' || sourceLayer === 'waterway_name') {
    tags.natural = 'water';
    if (properties.class) tags.water = String(properties.class);
  } else if (sourceLayer === 'waterway') {
    tags.waterway = String(properties.class || properties.subclass || 'waterway');
  } else if (sourceLayer === 'building') {
    tags.building = String(properties.class || 'yes');
    if (properties.render_height != null) tags.height = String(properties.render_height);
  } else if (sourceLayer === 'landuse') {
    tags.landuse = String(properties.class || properties.subclass || 'mapped');
  } else if (sourceLayer === 'transportation') {
    if (/rail|subway|tram/.test(String(properties.class || properties.subclass || ''))) tags.railway = String(properties.subclass || properties.class);
    else tags.highway = String(properties.class || properties.subclass || 'road');
    if (properties.brunnel === 'bridge') tags.bridge = 'yes';
  } else if (sourceLayer === 'poi') {
    const value = String(properties.subclass || properties.class || 'facility');
    if (/wastewater|sewage/.test(value)) tags.amenity = 'wastewater_plant';
    else if (/waste_disposal|landfill/.test(value)) tags.amenity = 'waste_disposal';
    else if (/industrial|factory|power_plant/.test(value)) tags.industrial = value;
    else tags.amenity = value;
  } else if (sourceLayer === 'park') {
    tags.leisure = String(properties.class || 'park');
  } else if (sourceLayer === 'place') {
    tags.place = String(properties.class || 'locality');
  }
  if (classification?.label) tags.map_feature_category = classification.label;
  return tags;
}

function featureStableId(feature, point, sourceLayer, tags) {
  const properties = feature?.properties || {};
  const rawId = properties.osm_id ?? properties.id ?? feature?.id;
  if (rawId != null) return `openfreemap:${sourceLayer}:${String(rawId)}`;
  const name = String(tags.name || 'unnamed').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 36);
  return `openfreemap:${sourceLayer}:${name}:${point.lat.toFixed(5)}:${point.lon.toFixed(5)}`;
}

export function normalizeOpenFreeMapFeature(feature, center, radiusM = MAX_SEARCH_RADIUS_M, clickedPoint = null) {
  const classification = classifyTileFeature(feature);
  if (!classification) return null;
  const sourceLayer = String(feature?.sourceLayer || feature?.layer?.['source-layer'] || '').toLowerCase();
  const geometryPoint = representativePointForGeometry(feature?.geometry);
  const safeRadius = clampSearchRadius(radiusM);
  const click = clickedPoint && Number.isFinite(Number(clickedPoint.lat)) && Number.isFinite(Number(clickedPoint.lon))
    ? { lat: Number(clickedPoint.lat), lon: Number(clickedPoint.lon) }
    : null;
  // A rendered vector-tile feature may not expose its full geometry. For a
  // deliberate user click, use that clicked map coordinate as the inspection
  // point rather than enumerating or retaining other tile features.
  const geometryWithinRadius = geometryPoint && haversineMeters(center, geometryPoint) <= safeRadius;
  const point = geometryWithinRadius ? geometryPoint : click;
  if (!point) return null;
  const distanceM = haversineMeters(center, point);
  if (distanceM > safeRadius) return null;
  const tags = toOsmLikeTags(feature, classification);
  const rawName = tags.name || tags['name:en'];
  const name = rawName || `${classification.label} (${Math.round(distanceM)} m)`;
  const isWaterBody = classification.group === 'water';
  const context = isWaterBody ? null : (contextInfo(tags) || {
    label: classification.label,
    category: 'mapped-context',
    explanation: `${classification.label} shown in the OpenFreeMap vector tiles. Check field conditions and authoritative local records before drawing conclusions about its connection to or effect on the waterbody. Map presence alone does not establish contamination.`,
  });
  const tagSummary = Object.entries(tags)
    .filter(([key, value]) => key !== 'name' && value != null && String(value).trim())
    .slice(0, 12)
    .map(([key, value]) => ({ key, value: String(value) }));
  const id = featureStableId(feature, point, sourceLayer, tags);
  return {
    id,
    osmType: 'vector-tile-feature',
    osmId: feature?.properties?.osm_id ?? feature?.properties?.id ?? feature?.id ?? null,
    name,
    kind: isWaterBody ? waterFeatureKind(tags) : classification.label,
    lat: point.lat,
    lon: point.lon,
    distanceM,
    tags,
    tagSummary,
    mapUrl: `https://www.openstreetmap.org/?mlat=${point.lat.toFixed(6)}&mlon=${point.lon.toFixed(6)}#map=17/${point.lat.toFixed(6)}/${point.lon.toFixed(6)}`,
    isWaterBody,
    context,
    provider: 'openfreemap',
    providerLabel: 'OpenFreeMap / MapLibre',
    sourceLayer,
    verificationNote: 'Detected from currently rendered OpenFreeMap vector tiles. Coverage depends on mapping detail and zoom level. This is not a complete infrastructure survey or a water-quality measurement.',
    mapFeatureSource: 'OpenFreeMap vector tiles based on OpenStreetMap data',
  };
}

export function normalizeRenderedMapFeatures(renderedFeatures, center, radiusM = MAX_SEARCH_RADIUS_M, limit = 300) {
  const unique = new Map();
  for (const feature of Array.isArray(renderedFeatures) ? renderedFeatures : []) {
    const normalized = normalizeOpenFreeMapFeature(feature, center, radiusM);
    if (normalized && !unique.has(normalized.id)) unique.set(normalized.id, normalized);
    if (unique.size >= Math.max(1, Math.min(1000, Number(limit) || 300))) break;
  }
  return [...unique.values()].sort((a, b) => a.distanceM - b.distanceM);
}

export function buildOpenFreeMapUrl(center, zoom = 13) {
  return `https://www.openstreetmap.org/?mlat=${Number(center.lat).toFixed(6)}&mlon=${Number(center.lon).toFixed(6)}#map=${zoom}/${Number(center.lat).toFixed(6)}/${Number(center.lon).toFixed(6)}`;
}

export function buildOpenFreeMapSummary(scan, radiusM) {
  return `Scanned currently rendered map features inside ${formatDistance(clampSearchRadius(radiusM))} of the selected point: ${scan.totalFeatures} mapped feature(s), including ${scan.waterBodies.length} water feature(s) and ${scan.contextFeatures.length} surrounding feature(s). Results depend on the map tiles and zoom level currently loaded.`;
}
