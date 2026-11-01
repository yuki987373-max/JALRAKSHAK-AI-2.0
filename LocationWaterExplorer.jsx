import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Database, ExternalLink, FileDown, Info, Loader2, MapPin, Navigation, Search, Upload, Waves } from 'lucide-react';
import { buildWaterBodyExplanation, formatDistance, parseCoordinatesInput, lookupNearbyWater } from '../locationWaterLookup.js';
import { getOfflineMapFeaturesNearby, importOfflineMapFile } from '../offlineMapData.js';
import { exportMapDatabase, loadOfflineMapLayers } from '../mapDataStore.js';
import { buildOpenFreeMapUrl, MAX_SEARCH_RADIUS_M } from '../openFreeMapFeatures.js';

const OpenFreeMapCanvas = lazy(() => import('./OpenFreeMapCanvas.jsx'));

function contextIcon(label) {
  if (/farmland|agricultur/i.test(label)) return 'AGRICULTURE';
  if (/industrial/i.test(label)) return 'INDUSTRIAL';
  if (/drain|ditch|sewer/i.test(label)) return 'DRAINAGE';
  if (/wastewater|waste-disposal/i.test(label)) return 'WASTE SYSTEM';
  if (/water-works|water \/ utility/i.test(label)) return 'WATER INFRA';
  if (/building/i.test(label)) return 'BUILDING';
  if (/road|transport/i.test(label)) return 'ROAD';
  if (/bridge/i.test(label)) return 'BRIDGE';
  if (/railway/i.test(label)) return 'RAIL';
  if (/power/i.test(label)) return 'POWER';
  if (/facility|point of interest/i.test(label)) return 'FACILITY';
  return 'LOCAL CONTEXT';
}

function mergeById(base = [], additions = []) {
  const items = new Map();
  for (const item of [...base, ...additions]) {
    if (item?.id) items.set(item.id, item);
  }
  return [...items.values()].sort((a, b) => (a.distanceM || 0) - (b.distanceM || 0));
}

