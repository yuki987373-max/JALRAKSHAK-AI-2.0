import { getOfflineMapFeaturesNearby } from './offlineMapData.js';

export const TRUSTED_MAP_SETTINGS_KEY = 'jalrakshak:trusted-map-settings:v2';
let googleScriptPromise = null;
let googleLoadedApiKey = null;
let appleScriptPromise = null;
let appleInitializedToken = null;

export function loadTrustedMapSettings(storage = safeStorage()) {
  try {
    const value = JSON.parse(storage?.getItem(TRUSTED_MAP_SETTINGS_KEY) || '{}');
    return {
      provider: ['google', 'apple', 'auto', 'offline'].includes(value.provider) ? value.provider : 'google',
      googleApiKey: typeof value.googleApiKey === 'string' ? value.googleApiKey : '',
      appleMapKitToken: typeof value.appleMapKitToken === 'string' ? value.appleMapKitToken : '',
    };
  } catch {
    return { provider: 'google', googleApiKey: '', appleMapKitToken: '' };
  }
}

export function saveTrustedMapSettings(settings, storage = safeStorage()) {
  const next = {
    provider: ['google', 'apple', 'auto', 'offline'].includes(settings?.provider) ? settings.provider : 'google',
    googleApiKey: String(settings?.googleApiKey || '').trim(),
    appleMapKitToken: String(settings?.appleMapKitToken || '').trim(),
  };
  if (next.googleApiKey.length > 512) throw new Error('The Google Maps API key is too long.');
  if (next.appleMapKitToken.length > 8192) throw new Error('The Apple MapKit token is too long.');
  if (storage) storage.setItem(TRUSTED_MAP_SETTINGS_KEY, JSON.stringify(next));
  return next;
}

function safeStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function buildGoogleMapsSearchUrl(lat, lon, query = 'water bodies and nearby infrastructure') {
  const params = new URLSearchParams({ api: '1', query: `${query} near ${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}` });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

export function buildAppleMapsSearchUrl(lat, lon, query = 'Water bodies and nearby infrastructure') {
  const params = new URLSearchParams({ ll: `${Number(lat).toFixed(6)},${Number(lon).toFixed(6)}`, q: query });
  return `https://maps.apple.com/?${params.toString()}`;
}

export function haversineDistanceMeters(a, b) {
  const radians = value => value * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function readLatLng(value) {
  if (!value) return null;
  const lat = typeof value.lat === 'function' ? value.lat() : (value.latitude ?? value.lat);
  const lon = typeof value.lng === 'function' ? value.lng() : (value.longitude ?? value.lon ?? value.lng);
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return null;
  const point = { lat: Number(lat), lon: Number(lon) };
  if (point.lat < -90 || point.lat > 90 || point.lon < -180 || point.lon > 180) return null;
  return point;
}

function kindFromName(name, types = []) {
  const text = `${name} ${types.join(' ')}`.toLowerCase();
  if (/reservoir|dam/.test(text)) return 'Reservoir / dam candidate';
  if (/lake/.test(text)) return 'Lake candidate';
  if (/pond/.test(text)) return 'Pond candidate';
  if (/river/.test(text)) return 'River candidate';
  if (/canal/.test(text)) return 'Canal candidate';
  if (/wetland|marsh/.test(text)) return 'Wetland candidate';
  if (/stream|creek/.test(text)) return 'Stream candidate';
  if (/waterfall/.test(text)) return 'Waterfall candidate';
  return 'Mapped natural-water candidate';
}

function categoryForGroup(group) {
  if (group === 'water') return null;
  if (group === 'wastewater') return { label: 'Water / wastewater facility', category: 'water-infrastructure', explanation: 'The map provider returned this as a nearby water or wastewater facility. This is a place-search result, not proof of a discharge, operating condition, or connection to the selected waterbody.' };
  if (group === 'industrial') return { label: 'Industrial facility / area', category: 'industrial', explanation: 'The map provider returned this as a nearby industrial place or area. Verify the facility, permits, activities, drainage route, and monitoring records; proximity alone does not establish contamination.' };
  if (group === 'bridge') return { label: 'Bridge / dam / crossing', category: 'bridge', explanation: 'The map provider returned this as a nearby crossing or water-control place. The result does not provide surveyed geometry or prove any effect on water quality.' };
  return { label: 'Mapped nearby place', category: 'facility', explanation: 'The map provider returned this nearby place record. Confirm its location and function before using it in an environmental assessment.' };
}

export function normalizeTrustedPlace(place, provider, group, center) {
  const point = readLatLng(provider === 'apple' ? place?.coordinate : place?.location);
  if (!point) return null;
  const name = String(provider === 'apple' ? (place.name || place.displayName) : (place.displayName?.text || place.displayName || place.name || 'Unnamed Google Maps place'));
  const address = String(place.formattedAddress || place.formatted_address || 'Address not supplied by map provider');
  const types = Array.isArray(place.types) ? place.types.map(String) : [];
  const primaryType = String(place.primaryType || place.pointOfInterestCategory || 'place');
  const distanceM = haversineDistanceMeters(center, point);
  const isWater = group === 'water';
  const providerLabel = provider === 'apple' ? 'Apple Maps' : 'Google Maps';
  const mapUrl = provider === 'apple'
    ? buildAppleMapsSearchUrl(point.lat, point.lon, name)
    : (place.googleMapsURI || buildGoogleMapsSearchUrl(point.lat, point.lon, name));
  const tags = {
    source_provider: providerLabel,
    provider_type: primaryType,
    formatted_address: address,
    place_types: types.join(', '),
  };
  const tagSummary = [
    { key: 'provider', value: providerLabel },
    { key: 'type', value: primaryType },
    ...(address && address !== 'Address not supplied by map provider' ? [{ key: 'address', value: address }] : []),
  ];
  if (isWater) {
    return {
      id: `${provider}:${place.id || `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`}`,
      osmType: provider,
      osmId: place.id || null,
      provider,
      providerLabel,
      name,
      kind: kindFromName(name, types),
      lat: point.lat,
      lon: point.lon,
      distanceM,
      tags,
      tagSummary,
      mapUrl,
      isWaterBody: true,
      context: null,
      providerAddress: address,
      verificationNote: 'Map search candidate only. Confirm the feature type and boundaries using authoritative local records or field inspection.',
    };
  }
  const category = categoryForGroup(group);
  return {
    id: `${provider}:${place.id || `${point.lat.toFixed(6)},${point.lon.toFixed(6)}`}`,
    osmType: provider,
    osmId: place.id || null,
    provider,
    providerLabel,
    name,
    kind: category?.label || 'Mapped place',
    lat: point.lat,
    lon: point.lon,
    distanceM,
    tags,
    tagSummary,
    mapUrl,
    isWaterBody: false,
    context: category,
    providerAddress: address,
    verificationNote: 'Place-search result only. It does not provide a complete infrastructure inventory or prove a discharge connection.',
  };
}

function makeRegion(mapkit, center, radiusM) {
  const latitudeDelta = Math.min(1, Math.max(0.005, (radiusM * 2) / 111000));
  const longitudeDelta = Math.min(1, Math.max(0.005, (radiusM * 2) / (111000 * Math.max(0.15, Math.cos(center.lat * Math.PI / 180)))));
  return new mapkit.CoordinateRegion(
    new mapkit.Coordinate(center.lat, center.lon),
    new mapkit.CoordinateSpan(latitudeDelta, longitudeDelta),
  );
}

function loadScript(src, predicate, label) {
  if (predicate()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.crossOrigin = 'anonymous';
    const timer = setTimeout(() => reject(new Error(`${label} library did not load before timeout. Check the network or provider settings.`)), 25000);
    script.onload = () => {
      clearTimeout(timer);
      if (predicate()) resolve();
      else reject(new Error(`${label} script loaded but its API was not initialized.`));
    };
    script.onerror = () => {
      clearTimeout(timer);
      reject(new Error(`Could not load ${label}. Check the network, API configuration, and browser console.`));
    };
    document.head.appendChild(script);
  });
}

async function loadGoogleLibraries(apiKey) {
  if (!apiKey) throw new Error('Google Maps live search needs a restricted Google Maps Platform API key. Ask a parent, guardian, or teacher to help configure the billing-enabled project. You can still open Google Maps directly or use offline data.');
  if (globalThis.google?.maps?.importLibrary && googleLoadedApiKey && googleLoadedApiKey !== apiKey) {
    throw new Error('Google Maps was already loaded with a different key. After changing the saved Google key, refresh this browser tab and run the search again.');
  }
  if (!globalThis.google?.maps?.importLibrary) {
    if (!googleScriptPromise) {
      googleScriptPromise = loadScript(
        `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async`,
        () => Boolean(globalThis.google?.maps?.importLibrary),
        'Google Maps JavaScript API',
      ).then(() => { googleLoadedApiKey = apiKey; }).catch(error => { googleScriptPromise = null; throw error; });
    }
    await googleScriptPromise;
  }
  const [mapsLibrary, placesLibrary] = await Promise.all([
    globalThis.google.maps.importLibrary('maps'),
    globalThis.google.maps.importLibrary('places'),
  ]);
  if (!placesLibrary?.Place?.searchByText) throw new Error('Google Places API (New) is unavailable. Enable Places API (New) and Maps JavaScript API in the Google Cloud project linked to this key.');
  return { google: globalThis.google, Map: mapsLibrary.Map, Place: placesLibrary.Place };
}

async function searchGooglePlaces(center, radiusM, apiKey, onProgress) {
  const { Place } = await loadGoogleLibraries(apiKey);
  const locationBias = { center: { lat: center.lat, lng: center.lon }, radius: Math.min(50000, Math.max(500, radiusM)) };
  const groups = [
    { group: 'water', query: `river lake pond reservoir canal near ${center.lat}, ${center.lon}` },
    { group: 'wastewater', query: `water treatment plant wastewater treatment plant near ${center.lat}, ${center.lon}` },
    { group: 'industrial', query: `factory industrial facility near ${center.lat}, ${center.lon}` },
    { group: 'bridge', query: `bridge dam canal near ${center.lat}, ${center.lon}` },
  ];
  const all = [];
  const failures = [];
  for (const entry of groups) {
    onProgress?.(`Searching Google Maps for ${entry.group === 'water' ? 'nearby water features' : entry.group + ' places'}…`);
    try {
      const response = await Place.searchByText({
        textQuery: entry.query,
        fields: ['id', 'displayName', 'location', 'formattedAddress', 'googleMapsURI', 'types', 'primaryType'],
        locationBias,
        maxResultCount: 10,
        rankPreference: 'DISTANCE',
      });
      for (const place of response.places || []) all.push(normalizeTrustedPlace(place, 'google', entry.group, center));
    } catch (error) {
      failures.push(`${entry.group}: ${error.message || 'search failed'}`);
    }
  }
  const features = uniqueAndSort(all.filter(Boolean));
  if (!features.length && failures.length) throw new Error(`Google Maps search could not retrieve places. ${failures.join(' | ')}`);
  return { features, warnings: failures, source: 'Google Maps Platform Places API (New)', provider: 'google', attribution: 'Google Maps' };
}

async function loadAppleMapKit(token) {
  if (!token) throw new Error('Apple MapKit JS needs a Maps token from an Apple Developer account. Ask a parent, guardian, or teacher to help configure it. You can still open Apple Maps directly or use offline data.');
  if (!globalThis.mapkit) {
    if (!appleScriptPromise) {
      appleScriptPromise = loadScript('https://cdn.apple-mapkit.com/mk/6.x.x/mapkit.js', () => Boolean(globalThis.mapkit?.init), 'Apple MapKit JS')
        .catch(error => { appleScriptPromise = null; throw error; });
    }
    await appleScriptPromise;
  }
  if (appleInitializedToken !== token) {
    globalThis.mapkit.init({ authorizationCallback: done => done(token) });
    appleInitializedToken = token;
  }
  if (!globalThis.mapkit?.Search) throw new Error('Apple MapKit Search is unavailable after initialization. Check the MapKit JS token and domain restrictions.');
  return globalThis.mapkit;
}

async function searchAppleMapKit(center, radiusM, token, onProgress) {
  const mapkit = await loadAppleMapKit(token);
  const region = makeRegion(mapkit, center, radiusM);
  const service = new mapkit.Search({ region, includePhysicalFeatures: true, includePointsOfInterest: true, includeAddresses: false });
  const groups = [
    { group: 'water', query: 'rivers lakes ponds reservoirs canals' },
    { group: 'wastewater', query: 'water treatment plant wastewater treatment plant' },
    { group: 'industrial', query: 'industrial facility factory' },
    { group: 'bridge', query: 'bridge dam canal' },
  ];
  const all = [];
  const failures = [];
  for (const entry of groups) {
    onProgress?.(`Searching Apple Maps for ${entry.group === 'water' ? 'nearby physical water features' : entry.group + ' places'}…`);
    try {
      const response = await service.search(entry.query, { region, includePhysicalFeatures: true, includePointsOfInterest: true, includeAddresses: false });
      for (const place of response.places || []) all.push(normalizeTrustedPlace(place, 'apple', entry.group, center));
    } catch (error) {
      failures.push(`${entry.group}: ${error.message || 'search failed'}`);
    }
  }
  const features = uniqueAndSort(all.filter(Boolean));
  if (!features.length && failures.length) throw new Error(`Apple Maps search could not retrieve places. ${failures.join(' | ')}`);
  return { features, warnings: failures, source: 'Apple MapKit JS Search', provider: 'apple', attribution: 'Apple Maps' };
}

function uniqueAndSort(features) {
  return [...new Map(features.map(item => [item.id, item])).values()].sort((a, b) => a.distanceM - b.distanceM);
}

function splitFeatures(features) {
  return {
    waterBodies: uniqueAndSort(features.filter(feature => feature.isWaterBody)),
    contextFeatures: uniqueAndSort(features.filter(feature => !feature.isWaterBody && feature.context)),
  };
}

function mergeOffline(result, offline, center, radiusM) {
  const liveWaterBodies = result.waterBodies || [];
  const liveContextFeatures = result.contextFeatures || [];
  const waterBodies = uniqueAndSort([...liveWaterBodies, ...(offline.waterBodies || [])]);
  const contextFeatures = uniqueAndSort([...liveContextFeatures, ...(offline.contextFeatures || [])]);
  return {
    ...result,
    coordinates: center,
    requestedCoordinates: center,
    radiusM: result.radiusM || radiusM,
    requestedRadiusM: radiusM,
    liveWaterBodies,
    liveContextFeatures,
    offlineWaterBodies: offline.waterBodies || [],
    offlineContextFeatures: offline.contextFeatures || [],
    waterBodies,
    contextFeatures,
    offlineLayersAvailable: offline.layers.length,
    offlineFeaturesIncluded: offline.waterBodies.length + offline.contextFeatures.length,
    offlineLayerNames: offline.layers.map(layer => layer.name),
    featureCount: waterBodies.length + contextFeatures.length,
  };
}

async function searchWithProvider(provider, point, radius, settings, onProgress, options) {
  if (options.providerLookup) return options.providerLookup(provider, point, radius, settings, onProgress);
  if (provider === 'google') return searchGooglePlaces(point, radius, settings.googleApiKey, onProgress);
  if (provider === 'apple') return searchAppleMapKit(point, radius, settings.appleMapKitToken, onProgress);
  throw new Error(`Unsupported trusted map provider: ${provider}`);
}

export async function lookupTrustedNearby(center, radiusM, settings = {}, onProgress, options = {}) {
  const point = { lat: Number(center?.lat), lon: Number(center?.lon) };
  const radius = Math.round(Number(radiusM));
  if (!Number.isFinite(point.lat) || point.lat < -90 || point.lat > 90 || !Number.isFinite(point.lon) || point.lon < -180 || point.lon > 180) throw new Error('Latitude or longitude is invalid.');
  if (![500, 1000, 1500, 3000, 5000].includes(radius)) throw new Error('Choose a search radius between 500 m and 5 km.');

  const requestedProvider = settings.provider || 'google';
  const offline = await getOfflineMapFeaturesNearby(point, radius, { storage: options.offlineStorage });
  if (options.offlineOnly || requestedProvider === 'offline') {
    if (!offline.waterBodies.length && !offline.contextFeatures.length) throw new Error('No imported offline map features were found in this search radius. Import GeoJSON or a map-library backup first.');
    return mergeOffline({
      waterBodies: [], contextFeatures: [], coordinates: point, radiusM: radius,
      queriedAt: new Date(options.now ?? Date.now()).toISOString(),
      source: 'Imported offline map data', provider: 'offline', providerLabel: 'Offline map library',
      attribution: 'Imported map data; see each layer metadata',
      mapUrl: buildGoogleMapsSearchUrl(point.lat, point.lon),
      offlineDataOnly: true, offlineSearchOnly: true, liveLookupFailed: false,
      mapLookupError: null, contextLookupWarning: null,
    }, offline, point, radius);
  }

  const providers = requestedProvider === 'auto' ? ['google', 'apple'] : [requestedProvider];
  const failures = [];
  for (const provider of providers) {
    const credential = provider === 'apple' ? settings.appleMapKitToken : settings.googleApiKey;
    if (!credential && !options.providerLookup) {
      failures.push(provider === 'apple'
        ? 'Apple MapKit JS requires an Apple Developer Maps token.'
        : 'Google Maps Places requires a restricted Google Maps Platform API key.');
      continue;
    }
    try {
      onProgress?.(provider === 'apple' ? 'Connecting to Apple MapKit JS…' : 'Connecting to Google Maps Places…');
      const searched = await searchWithProvider(provider, point, radius, settings, onProgress, options);
      const live = splitFeatures(searched.features || []);
      if (!live.waterBodies.length && !live.contextFeatures.length && !offline.waterBodies.length && !offline.contextFeatures.length) {
        failures.push(`${searched.source || provider} returned no matching results for this area.`);
        continue;
      }
      const actualProvider = searched.provider || provider;
      const mapUrl = actualProvider === 'apple' ? buildAppleMapsSearchUrl(point.lat, point.lon) : buildGoogleMapsSearchUrl(point.lat, point.lon);
      const result = mergeOffline({
        ...live,
        coordinates: point,
        radiusM: radius,
        queriedAt: new Date(options.now ?? Date.now()).toISOString(),
        source: searched.source,
        provider: actualProvider,
        requestedProvider,
        providerLabel: actualProvider === 'apple' ? 'Apple Maps' : 'Google Maps',
        attribution: searched.attribution || (actualProvider === 'apple' ? 'Apple Maps' : 'Google Maps'),
        mapUrl,
        offlineDataOnly: !live.waterBodies.length && !live.contextFeatures.length,
        offlineSearchOnly: false,
        liveLookupFailed: false,
        providerWarnings: [...failures, ...(searched.warnings || [])],
        mapLookupError: failures.length ? failures.join(' | ') : null,
        contextLookupWarning: searched.warnings?.length ? searched.warnings.join(' | ') : null,
      }, offline, point, radius);
      return result;
    } catch (error) {
      failures.push(`${provider === 'apple' ? 'Apple Maps' : 'Google Maps'}: ${error.message || 'search failed'}`);
      if (requestedProvider !== 'auto') break;
    }
  }

  if (offline.waterBodies.length || offline.contextFeatures.length) {
    return mergeOffline({
      waterBodies: [],
      contextFeatures: [],
      coordinates: point,
      radiusM: radius,
      queriedAt: new Date(options.now ?? Date.now()).toISOString(),
      source: 'Imported offline map data; trusted live provider unavailable',
      provider: 'offline',
      requestedProvider,
      providerLabel: 'Offline map library',
      attribution: 'Imported map data; see each layer metadata',
      mapUrl: buildGoogleMapsSearchUrl(point.lat, point.lon),
      offlineDataOnly: true,
      offlineSearchOnly: false,
      liveLookupFailed: true,
      mapLookupError: failures.join(' | '),
      contextLookupWarning: 'Live provider data is unavailable; only imported offline features are shown.',
    }, offline, point, radius);
  }
  throw new Error(failures.join('\n') || 'The selected map provider could not return results. Open the location directly in Google Maps or Apple Maps, or import map data for offline exploration.');
}

export async function mountTrustedMap({ container, provider, settings = {}, center, features = [], onSelect }) {
  if (!container) throw new Error('Map display container is not available.');
  if (provider === 'google') {
    const { google, Map } = await loadGoogleLibraries(settings.googleApiKey);
    const map = new Map(container, {
      center: { lat: center.lat, lng: center.lon },
      zoom: 15,
      mapTypeId: 'roadmap',
      streetViewControl: false,
      fullscreenControl: true,
      clickableIcons: true,
    });
    const markers = features.map(feature => {
      const marker = new google.maps.Marker({
        map,
        position: { lat: feature.lat, lng: feature.lon },
        title: feature.name,
        label: feature.isWaterBody ? 'W' : undefined,
      });
      marker.addListener('click', () => onSelect?.(feature.id));
      return marker;
    });
    if (markers.length > 1) {
      const bounds = new google.maps.LatLngBounds();
      bounds.extend({ lat: center.lat, lng: center.lon });
      features.forEach(feature => bounds.extend({ lat: feature.lat, lng: feature.lon }));
      map.fitBounds(bounds, 36);
      if (map.getZoom() > 17) map.setZoom(17);
    }
    return () => {
      markers.forEach(marker => marker.setMap(null));
      map.unbindAll?.();
      container.innerHTML = '';
    };
  }

  if (provider === 'apple') {
    const mapkit = await loadAppleMapKit(settings.appleMapKitToken);
    const region = makeRegion(mapkit, center, 1500);
    const map = new mapkit.Map(container, { region, showsMapTypeControl: true, showsCompass: mapkit.FeatureVisibility?.Visible });
    const annotations = features.map(feature => {
      const annotation = new mapkit.MarkerAnnotation(
        new mapkit.Coordinate(feature.lat, feature.lon),
        { title: feature.name, subtitle: feature.isWaterBody ? 'Water feature candidate' : (feature.context?.label || 'Mapped place') },
      );
      // Keep only the app's feature ID on the transient annotation; MapKit content
      // itself is not copied into the offline map library or custom Three.js scene.
      annotation.jalrakshakFeatureId = feature.id;
      return annotation;
    });
    const handleSelect = event => {
      const featureId = event?.annotation?.jalrakshakFeatureId;
      if (featureId) onSelect?.(featureId);
    };
    map.addEventListener?.('select', handleSelect);
    if (annotations.length) map.addAnnotations(annotations);
    return () => {
      map.removeEventListener?.('select', handleSelect);
      try { map.destroy?.(); } catch { /* MapKit versions differ in teardown support. */ }
      container.innerHTML = '';
    };
  }

  throw new Error('A native provider map is available only for Google Maps or Apple Maps results.');
}
