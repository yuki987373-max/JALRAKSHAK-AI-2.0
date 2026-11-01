import { contextInfo, isWaterFeature, waterFeatureKind } from './locationWaterLookup.js';
import { loadOfflineMapLayers, saveOfflineMapLayer, savePersistentMapSnapshot } from './mapDataStore.js';

function collectCoordinatePairs(value, output = []) {
  if (!Array.isArray(value)) return output;
  if (value.length >= 2 && Number.isFinite(Number(value[0])) && Number.isFinite(Number(value[1]))) {
    output.push([Number(value[0]), Number(value[1])]);
    return output;
  }
  for (const child of value) collectCoordinatePairs(child, output);
  return output;
}

function representativePoint(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'GeometryCollection') {
    const points = (geometry.geometries || []).flatMap(item => collectCoordinatePairs(item.coordinates, []));
    return pointFromPairs(points);
  }
  return pointFromPairs(collectCoordinatePairs(geometry.coordinates, []));
}

function pointFromPairs(pairs) {
  if (!pairs.length) return null;
  // Iteration avoids argument-spread limits for large imported polygons/lines.
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const pair of pairs) {
    const lon = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  // Bounding-box centre is a stable representative point for lines and polygons.
  const lon = (minLon + maxLon) / 2;
  const lat = (minLat + maxLat) / 2;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function tagsSummary(tags = {}) {
  const keys = ['name', 'natural', 'water', 'waterway', 'landuse', 'building', 'highway', 'bridge', 'railway', 'man_made', 'amenity', 'industrial', 'description'];
  return keys.filter(key => tags[key] != null && String(tags[key]) !== '').map(key => ({ key, value: String(tags[key]) }));
}

function normalizeFeature({ id, type = 'feature', point, tags = {}, layerName }) {
  if (!point) return null;
  const water = isWaterFeature(tags);
  const context = contextInfo(tags);
  if (!water && !context) return null;
  const name = tags.name || tags['name:en'] || tags.ref || `Unnamed ${water ? waterFeatureKind(tags).toLowerCase() : context.label.toLowerCase()}`;
  const osmType = type || 'feature';
  return {
    id: String(id || `${osmType}/${Math.random().toString(36).slice(2, 10)}`),
    osmType,
    osmId: String(id || '').split('/').pop() || null,
    name: String(name),
    kind: water ? waterFeatureKind(tags) : (context?.label || 'Mapped feature'),
    lat: point.lat,
    lon: point.lon,
    tags,
    tagSummary: tagsSummary(tags),
    mapUrl: `https://www.openstreetmap.org/?mlat=${point.lat.toFixed(6)}&mlon=${point.lon.toFixed(6)}#map=16/${point.lat.toFixed(6)}/${point.lon.toFixed(6)}`,
    context: water ? null : context,
    isWaterBody: water,
    offlineLayerName: layerName || null,
    offlineImported: true,
  };
}

function normalizeOverpassElement(element, layerName) {
  const point = Number.isFinite(element?.lat) && Number.isFinite(element?.lon)
    ? { lat: Number(element.lat), lon: Number(element.lon) }
    : Number.isFinite(element?.center?.lat) && Number.isFinite(element?.center?.lon)
      ? { lat: Number(element.center.lat), lon: Number(element.center.lon) }
      : element?.geometry?.length
        ? pointFromPairs(element.geometry.map(point => [point.lon, point.lat]).filter(pair => pair.every(Number.isFinite)))
        : null;
  return normalizeFeature({
    id: `${element?.type || 'feature'}/${element?.id ?? Math.random().toString(36).slice(2, 10)}`,
    type: element?.type || 'feature',
    point,
    tags: element?.tags || {},
    layerName,
  });
}

export function parseOfflineMapData(text, fileName = 'offline-map-data.json', importedAt = new Date().toISOString()) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('The selected map file is empty.');
  if (text.length > 50 * 1024 * 1024) throw new Error('The map file is larger than 50 MB. Split it into smaller GeoJSON or Overpass JSON files.');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('Unsupported offline map file. Use GeoJSON or Overpass JSON.'); }

  const layerName = String(fileName || 'Imported map data').slice(0, 120);
  let features = [];
  let sourceFormat = '';
  if (parsed?.type === 'FeatureCollection' && Array.isArray(parsed.features)) {
    sourceFormat = 'GeoJSON FeatureCollection';
    features = parsed.features.map((feature, index) => {
      const properties = feature?.properties || {};
      const tags = properties.tags && typeof properties.tags === 'object' ? { ...properties, ...properties.tags } : properties;
      const rawId = properties['@id'] || properties.osm_id || feature.id || `geojson/${index + 1}`;
      const type = properties.osm_type || properties.type || String(rawId).split('/')[0] || 'feature';
      const id = String(rawId).includes('/') ? String(rawId) : `${type}/${rawId}`;
      return normalizeFeature({ id, type, point: representativePoint(feature.geometry), tags, layerName });
    }).filter(Boolean);
  } else if (parsed?.type === 'Feature') {
    sourceFormat = 'GeoJSON Feature';
    const properties = parsed.properties || {};
    const tags = properties.tags && typeof properties.tags === 'object' ? { ...properties, ...properties.tags } : properties;
    const id = properties['@id'] || parsed.id || `geojson/${Date.now()}`;
    features = [normalizeFeature({ id: String(id).includes('/') ? id : `feature/${id}`, point: representativePoint(parsed.geometry), tags, layerName })].filter(Boolean);
  } else if (Array.isArray(parsed?.elements)) {
    sourceFormat = 'Overpass JSON';
    features = parsed.elements.map(element => normalizeOverpassElement(element, layerName)).filter(Boolean);
  } else {
    throw new Error('Unsupported map structure. Import a GeoJSON FeatureCollection/Feature or an Overpass JSON export containing an elements array.');
  }

  const unique = [...new Map(features.map(feature => [feature.id, feature])).values()];
  if (unique.length > 25000) throw new Error('This file contains more than 25,000 recognized features. Split it into smaller local areas for better performance.');
  if (!unique.length) throw new Error('No recognized waterbody or mapped infrastructure features were found in this file. Check that the file contains geometry and useful OSM-style tags.');
  return {
    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: layerName,
    sourceFormat,
    importedAt,
    featureCount: unique.length,
    waterBodyCount: unique.filter(feature => feature.isWaterBody).length,
    contextCount: unique.filter(feature => !feature.isWaterBody).length,
    features: unique,
  };
}

