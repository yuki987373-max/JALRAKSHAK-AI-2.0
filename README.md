# JalRakshak AI v3.0

JalRakshak AI is a React + Vite water-quality and catchment exploration application. This release continues the uploaded v2.6.1 project and retains its dashboard, water-quality assessment engine, manual readings, sensor gateway, laboratory/data imports, offline GeoJSON map library and Three.js location hologram.

## Start on Windows (beginner-friendly)

1. Install **Node.js LTS** from https://nodejs.org/ (choose the LTS download).
2. Extract the ZIP into a normal folder, for example `Documents\JalRakshak-AI-v3.0`.
3. Double-click **START_JALRAKSHAK.bat**.
4. On the first run, the script installs the required packages. Keep the window open.
5. When it says the server is ready, open **http://localhost:5173** in Chrome or Edge.
6. To stop the application, return to the black launcher window and press `Ctrl+C`.

If the first installation fails, check your internet connection and run the same BAT file again. Do not delete the project files.

## Main features

- Dashboard and guided water-quality workflow.
- India address lookup and direct latitude/longitude input.
- Browser GPS with permission-denied guidance.
- MapLibre GL JS map using the OpenFreeMap public style.
- Independent OpenStreetMap/Overpass lookup for water features and surrounding context.
- 5 km maximum search radius.
- Rivers, streams, canals, lakes, ponds, wetlands and reservoirs where tagged in the source data.
- Separate mapped context inventory: buildings, roads, bridges, drains, railways, utilities, industrial and agricultural land-use tags.
- 3D Three.js digital-twin scene with object selection, zoom buttons, scroll zoom, `R` zoom-in and `F` zoom-out.
- Manual water-quality measurements and transparent screening.
- Sensor and laboratory record workflows.
- CSV, JSON, XML, text, PDF and spreadsheet import paths as supported by the bundled parsers.
- Local offline GeoJSON/Overpass JSON import and export.

## Location data: what the result means

The map display and geographic lookup are independent systems:
- **Map display:** MapLibre GL JS + OpenFreeMap tiles.
- **Feature lookup:** OpenStreetMap data queried through public Overpass endpoints.
- **Address lookup:** OpenStreetMap Nominatim, India-scoped for place-name search.
- **Offline data:** user-imported GeoJSON or Overpass JSON saved in browser storage.

A provider failure means **data unavailable**, not “no waterbody”. An empty search means no matching mapped features were returned for that query; it is not proof of absence. OpenStreetMap coverage, tag quality, server capacity and map zoom affect results. Use field verification and authoritative local datasets for consequential decisions.

The default search radius is 5 km. Public Overpass services are shared infrastructure; searches are user-initiated and results are cached. Avoid repeated refreshes.

## 3D digital twin: important accuracy note

When a mapped waterbody includes source geometry, the scene can render that geometry. When the source only supplies a point/centre, the waterbody shape is deliberately schematic. Surrounding objects without source geometry are approximate visual models placed at mapped representative positions; they are not surveyed building footprints, measured heights or proof of real-world structure dimensions. Object descriptions retain source and verification caveats.

## Water-quality interpretation

Enter actual sensor, laboratory or manually measured values before interpreting water quality. The bundled screening logic can flag readings outside configured thresholds and suggest investigation steps. It is a decision-support prototype, not a certified laboratory, regulatory instrument or independently validated contamination-prediction model.

Map proximity does not prove pollution or a drainage connection. Health, drinking-water and regulatory decisions require suitable sampling, accredited laboratory testing and applicable local standards. Empty values are not treated as zero. Synthetic demo/simulator readings must not be confused with real observations or used as training labels.

## Run tests and build

Open Command Prompt in the project folder and run:

```bash
npm install
npm test
npm run build
```

To preview a production build locally:

```bash
npm run preview
```

## Deployment

For a free public static website, follow **DEPLOY_CLOUDFLARE_PAGES.md**. The older `DEPLOY_PUBLIC_WEBSITE.md` and `render.yaml` are retained for the original Render deployment path.

Cloudflare Pages static hosting publishes the frontend. The optional Vite sensor gateway does not become a durable hosted API simply by uploading the static `dist/` folder. Use a separately configured backend if public multi-user sensor history is required.

## Project layout

- `src/App.jsx` — main dashboard and application state.
- `src/locationWaterLookup.js` — coordinate parsing, Overpass lookup, cache and result normalization.
- `src/openFreeMapFeatures.js` — map tile feature classification.
- `src/components/OpenFreeMapCanvas.jsx` — MapLibre map.
- `src/components/LocationWaterExplorer.jsx` — GPS, location search, feature inventory and offline imports.
- `src/components/LocationWaterHologram.jsx` — Three.js digital twin.
- `src/analysisEngine.js` — water-quality screening.
- `src/environmentalAssessment.js` — catchment context and remedy planning.
- `src/universalImport.js`, `src/csvImport.js` — data import.
- `src/sensorGateway.js`, `src/sensorGatewayPlugin.js` — sensor API/dev gateway.
- `tests/` — automated Node.js tests.

## Tests in the supplied baseline

The uploaded baseline passed **98/98 tests** before changes. The upgraded v3.0 source passes **99/99 automated tests** in the available Node.js environment, and all plain `.js` source, script and test files pass `node --check`. Re-run `npm test` after updates. A production build could not be completed in this isolated environment: npm package installation timed out because DNS/network access to the npm registry and SheetJS CDN was unavailable, leaving Vite uninstalled. Run `npm install` and `npm run build` on a connected computer before public deployment.

## Data source and attribution

OpenStreetMap contributors: https://www.openstreetmap.org/copyright  
OpenFreeMap: https://openfreemap.org/  
MapLibre: https://maplibre.org/  
Overpass API: https://wiki.openstreetmap.org/wiki/Overpass_API  
Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/
