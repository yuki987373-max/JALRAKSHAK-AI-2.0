import { useEffect, useRef, useState } from 'react';
import { Crosshair, Layers3, Loader2, MousePointerClick, ZoomIn, ZoomOut } from 'lucide-react';
import { Map as MapLibreMap, FullscreenControl, NavigationControl, ScaleControl, setWorkerUrl } from 'maplibre-gl';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  buildSearchBounds,
  normalizeOpenFreeMapFeature,
  normalizeRenderedMapFeatures,
  OPEN_FREEMAP_ATTRIBUTION,
  OPEN_FREEMAP_STYLE_URL,
} from '../openFreeMapFeatures.js';

setWorkerUrl(maplibreWorkerUrl);

function makeCircle(center, radiusM, steps = 96) {
  const coordinates = [];
  const earthRadius = 6371000;
  const lat1 = center.lat * Math.PI / 180;
  const lon1 = center.lon * Math.PI / 180;
  const angular = radiusM / earthRadius;
  for (let index = 0; index <= steps; index += 1) {
    const bearing = (index / steps) * Math.PI * 2;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    coordinates.push([lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
  }
  return { type: 'Feature', properties: { role: 'search-radius', radiusM }, geometry: { type: 'Polygon', coordinates: [coordinates] } };
}

function makeCenterPoint(center) {
  return { type: 'Feature', properties: { role: 'search-center' }, geometry: { type: 'Point', coordinates: [center.lon, center.lat] } };
}

function makeFeaturePoints(features = []) {
  return {
    type: 'FeatureCollection',
    features: features.slice(0, 5000).map(item => ({
      type: 'Feature',
      id: item.id,
      properties: {
        id: item.id,
        isWaterBody: Boolean(item.isWaterBody),
        name: item.name || '',
        category: item.context?.category || item.kind || 'mapped-feature',
        jrPayload: JSON.stringify(item),
      },
      geometry: item.geometry || { type: 'Point', coordinates: [item.lon, item.lat] },
    })),
  };
}

function add3DBuildings(map) {
  const style = map.getStyle();
  const existing = style.layers?.some(layer => layer.type === 'fill-extrusion' && layer['source-layer'] === 'building');
  if (existing) return;
  const buildingStyle = style.layers?.find(layer => layer['source-layer'] === 'building' && layer.source);
  if (!buildingStyle || !style.sources?.[buildingStyle.source]) return;
  const firstSymbol = style.layers?.find(layer => layer.type === 'symbol')?.id;
  map.addLayer({
    id: 'jalrakshak-3d-building-extrusions',
    type: 'fill-extrusion',
    source: buildingStyle.source,
    'source-layer': 'building',
    minzoom: 14,
    filter: ['!=', ['get', 'hide_3d'], true],
    paint: {
      'fill-extrusion-color': ['case', ['has', 'render_height'], '#7199a8', '#527985'],
      'fill-extrusion-height': ['coalesce', ['to-number', ['get', 'render_height']], 7],
      'fill-extrusion-base': ['coalesce', ['to-number', ['get', 'render_min_height']], 0],
      'fill-extrusion-opacity': 0.78,
    },
  }, firstSymbol);
}

export default function OpenFreeMapCanvas({ center, radiusM, features = [], onFeatureSelect, onFeaturesScan }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const callbacksRef = useRef({ onFeatureSelect, onFeaturesScan });
  const featuresRef = useRef(features);
  const [status, setStatus] = useState({ tone: 'loading', message: 'Loading the free OpenFreeMap vector map…' });

  useEffect(() => { callbacksRef.current = { onFeatureSelect, onFeaturesScan }; }, [onFeatureSelect, onFeaturesScan]);
  useEffect(() => { featuresRef.current = features; }, [features]);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    let map;
    let cancelled = false;
    let mapLoaded = false;
    const loadTimer = setTimeout(() => {
      if (!cancelled && !mapLoaded) {
        setStatus({ tone: 'error', message: 'The base map did not load within 12 seconds. Location analysis and imported geographic data remain available; check your connection or try again.' });
      }
    }, 12000);
    setStatus({ tone: 'loading', message: 'Connecting to the free OpenFreeMap vector tiles…' });

    try {
      map = new MapLibreMap({
        container: containerRef.current,
        style: OPEN_FREEMAP_STYLE_URL,
        center: [center.lon, center.lat],
        zoom: 12,
        pitch: 48,
        bearing: -12,
        attributionControl: { compact: false, customAttribution: OPEN_FREEMAP_ATTRIBUTION },
        maxZoom: 19,
        minZoom: 4,
        cooperativeGestures: true,
      });
      mapRef.current = map;
      map.on('error', event => {
        if (!cancelled && !mapLoaded && event?.error) {
          setStatus({ tone: 'error', message: 'The free base map service could not load. Geographic search results and water-quality analysis are independent and can still be used.' });
        }
      });
      map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
      map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
      map.addControl(new FullscreenControl({ container: containerRef.current }), 'top-right');

      map.once('load', () => {
        mapLoaded = true;
        clearTimeout(loadTimer);
        if (cancelled) return;
        try {
          const bounds = buildSearchBounds(center, radiusM);
          map.addSource('jalrakshak-search-radius', { type: 'geojson', data: makeCircle(center, radiusM) });
          map.addLayer({
            id: 'jalrakshak-search-radius-fill', type: 'fill', source: 'jalrakshak-search-radius',
            paint: { 'fill-color': '#26c8e9', 'fill-opacity': 0.09 },
          });
          map.addLayer({
            id: 'jalrakshak-search-radius-line', type: 'line', source: 'jalrakshak-search-radius',
            paint: { 'line-color': '#38d8f4', 'line-width': 2.2, 'line-dasharray': [2, 1.4], 'line-opacity': 0.95 },
          });
          map.addSource('jalrakshak-search-center', { type: 'geojson', data: makeCenterPoint(center) });
          map.addLayer({
            id: 'jalrakshak-search-center-dot', type: 'circle', source: 'jalrakshak-search-center',
            paint: { 'circle-radius': 7, 'circle-color': '#f8fbff', 'circle-stroke-color': '#16b8dc', 'circle-stroke-width': 3 },
          });
          map.addSource('jalrakshak-captured-features', { type: 'geojson', data: makeFeaturePoints(featuresRef.current) });
          map.addLayer({
            id: 'jalrakshak-context-fill', type: 'fill', source: 'jalrakshak-captured-features',
            filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'isWaterBody'], false]],
            paint: { 'fill-color': '#d6a76c', 'fill-opacity': 0.28, 'fill-outline-color': '#e0bd8d' },
          });
          map.addLayer({
            id: 'jalrakshak-water-fill', type: 'fill', source: 'jalrakshak-captured-features',
            filter: ['all', ['==', ['geometry-type'], 'Polygon'], ['==', ['get', 'isWaterBody'], true]],
            paint: { 'fill-color': '#24b8dc', 'fill-opacity': 0.52, 'fill-outline-color': '#8beaff' },
          });
          map.addLayer({
            id: 'jalrakshak-context-line', type: 'line', source: 'jalrakshak-captured-features',
            filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'isWaterBody'], false]],
            paint: { 'line-color': '#d5a76d', 'line-width': 2.2, 'line-opacity': 0.86 },
          });
          map.addLayer({
            id: 'jalrakshak-water-line', type: 'line', source: 'jalrakshak-captured-features',
            filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'isWaterBody'], true]],
            paint: { 'line-color': '#45dbfa', 'line-width': 3.2, 'line-opacity': 0.95 },
          });
          map.addLayer({
            id: 'jalrakshak-captured-feature-points', type: 'circle', source: 'jalrakshak-captured-features',
            filter: ['==', ['geometry-type'], 'Point'],
            paint: {
              'circle-radius': ['case', ['get', 'isWaterBody'], 6, 4],
              'circle-color': ['case', ['get', 'isWaterBody'], '#28c9ed', '#f2b45f'],
              'circle-stroke-color': '#071522', 'circle-stroke-width': 1.4,
            },
          });
          try { add3DBuildings(map); } catch { /* Base map remains usable if its style lacks the expected building source. */ }
          map.fitBounds(bounds, { padding: { top: 38, bottom: 44, left: 38, right: 38 }, duration: 450, maxZoom: 15.2 });
          map.setPitch(48);
          setStatus({ tone: 'loading', message: 'Map loaded. Checking the currently visible map features inside your search radius…' });
          // Inspect only features already rendered in the visible map viewport.
          // This is a bounded local inspection, not a tile download or full-area inventory.
          map.once('idle', () => {
            if (cancelled) return;
            try {
              const rendered = map.queryRenderedFeatures();
              const scanned = normalizeRenderedMapFeatures(rendered, center, radiusM, 300);
              callbacksRef.current.onFeaturesScan?.(scanned);
              const waterCount = scanned.filter(item => item.isWaterBody).length;
              const contextCount = scanned.length - waterCount;
              setStatus({ tone: 'ready', message: `Location scan complete: ${waterCount} water feature(s) and ${contextCount} surrounding feature(s) detected in currently rendered map tiles. Coverage may be incomplete; zoom and map detail affect results.` });
            } catch (scanError) {
              setStatus({ tone: 'warning', message: `Map is ready, but automatic feature inspection failed: ${scanError instanceof Error ? scanError.message : 'unknown map query error'}. You can still click visible features manually.` });
            }
          });
        } catch (error) {
          setStatus({ tone: 'warning', message: error instanceof Error ? error.message : 'The map loaded, but the search overlay could not be drawn.' });
        }
      });

      map.on('click', event => {
        try {
          // Imported map geometries are displayed as a GeoJSON overlay.
          // A click returns that exact feature to the 3D inspector.
          const localLayerIds = ['jalrakshak-water-fill', 'jalrakshak-water-line', 'jalrakshak-context-fill', 'jalrakshak-context-line', 'jalrakshak-captured-feature-points'];
          const localHits = map.queryRenderedFeatures(event.point, { layers: localLayerIds });
          const localHit = localHits.find(feature => feature?.properties?.jrPayload);
          if (localHit) {
            const item = JSON.parse(localHit.properties.jrPayload);
            callbacksRef.current.onFeatureSelect?.(item);
            setStatus({ tone: 'ready', message: `Selected imported map feature: ${item.name || item.kind}. Its source geometry and attributes are displayed in the current 3D scene.` });
            return;
          }
          // Otherwise, inspect one explicitly clicked vector-tile feature only.
          const clickPosition = map.unproject(event.point);
          const clickedPoint = { lat: clickPosition.lat, lon: clickPosition.lng };
          const renderedAtClick = map.queryRenderedFeatures(event.point);
          let clicked = null;
          for (const renderedFeature of renderedAtClick) {
            const candidate = normalizeOpenFreeMapFeature(renderedFeature, center, radiusM, clickedPoint);
            if (candidate) { clicked = candidate; break; }
          }
          if (clicked) {
            callbacksRef.current.onFeatureSelect?.(clicked);
            setStatus({ tone: 'ready', message: `Inspected one user-selected map feature: ${clicked.name}. This single basemap feature is shown for the current session.` });
          }
        } catch { /* Ignore clicks on map labels, empty map areas, or unclassified layers. */ }
      });
      map.on('error', event => {
        const message = event?.error?.message || '';
        if (/401|403|404|network|fetch/i.test(message)) {
          setStatus({ tone: 'warning', message: `A map tile could not be loaded: ${message}. The local/offline feature library remains available.` });
        }
      });
    } catch (error) {
      setStatus({ tone: 'error', message: error instanceof Error ? error.message : 'MapLibre could not initialise.' });
    }

    return () => {
      cancelled = true;
      clearTimeout(loadTimer);
      if (map) map.remove();
      if (mapRef.current === map) mapRef.current = null;
    };
    // Map is intentionally recreated only when the selected location or radius changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lon, radiusM]);

  useEffect(() => {
    const map = mapRef.current;
    const source = map?.getSource('jalrakshak-captured-features');
    if (source?.setData) source.setData(makeFeaturePoints(features));
  }, [features]);

  const zoomIn = () => mapRef.current?.zoomIn({ duration: 250 });
  const zoomOut = () => mapRef.current?.zoomOut({ duration: 250 });
  const recenter = () => {
    const map = mapRef.current;
    if (!map) return;
    map.fitBounds(buildSearchBounds(center, radiusM), { padding: 40, duration: 500, maxZoom: 15.2 });
  };
  const togglePitch = () => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ pitch: map.getPitch() > 15 ? 0 : 58, duration: 450 });
  };

  return (
    <section className="openfreemap-card" aria-label="Free interactive 3D map">
      <div className="openfreemap-heading">
        <div><span className="section-eyebrow">FREE MAP ENGINE · NO API KEY</span><strong>OpenFreeMap + MapLibre</strong><small>OpenStreetMap-based vector tiles · search radius up to 5 km</small></div>
        <span className={`openfreemap-status ${status.tone}`}>{status.tone === 'loading' ? <Loader2 size={12} className="spin-icon" /> : <MousePointerClick size={12} />}{status.tone === 'ready' ? 'MAP READY' : status.tone === 'loading' ? 'LOADING' : 'CHECK MAP'}</span>
      </div>
      <div className="openfreemap-canvas-wrap">
        <div className="openfreemap-canvas" ref={containerRef} />
        <div className="openfreemap-map-controls">
          <button type="button" title="Zoom in" onClick={zoomIn}><ZoomIn size={14} /></button>
          <button type="button" title="Zoom out" onClick={zoomOut}><ZoomOut size={14} /></button>
          <button type="button" title="Recenter to selected radius" onClick={recenter}><Crosshair size={14} /></button>
          <button type="button" title="Toggle 3D building pitch" onClick={togglePitch}><Layers3 size={14} /></button>
        </div>
      </div>
      <div className={`openfreemap-caption ${status.tone}`} role="status" aria-live="polite">
        <span>{status.message}</span>
      </div>
      <div className="openfreemap-map-meta">
        <span>Visible map features are scanned automatically; click an object to inspect it.</span>
        <span>{OPEN_FREEMAP_ATTRIBUTION}</span>
      </div>
      <p className="openfreemap-policy">The cyan circle marks the selected 5 km search boundary. The map inspection checks only features already rendered in the visible viewport and bounded by the selected radius; it does not download or harvest tile contents. A deliberate click can inspect one visible feature in more detail. For a complete 5 km feature inventory, import a separately licensed GeoJSON dataset into the offline map library. Map data is not water-quality evidence.</p>
    </section>
  );
}