export async function importOfflineMapFile(file, options = {}) {
  if (!file || typeof file.text !== 'function') throw new Error('Choose a GeoJSON, Overpass JSON, or JalRakshak map backup file.');
  const text = await file.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* The parser below will return a useful format error. */ }
  if (parsed?.format === 'jalrakshak-map-database' && Array.isArray(parsed.offlineLayers)) {
    let featureCount = 0;
    for (const layer of parsed.offlineLayers) {
      if (layer?.id && Array.isArray(layer.features)) {
        await saveOfflineMapLayer(layer, options);
        featureCount += layer.features.length;
      }
    }
    let snapshotCount = 0;
    for (const snapshot of parsed.snapshots || []) {
      if (snapshot?.key && snapshot?.result && Number.isFinite(snapshot.savedAt)) {
        await savePersistentMapSnapshot(snapshot.key, snapshot.result, snapshot.savedAt, options);
        snapshotCount += 1;
      }
    }
    return {
      name: file.name || 'JalRakshak map database backup',
      featureCount,
      waterBodyCount: parsed.offlineLayers.reduce((sum, layer) => sum + (Number(layer.waterBodyCount) || 0), 0),
      contextCount: parsed.offlineLayers.reduce((sum, layer) => sum + (Number(layer.contextCount) || 0), 0),
      layersImported: parsed.offlineLayers.length,
      snapshotsImported: snapshotCount,
      sourceFormat: 'JalRakshak map database backup',
    };
  }
  const layer = parseOfflineMapData(text, file.name || 'Offline map data');
  await saveOfflineMapLayer(layer, options);
  return { ...layer, layersImported: 1, snapshotsImported: 0 };
}

function haversineMeters(a, b) {
  const rad = value => value * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export async function getOfflineMapFeaturesNearby(point, radiusM, options = {}) {
  const layers = await loadOfflineMapLayers(options);
  const waterBodies = [];
  const contextFeatures = [];
  for (const layer of layers) {
    for (const feature of layer.features || []) {
      if (!Number.isFinite(feature.lat) || !Number.isFinite(feature.lon)) continue;
      const distanceM = haversineMeters(point, { lat: feature.lat, lon: feature.lon });
      if (distanceM > radiusM) continue;
      const enriched = { ...feature, distanceM, offlineLayerName: layer.name, offlineImported: true, offlineImportedAt: layer.importedAt };
      if (feature.isWaterBody) waterBodies.push(enriched);
      else if (feature.context) contextFeatures.push(enriched);
    }
  }
  return {
    layers,
    waterBodies: [...new Map(waterBodies.map(item => [item.id, item])).values()].sort((a, b) => a.distanceM - b.distanceM),
    contextFeatures: [...new Map(contextFeatures.map(item => [item.id, item])).values()].sort((a, b) => a.distanceM - b.distanceM),
  };
}