const INDIA_GEOCODE_CACHE = new Map();
const INDIA_GEOCODE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function resolveIndiaLocation(rawInput) {
  try { return { coordinates: parseCoordinatesInput(rawInput), resolvedLabel: '' }; }
  catch (coordinateError) {
    const query = String(rawInput || '').trim();
    if (!query || query.length < 3) throw coordinateError;
    const cacheKey = query.toLocaleLowerCase('en-IN');
    const cached = INDIA_GEOCODE_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.savedAt < INDIA_GEOCODE_CACHE_TTL_MS) return cached.value;
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&country=India&q=${encodeURIComponent(query)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let response;
    try {
      response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('The India address search took too long. Paste latitude and longitude to continue without geocoding.');
      throw new Error('The India address search is temporarily unavailable. Paste latitude and longitude to continue.');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new Error(`India address search returned HTTP ${response.status}. Try latitude, longitude instead.`);
    const matches = await response.json();
    if (!Array.isArray(matches) || !matches.length) throw new Error('No Indian address match was found. Try a fuller address with village/town, district and state, or paste latitude, longitude.');
    const match = matches[0];
    const value = { coordinates: { lat: Number(match.lat), lon: Number(match.lon) }, resolvedLabel: match.display_name || query };
    INDIA_GEOCODE_CACHE.set(cacheKey, { value, savedAt: Date.now() });
    if (INDIA_GEOCODE_CACHE.size > 100) INDIA_GEOCODE_CACHE.delete(INDIA_GEOCODE_CACHE.keys().next().value);
    return value;
  }
}

export default function LocationWaterExplorer({ onLookupResult, selectedWaterBodyId, onWaterBodySelect, onContextFeatureSelect, onStartLookup, onLookupFailure }) {
  const [input, setInput] = useState('');
  const [radiusM, setRadiusM] = useState(MAX_SEARCH_RADIUS_M);
  const [result, setResult] = useState(null);
  const [activeFeatureId, setActiveFeatureId] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [offlineLayerCount, setOfflineLayerCount] = useState(0);
  const [offlineStatus, setOfflineStatus] = useState(null);
  const resultRef = useRef(null);

  useEffect(() => { resultRef.current = result; }, [result]);
  useEffect(() => {
    if (selectedWaterBodyId) setActiveFeatureId(selectedWaterBodyId);
  }, [selectedWaterBodyId]);

  useEffect(() => {
    let alive = true;
    loadOfflineMapLayers().then(layers => { if (alive) setOfflineLayerCount(layers.length); }).catch(() => {});
    return () => { alive = false; };
  }, []);



  const selectedFeature = result?.waterBodies?.find(item => item.id === (selectedWaterBodyId || activeFeatureId)) || result?.waterBodies?.find(item => item.id === activeFeatureId) || result?.waterBodies?.[0] || null;
  const mapFeatures = useMemo(() => [...(result?.waterBodies || []), ...(result?.contextFeatures || [])], [result]);


  const handleMapFeaturesScan = useCallback(scannedFeatures => {
    if (!Array.isArray(scannedFeatures) || !scannedFeatures.length) return;
    const current = resultRef.current;
    if (!current || current.offlineDataOnly) return;
    const scannedWater = scannedFeatures.filter(item => item.isWaterBody);
    const scannedContext = scannedFeatures.filter(item => !item.isWaterBody);
    const next = {
      ...current,
      waterBodies: mergeById(current.waterBodies || [], scannedWater),
      contextFeatures: mergeById(current.contextFeatures || [], scannedContext),
      liveWaterBodies: mergeById(current.liveWaterBodies || [], scannedWater),
      liveContextFeatures: mergeById(current.liveContextFeatures || [], scannedContext),
      liveScan: { scope: 'currently-rendered-map-viewport', featureCount: scannedFeatures.length, scannedAt: new Date().toISOString(), completeInventory: false },
    };
    resultRef.current = next;
    setResult(next);
    onLookupResult?.(next);
    if (!activeFeatureId && !selectedWaterBodyId && scannedWater[0]) {
      setActiveFeatureId(scannedWater[0].id);
      onWaterBodySelect?.(scannedWater[0].id);
    }
  }, [onLookupResult, onWaterBodySelect, activeFeatureId, selectedWaterBodyId]);

  const handleMapFeatureSelect = useCallback(feature => {
    if (!feature?.id) return;
    const current = resultRef.current;
    if (!current) return;
    const isWaterBody = Boolean(feature.isWaterBody);
    const next = {
      ...current,
      waterBodies: isWaterBody ? mergeById(current.waterBodies || [], [feature]) : current.waterBodies,
      contextFeatures: isWaterBody ? current.contextFeatures : mergeById(current.contextFeatures || [], [feature]),
      liveWaterBodies: isWaterBody ? mergeById(current.liveWaterBodies || [], [feature]) : current.liveWaterBodies,
      liveContextFeatures: isWaterBody ? current.liveContextFeatures : mergeById(current.liveContextFeatures || [], [feature]),
    };
    resultRef.current = next;
    setResult(next);
    onLookupResult?.(next);
    if (isWaterBody) {
      setActiveFeatureId(feature.id);
      onWaterBodySelect?.(feature.id);
    } else {
      onContextFeatureSelect?.(feature.id);
    }
  }, [onLookupResult, onWaterBodySelect, onContextFeatureSelect]);


  const runLookup = async (rawInput = input, radius = radiusM, requestFullscreen = true, forceRefresh = false, offlineOnly = false) => {
    if (!forceRefresh) {
      setResult(null); resultRef.current = null; setActiveFeatureId(null); onLookupResult?.(null);
    }
    setBusy(true);
    setStatus({ tone: 'info', message: 'Checking the location, then searching live waterbody and infrastructure records…' });
    try {
      const resolved = await resolveIndiaLocation(rawInput);
      const coordinates = resolved.coordinates;
      const safeRadius = Math.min(MAX_SEARCH_RADIUS_M, Math.max(100, Number(radius) || MAX_SEARCH_RADIUS_M));
      if (requestFullscreen) onStartLookup?.();
      let live = null;
      let liveError = null;
      if (!offlineOnly) {
        try {
          live = await lookupNearbyWater(coordinates, safeRadius, message => setStatus({ tone: 'info', message }), { forceRefresh });
        } catch (error) { liveError = error; }
      }
      const offline = await getOfflineMapFeaturesNearby(coordinates, safeRadius);
      const waterBodies = mergeById(live?.waterBodies || [], offline.waterBodies || []);
      const contextFeatures = mergeById(live?.contextFeatures || [], offline.contextFeatures || []);
      if (offlineOnly && !waterBodies.length && !contextFeatures.length) throw new Error('No imported map features were found near this location. Use live search instead.');
      // Keep the location result even when Overpass is unavailable. The independent
      // MapLibre map can still load and expose any vector-tile features it renders.
      // An empty/failed geographic response is never interpreted as proof of absence.
      const nearestWaterBody = waterBodies[0] || null;
      const geographicUnavailable = Boolean(liveError || live?.liveLookupFailed || live?.mapLookupError);
      const next = {
        ...(live || {}),
        provider: offlineOnly ? 'offline' : 'openfreemap',
        providerLabel: offlineOnly ? 'Imported offline map library' : 'OpenStreetMap live feature search + OpenFreeMap map tiles',
        coordinates, requestedCoordinates: coordinates, resolvedLabel: resolved.resolvedLabel,
        radiusM: safeRadius, requestedRadiusM: safeRadius,
        queriedAt: live?.queriedAt || new Date().toISOString(),
        mapUrl: buildOpenFreeMapUrl(coordinates),
        source: offlineOnly ? 'Imported offline map files' : 'OpenStreetMap via Overpass API plus OpenFreeMap vector tiles and imported local layers',
        attribution: '© OpenStreetMap contributors · Map tiles and styles: OpenFreeMap',
        waterBodies, contextFeatures,
        offlineWaterBodies: offline.waterBodies || [], offlineContextFeatures: offline.contextFeatures || [],
        offlineLayerNames: offline.layers.map(layer => layer.name),
        offlineFeaturesIncluded: (offline.waterBodies?.length || 0) + (offline.contextFeatures?.length || 0),
        offlineLayersAvailable: offline.layers.length,
        offlineDataOnly: Boolean(offlineOnly), offlineSearchOnly: Boolean(offlineOnly),
        mapProviderLive: !offlineOnly,
        nearestWaterBody, nearestWaterBodyDistanceM: nearestWaterBody?.distanceM ?? null,
        geometryIncluded: false,
        mapLookupError: liveError?.message || live?.mapLookupError || null,
        lookupState: offlineOnly ? 'offline' : geographicUnavailable ? 'unavailable' : 'queried',
        waterbodyDataStatus: offlineOnly ? 'offline-only' : geographicUnavailable ? 'unavailable' : 'queried',
        infrastructureDataStatus: offlineOnly ? 'offline-only' : live?.contextLookupWarning ? 'partial' : geographicUnavailable ? 'unavailable' : 'queried',
      };
      resultRef.current = next; setResult(next); setActiveFeatureId(nearestWaterBody?.id || null);
      onLookupResult?.(next);
      if (nearestWaterBody) onWaterBodySelect?.(nearestWaterBody.id);
      const label = resolved.resolvedLabel ? ` Address matched: ${resolved.resolvedLabel}.` : '';
      const resultMessage = geographicUnavailable
        ? `The map is available, but the independent geographic-data search could not complete or returned saved data only. ${liveError?.message || live?.mapLookupError || 'Live data could not be refreshed.'} You can still inspect visible map features.`
        : waterBodies.length || contextFeatures.length
          ? `${waterBodies.length} mapped water feature(s) and ${contextFeatures.length} surrounding feature(s) returned within ${(safeRadius / 1000).toFixed(1)} km. Mapping coverage is incomplete.${label}`
          : `The geographic search completed but returned no matching mapped features within ${(safeRadius / 1000).toFixed(1)} km. This is not proof that no waterbody or infrastructure exists.${label}`;
      setStatus({ tone: geographicUnavailable ? 'warning' : (waterBodies.length || contextFeatures.length ? 'good' : 'warning'), message: resultMessage });
      if (!waterBodies.length) onLookupFailure?.();
    } catch (error) {
      setStatus({ tone: 'danger', message: error instanceof Error ? error.message : 'Could not complete the location lookup.' });
      if (!forceRefresh) onLookupFailure?.();
    } finally { setBusy(false); }
  };

  const useCurrentLocation = () => {
    onStartLookup?.();
    if (!navigator.geolocation) {
      onLookupFailure?.();
      setStatus({ tone: 'danger', message: 'This browser does not provide location access. Paste coordinates from a map instead.' });
      return;
    }
    setBusy(true);
    setStatus({ tone: 'info', message: 'Requesting your permission to read this device’s location…' });
    navigator.geolocation.getCurrentPosition(
      position => {
        const coords = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`;
        setInput(coords);
        runLookup(coords, radiusM, false);
      },
      error => {
        onLookupFailure?.();
        setBusy(false);
        const message = error.code === 1
          ? 'Location permission was denied. Paste coordinates from a map website to continue.'
          : 'Could not obtain your location. Check browser location permission or paste coordinates from a map.';
        setStatus({ tone: 'warning', message });
      },
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 120000 },
    );
  };

  const explanation = selectedFeature ? buildWaterBodyExplanation(selectedFeature, result?.contextFeatures || [], result?.radiusM || radiusM) : buildWaterBodyExplanation(null);

  const handleOfflineMapImport = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setOfflineStatus({ tone: 'info', message: `Importing ${file.name}…` });
    try {
      const imported = await importOfflineMapFile(file);
      const layers = await loadOfflineMapLayers();
      setOfflineLayerCount(layers.length);
      setOfflineStatus({ tone: 'good', message: `Imported ${imported.featureCount} feature(s): ${imported.waterBodyCount} waterbody and ${imported.contextCount} infrastructure feature(s), across ${imported.layersImported || 1} layer(s). ${imported.snapshotsImported ? `${imported.snapshotsImported} saved search snapshot(s) restored. ` : ''}They are stored locally and included in future nearby searches.` });
    } catch (error) {
      setOfflineStatus({ tone: 'danger', message: error instanceof Error ? error.message : 'Could not import this map file.' });
    }
  };

  const downloadMapDatabase = async () => {
    try {
      const database = await exportMapDatabase();
      const blob = new Blob([JSON.stringify(database, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `jalrakshak-map-database-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setOfflineStatus({ tone: 'good', message: 'Local map database backup exported.' });
    } catch (error) {
      setOfflineStatus({ tone: 'danger', message: error.message || 'Could not export the local map database.' });
    }
  };

  const exportLocationReport = () => {
    if (!result || !['offline', 'openfreemap'].includes(result.provider)) return;
    const lines = [
      'JalRakshak AI — Map and Water-Body Context Report',
      `Requested coordinates: ${(result.requestedCoordinates || result.coordinates).lat}, ${(result.requestedCoordinates || result.coordinates).lon}`,
      `Saved map search centre: ${result.coordinates.lat}, ${result.coordinates.lon}`,
      `Search radius: ${result.radiusM} metres`,
      `Requested radius: ${result.requestedRadiusM || result.radiusM} metres`,
      `Last successful query at: ${result.queriedAt}`,
      `Data status: ${result.provider === 'openfreemap' ? 'OpenFreeMap vector tiles plus imported local data' : 'imported offline map data; not live provider data'}`,
      `Imported offline layers: ${(result.offlineLayerNames || []).join(', ') || 'none'}`,
      `Imported offline features included: ${result.offlineFeaturesIncluded || 0}`,
      `Context data queried at: ${result.contextDataQueriedAt || result.queriedAt}`,
      `Map lookup error: ${result.mapLookupError || 'none'}`,
      `Context lookup warning: ${result.contextLookupWarning || 'none'}`,
      `Map provider: ${result.providerLabel || result.provider || 'offline'}`,
      `Provider warnings: ${(result.providerWarnings || []).join(' | ') || 'none'}`, 
      `Data source: ${result.source}`,
      `Attribution: ${result.attribution || 'Imported map data; see layer metadata'}`, 
      `Map link: ${result.mapUrl}`,
      '',
      'MAPPED WATER FEATURES',
      ...(result.waterBodies.length ? result.waterBodies.map(item => `- ${item.name} | ${item.kind} | representative-point distance about ${formatDistance(item.distanceM)} | ${item.mapUrl} | tags: ${item.tagSummary.map(tag => `${tag.key}=${tag.value}`).join('; ') || 'none recorded'}`) : ['- No mapped water features returned for this search radius.']),
      '',
      'NEARBY MAPPED CONTEXT',
      ...(result.contextFeatures.length ? result.contextFeatures.map(item => `- ${item.context.label}: ${item.name} | ${formatDistance(item.distanceM)} from supplied point | ${item.context.explanation}`) : ['- No matching context features returned.']),
      '',
      'SELECTED FEATURE EXPLANATION',
      explanation,
      '',
      'LIMITATIONS',
      'Map features are geographic context, not water-quality measurements. Coordinates cannot establish pH, turbidity, dissolved contaminants, toxins, microbes, or drinking-water safety.',
      'Distances are calculated to representative mapped points; for long rivers or large polygons they are not surveyed nearest-edge distances.',
      'Map coverage and tags can be incomplete or outdated. Confirm with field inspection, current measurements, and suitable laboratory testing.',
      ...(result.offlineLayerNames?.length ? ['Imported offline data may include OpenStreetMap content; attribution must follow each source layer and https://www.openstreetmap.org/copyright'] : []),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `jalrakshak-location-${result.coordinates.lat.toFixed(4)}-${result.coordinates.lon.toFixed(4)}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="location-water-panel">
      <div className="location-panel-heading">
        <div>
          <span className="section-eyebrow">GPS / MAP LOOKUP</span>
          <h3><Navigation size={15} /> Nearby water-body explorer</h3>
        </div>
        <span className="assessment-chip">v3.0.0</span>
      </div>
      <p className="location-panel-copy">Enter an Indian place/address or GPS coordinates. JalRakshak first resolves an address to coordinates, then searches OpenStreetMap for mapped rivers, ponds, canals, drains, buildings, roads and facilities within up to 5 km. Coverage depends on what has been mapped.</p>
      <form className="location-lookup-form" onSubmit={event => { event.preventDefault(); runLookup(); }}>
        <label className="location-input-label" htmlFor="location-water-input">Indian address, GPS coordinates or map URL</label>
        <textarea
          id="location-water-input"
          value={input}
          onChange={event => setInput(event.target.value)}
          placeholder="Example: Patna, Bihar, India\nOr 25.5941, 85.1376 / paste a map URL…"
          rows={2}
          maxLength={2000}
          spellCheck="false"
        />
        <div className="location-form-row">
          <label className="location-radius-label">Search radius (maximum 5 km)
            <select value={radiusM} onChange={event => setRadiusM(Number(event.target.value))}>
              <option value={500}>500 m</option>
              <option value={1000}>1 km</option>
              <option value={1500}>1.5 km</option>
              <option value={3000}>3 km</option>
              <option value={5000}>5 km</option>
            </select>
          </label>
          <button className="primary-button location-analyse-button" type="submit" disabled={busy || !input.trim()}>
            {busy ? <Loader2 size={13} className="spin-icon" /> : <Search size={13} />}
            {busy ? 'Analysing…' : 'Analyse location'}
          </button>
        </div>
        <button className="location-current-button" type="button" onClick={useCurrentLocation} disabled={busy}><MapPin size={13} /> Use my current location</button>
        {(() => { try { const point = parseCoordinatesInput(input); return <div className="trusted-map-shortcuts"><a href={buildOpenFreeMapUrl(point)} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Open in OpenStreetMap</a></div>; } catch { return null; } })()}
      </form>
      {status && <div className={`csv-import-status ${status.tone}`} role="status" aria-live="polite">{status.message}</div>}
      <div className="map-reliability-tools">
        <div className="map-reliability-heading"><Database size={14} /><div><strong>Offline map library</strong><small>{offlineLayerCount} imported local layer(s) · stored in this browser</small></div></div>
        <div className="map-reliability-actions">
          <label className="location-current-button map-file-button"><Upload size={13} /> Import offline map / backup<input type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={handleOfflineMapImport} /></label>
          <button type="button" className="location-current-button" onClick={downloadMapDatabase}><FileDown size={13} /> Backup map library</button>
          <button type="button" className="location-current-button" onClick={() => runLookup(input, radiusM, false, false, true)} disabled={busy || !input.trim() || offlineLayerCount === 0}><Database size={13} /> Search offline library only</button>
        </div>
        {offlineStatus && <div className={`csv-import-status ${offlineStatus.tone}`} role="status" aria-live="polite">{offlineStatus.message}</div>}
        <div className="map-provider-settings trusted-map-settings openfreemap-info-panel">
          <strong><Database size={13} /> Free map engine — no API key or paid mapping account</strong>
          <p className="trusted-map-notice">MapLibre renders OpenFreeMap vector tiles. The location search separately queries OpenStreetMap feature data through public Overpass endpoints and can also inspect visible map features. No Google Places or Apple MapKit account is required. Search results are best-effort and depend on public-service availability and local mapping coverage; they are not a guaranteed complete inventory.</p>
          <div className="trusted-map-doc-links">
            <a href="https://openfreemap.org/quick_start/" target="_blank" rel="noreferrer"><ExternalLink size={11} /> OpenFreeMap quick start</a>
            <a href="https://maplibre.org/maplibre-gl-js/docs/" target="_blank" rel="noreferrer"><ExternalLink size={11} /> MapLibre documentation</a>
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer"><ExternalLink size={11} /> OpenStreetMap attribution</a>
          </div>
        </div>
      </div>

      {result && <div className="location-water-results">
        {result.lookupState === 'unavailable' && <div className="location-context-warning" role="status"><strong>Geographic data temporarily unavailable.</strong> The map is still shown independently. Features discovered from visible map tiles will be added when available. Do not interpret this as zero waterbodies.</div>}
        {result.offlineDataOnly && <div className="location-cache-notice stale" role="status"><strong>IMPORTED OFFLINE MAP DATA · NOT LIVE</strong><span>{result.offlineSearchOnly ? 'You chose an offline-only search; no live map request was made.' : 'No live map tiles were requested for this offline-only result.'} These features came from {result.offlineLayerNames?.join(', ') || 'your imported map file(s)'}. The data may be incomplete or out of date; check the import date and verify important features in the field.</span>{result.mapLookupError && <small>{result.mapLookupError}</small>}</div>}
        <div className="location-result-head">
          <div><span className="section-eyebrow">MAP DATA RESULT</span><strong>{result.waterBodies.length} water feature(s) returned</strong></div>
          <div className="location-result-actions"><span className="trusted-live-data-note">Visible map features are scanned automatically; click an object to inspect it.</span><a href={result.mapUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Open map</a></div>
        </div>
        <div className="location-coordinates-line"><MapPin size={12} /> {result.coordinates.lat.toFixed(6)}, {result.coordinates.lon.toFixed(6)} <span>· {result.radiusM >= 1000 ? `${(result.radiusM / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km radius` : `${result.radiusM} m radius`}</span></div>
        {result.provider === 'openfreemap' && <Suspense fallback={<div className="openfreemap-loading-placeholder"><Loader2 size={15} className="spin-icon" /> Loading the free 3D map engine…</div>}>
          <OpenFreeMapCanvas
            key={`local-map:${result.coordinates.lat}:${result.coordinates.lon}:${result.radiusM}`}
            center={result.coordinates}
            radiusM={result.radiusM}
            features={mapFeatures}
            onFeatureSelect={handleMapFeatureSelect}
            onFeaturesScan={handleMapFeaturesScan}
          />
        </Suspense>}
        {result.offlineFeaturesIncluded > 0 && <div className="location-offline-note"><Database size={12} /> Also included {result.offlineFeaturesIncluded} nearby feature(s) from {result.offlineLayersAvailable} imported browser layer(s).</div>}
        {result.contextLookupWarning && !result.contextIsCached && <div className="location-context-warning" role="status">Some buildings or infrastructure could not be refreshed: {result.contextLookupWarning}</div>}

        {result.waterBodies.length > 0 ? <>
          <div className="location-feature-list">
            {result.waterBodies.map(feature => <button
              type="button"
              key={feature.id}
              className={`location-feature-card ${selectedFeature?.id === feature.id ? 'active' : ''}`}
              onClick={() => { setActiveFeatureId(feature.id); onWaterBodySelect?.(feature.id); }}
            >
              <span className="location-feature-icon"><Waves size={15} /></span>
              <span className="location-feature-text"><strong>{feature.name}</strong><small>{feature.kind} · geometry distance {formatDistance(feature.distanceM)}</small></span>
              <span className="location-feature-dot" />
            </button>)}
          </div>
          {selectedFeature && <>
            <div className="location-selected-feature">
              <div className="location-selected-title"><div><span className="section-eyebrow">SELECTED MAPPED FEATURE</span><h4>{selectedFeature.name}</h4></div><span className="location-kind-chip">{selectedFeature.kind}</span></div>
              <div className="location-stat-grid">
                <div><span>Distance to mapped geometry</span><strong>{formatDistance(selectedFeature.distanceM)}</strong></div>
                <div><span>Representative point</span><strong>{selectedFeature.lat.toFixed(5)}, {selectedFeature.lon.toFixed(5)}</strong></div>
              </div>
              <div className="location-tag-list">{selectedFeature.tagSummary.filter(tag => tag.key !== 'name').slice(0, 6).map(tag => <span key={tag.key}><b>{tag.key}</b> {tag.value}</span>)}</div>
              <a className="location-osm-link" href={selectedFeature.mapUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open this feature in {selectedFeature.providerLabel || (selectedFeature.offlineImported ? 'imported map source' : 'map provider')}</a>
              {selectedFeature.tags.wikipedia && (() => { const rawWiki = String(selectedFeature.tags.wikipedia); const split = rawWiki.includes(':') ? rawWiki.split(':', 2) : ['en', rawWiki]; const language = /^[a-z-]{2,12}$/i.test(split[0]) ? split[0] : 'en'; const page = rawWiki.includes(':') && language === split[0] ? split[1] : rawWiki; return <a className="location-osm-link" href={`https://${language}.wikipedia.org/wiki/${encodeURIComponent(page.replaceAll(' ', '_'))}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Read linked background information</a>; })()}
              {/^Q\d+$/.test(String(selectedFeature.tags.wikidata || '')) && <a className="location-osm-link" href={`https://www.wikidata.org/wiki/${selectedFeature.tags.wikidata}`} target="_blank" rel="noreferrer"><ExternalLink size={13} /> View Wikidata record</a>}
              {selectedFeature.providerAddress && <p className="location-feature-description"><strong>Provider address:</strong> {selectedFeature.providerAddress}</p>}
              {selectedFeature.verificationNote && <p className="location-feature-description"><strong>Verification note:</strong> {selectedFeature.verificationNote}</p>}
              {selectedFeature.tags.description && <p className="location-feature-description"><strong>Mapped description:</strong> {selectedFeature.tags.description}</p>}
              <div className="location-explanation"><div className="location-explanation-title"><Info size={14} /> What the map suggests</div><p>{explanation}</p></div>
            </div>
          </>}
        </> : <div className="location-no-water"><Waves size={20} /><strong>{result.lookupState === 'unavailable' ? 'Waterbody data is currently unavailable' : 'No mapped waterbody candidate was returned'}</strong><p>{result.lookupState === 'unavailable' ? 'The geographic-data provider did not return a usable result. The map remains available independently; zoom in and inspect visible features, or try again later.' : 'The search returned no matching mapped water features. This does not establish that no waterbody exists: small ponds, seasonal wetlands, streams and poorly mapped features may be missing from public datasets. Verify important sites in the field or with an authorised local dataset.'}</p></div>}

        <div className="location-context-section">
          <div className="location-context-heading"><div><span className="section-eyebrow">SURROUNDING CONTEXT</span><h4>Mapped nearby features</h4><small>Buildings, roads, bridges, railways, utilities and land-use tags where mapped</small></div><span>{result.contextFeatures.length}</span></div>
          {result.contextFeatures.length ? <div className="location-context-list">{result.contextFeatures.map(item => <button type="button" className="location-context-item location-context-item-button" key={item.id} onClick={() => onContextFeatureSelect?.(item.id)}><div><strong>{item.name && !/^Unnamed mapped feature$/i.test(item.name) ? item.name : `${item.context.label} · ${item.osmType}/${item.osmId}`}</strong><small>{item.context.label} · {formatDistance(item.distanceM)} from supplied point</small><p>{item.context.explanation}</p></div><span>{contextIcon(item.context.label)}</span></button>)}</div> : <p className="location-empty-context">No related buildings, roads, facilities, or infrastructure tags were returned nearby. Mapping gaps are possible.</p>}
        </div>

        <div className="location-report-actions">
          <a href={buildOpenFreeMapUrl(result.coordinates)} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Open in OpenStreetMap</a>
          {['offline', 'openfreemap'].includes(result.provider) && <button type="button" className="location-export-button" onClick={exportLocationReport}><FileDown size={12} /> Download map report</button>}
          <span>Source: {result.attribution || result.source || 'Imported map data'} · {result.staleCache ? `saved result from ${new Date(result.queriedAt).toLocaleString()}` : `queried ${new Date(result.queriedAt).toLocaleString()}`}</span>
        </div>
      </div>}

      <div className="location-safety-note"><AlertTriangle size={13} /><span>MapLibre uses OpenFreeMap vector tiles; the location analyser queries OpenStreetMap feature records through public Overpass services and supplements them with visible map features. A 5 km radius is supported. Public services may be rate-limited or unavailable, and feature coverage may be incomplete or outdated. Map information cannot measure water quality or confirm pollution; combine it with calibrated sensor readings and suitable laboratory results.</span></div>
      <div className="location-attribution"><a href="https://openfreemap.org/quick_start/" target="_blank" rel="noreferrer">OpenFreeMap service information</a> · <a href="https://operations.osmfoundation.org/policies/nominatim/" target="_blank" rel="noreferrer">Nominatim usage policy</a> · <a href="https://maplibre.org/maplibre-gl-js/docs/" target="_blank" rel="noreferrer">MapLibre GL JS</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></div>
    </section>
  );
}
