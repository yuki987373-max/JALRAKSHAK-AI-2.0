import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { normalizeSensorPayload, latestBySensor } from './sensorGateway.js';

const execFileAsync = promisify(execFile);
const MAX_SENSOR_BODY = 64 * 1024;
const MAX_GENERAL_BODY = 18 * 1024 * 1024;
const MAX_SENSOR_READINGS = 25000;
const MAX_OBSERVATIONS = 50000;
const MAX_SNAPSHOTS = 5000;

const emptyDatabase = () => ({
  schemaVersion: 2,
  sensorReadings: [],
  observations: [],
  assessmentSnapshots: [],
  actionPlans: [],
  trainingDatasets: [],
  trainingRuns: [],
});

function ensureArrays(value) {
  const database = { ...emptyDatabase(), ...(value && typeof value === 'object' ? value : {}) };
  for (const key of Object.keys(emptyDatabase())) {
    if (key === 'schemaVersion') continue;
    if (!Array.isArray(database[key])) database[key] = [];
  }
  database.schemaVersion = 2;
  return database;
}

function safeName(value, fallback = 'dataset.csv') {
  const base = path.basename(String(value || fallback)).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  return base || fallback;
}

function pythonCommand(root) {
  const localPython = process.platform === 'win32'
    ? path.join(root, '.venv', 'Scripts', 'python.exe')
    : path.join(root, '.venv', 'bin', 'python');
  return {
    command: localPython,
    fallback: process.platform === 'win32' ? 'py' : 'python3',
    prefixArgs: process.platform === 'win32' ? ['-3'] : [],
    localArgs: [],
  };
}

function numericValues(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('values must be a JSON object of numeric measurements.');
  const output = {};
  for (const [key, raw] of Object.entries(values)) {
    if (raw === '' || raw === null || raw === undefined) continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`${key} must be a finite numeric value.`);
    output[String(key).slice(0, 80)] = value;
  }
  if (!Object.keys(output).length) throw new Error('At least one numeric measurement is required.');
  return output;
}

function makeObservation({ siteId, sourceType, timestamp, values, metadata = {} }) {
  const date = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(date.getTime())) throw new Error('timestamp must be a valid date/time.');
  if (date.getTime() > Date.now() + 5 * 60 * 1000) throw new Error('timestamp cannot be more than five minutes in the future.');
  return {
    id: randomUUID(),
    site_id: String(siteId).trim().slice(0, 160),
    source_type: sourceType,
    timestamp: date.toISOString(),
    received_at: new Date().toISOString(),
    values: numericValues(values),
    metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {},
  };
}

function sensorValuesForHistory(readings) {
  const map = {
    pH: 'ph', turbidity_ntu: 'turbidity_ntu', dissolved_oxygen_mg_l: 'dissolved_oxygen_mg_l',
    tds_mg_l: 'tds_mg_l', temperature_c: 'temperature_c', water_level_m: 'water_level_m',
    conductivity_us_cm: 'conductivity_us_cm', flow_rate_l_s: 'flow_rate_l_s', nitrate_mg_l: 'nitrate_mg_l',
    phosphate_mg_l: 'phosphate_mg_l', ammonia_mg_l: 'ammonia_mg_l', salinity_ppt: 'salinity_ppt',
    bod_mg_l: 'bod_mg_l', cod_mg_l: 'cod_mg_l', tss_mg_l: 'tss_mg_l', orp_mv: 'orp_mv',
    chloride_mg_l: 'chloride_mg_l', sulfate_mg_l: 'sulfate_mg_l', fluoride_mg_l: 'fluoride_mg_l',
    iron_mg_l: 'iron_mg_l', manganese_mg_l: 'manganese_mg_l',
  };
  const output = {};
  for (const [key, value] of Object.entries(readings || {})) if (map[key]) output[map[key]] = value;
  return output;
}

function parseCsvMeta(csvText) {
  const firstLine = String(csvText || '').split(/\r?\n/, 1)[0] || '';
  const headers = [];
  let field = ''; let quoted = false;
  for (let index = 0; index < firstLine.length; index += 1) {
    const char = firstLine[index];
    if (char === '"') {
      if (quoted && firstLine[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { headers.push(field.trim()); field = ''; }
    else field += char;
  }
  headers.push(field.trim());
  const lineCount = String(csvText || '').split(/\r?\n/).filter(line => line.trim()).length;
  return { headers, approximateRows: Math.max(0, lineCount - 1) };
}

export function createPersistentStore({ storeFile } = {}) {
  const filePath = storeFile || path.resolve(process.cwd(), 'data', 'jalrakshak-store.json');
  let databasePromise;
  let writeQueue = Promise.resolve();

  async function load() {
    if (!databasePromise) {
      databasePromise = (async () => {
        try { return ensureArrays(JSON.parse(await readFile(filePath, 'utf8'))); }
        catch (error) {
          if (error?.code !== 'ENOENT') throw error;
          const initial = emptyDatabase();
          await mkdir(path.dirname(filePath), { recursive: true });
          await writeFile(filePath, JSON.stringify(initial, null, 2), 'utf8');
          return initial;
        }
      })();
    }
    return databasePromise;
  }

  async function persist() {
    const database = await load();
    writeQueue = writeQueue.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const tempPath = `${filePath}.${process.pid}.tmp`;
      await writeFile(tempPath, JSON.stringify(database, null, 2), 'utf8');
      await rename(tempPath, filePath);
    });
    return writeQueue;
  }

  return { load, persist, filePath };
}

export function decisionSupportPlugin(options = {}) {
  const store = createPersistentStore(options);
  const root = options.root || process.cwd();
  const trainingDir = path.join(root, 'data', 'training');

  async function handle(req, res, next) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return next();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }
    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
    };
    const readBody = async (limit = MAX_GENERAL_BODY) => {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk.toString('utf8');
        if (Buffer.byteLength(raw, 'utf8') > limit) throw Object.assign(new Error(`Request body is too large (maximum ${Math.round(limit / 1024 / 1024)} MB).`), { status: 413 });
      }
      try { return JSON.parse(raw || '{}'); }
      catch { throw Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }); }
    };

    try {
      const db = await store.load();
      if (req.method === 'GET' && url.pathname === '/api/health') {
        send(200, { ok: true, service: 'JalRakshak Local Data & Sensor Gateway', version: '2.0', persistent_store: true, stored_readings: db.sensorReadings.length, observations: db.observations.length, assessment_snapshots: db.assessmentSnapshots.length, action_plans: db.actionPlans.length, datasets: db.trainingDatasets.length, time: new Date().toISOString() });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/sensors/latest') {
        const siteId = url.searchParams.get('site_id') || '';
        send(200, { sensors: latestBySensor(db.sensorReadings, siteId), total_readings: db.sensorReadings.length });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/sensor-readings') {
        const siteId = url.searchParams.get('site_id') || '';
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        const filtered = siteId ? db.sensorReadings.filter(item => item.site_id === siteId) : db.sensorReadings;
        send(200, { readings: filtered.slice(-limit).reverse(), total: filtered.length, persistent: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/sensor-readings') {
        const body = await readBody(MAX_SENSOR_BODY);
        const payload = normalizeSensorPayload(body);
        db.sensorReadings.push(payload);
        if (db.sensorReadings.length > MAX_SENSOR_READINGS) db.sensorReadings.splice(0, db.sensorReadings.length - MAX_SENSOR_READINGS);
        const values = sensorValuesForHistory(payload.readings);
        if (Object.keys(values).length) {
          db.observations.push(makeObservation({
            siteId: payload.site_id, sourceType: payload.source === 'simulated' ? 'simulated-sensor' : 'sensor',
            timestamp: payload.timestamp, values,
            metadata: { sensor_id: payload.sensor_id, site_name: payload.site_name, lat: payload.lat, lon: payload.lon, source: payload.source },
          }));
          if (db.observations.length > MAX_OBSERVATIONS) db.observations.splice(0, db.observations.length - MAX_OBSERVATIONS);
        }
        await store.persist();
        send(201, { ok: true, reading: payload, stored_readings: db.sensorReadings.length, persistent: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/observations') {
        const body = await readBody();
        const siteId = String(body.site_id || '').trim();
        const sourceType = String(body.source_type || '').trim();
        if (!siteId) throw Object.assign(new Error('site_id is required.'), { status: 400 });
        if (!['manual-input', 'laboratory-upload', 'field-measurement', 'official-dataset'].includes(sourceType)) throw Object.assign(new Error('Unsupported observation source_type.'), { status: 400 });
        const record = makeObservation({ siteId, sourceType, timestamp: body.timestamp, values: body.values, metadata: body.metadata });
        db.observations.push(record);
        if (db.observations.length > MAX_OBSERVATIONS) db.observations.splice(0, db.observations.length - MAX_OBSERVATIONS);
        await store.persist();
        send(201, { ok: true, observation: record, persistent: true });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/observations') {
        const siteId = url.searchParams.get('site_id') || '';
        const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 100));
        const filtered = siteId ? db.observations.filter(item => item.site_id === siteId) : db.observations;
        send(200, { observations: filtered.slice(-limit).reverse(), total: filtered.length, persistent: true });
        return;
      }
      const historyMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/history$/);
      if (req.method === 'GET' && historyMatch) {
        const siteId = decodeURIComponent(historyMatch[1]);
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || 100));
        const records = db.observations.filter(item => item.site_id === siteId).slice(-limit).reverse();
        send(200, { site_id: siteId, records, total: db.observations.filter(item => item.site_id === siteId).length, persistent: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/assessment-snapshots') {
        const body = await readBody();
        if (!body.site_id || !body.assessment || typeof body.assessment !== 'object') throw Object.assign(new Error('site_id and assessment are required.'), { status: 400 });
        const snapshot = { id: randomUUID(), site_id: String(body.site_id), timestamp: body.timestamp || new Date().toISOString(), assessment: body.assessment, fusion: body.fusion || {}, profile: body.profile || 'surface' };
        db.assessmentSnapshots.push(snapshot);
        if (db.assessmentSnapshots.length > MAX_SNAPSHOTS) db.assessmentSnapshots.splice(0, db.assessmentSnapshots.length - MAX_SNAPSHOTS);
        await store.persist();
        send(201, { ok: true, snapshot });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/assessment-snapshots') {
        const siteId = url.searchParams.get('site_id') || '';
        const list = siteId ? db.assessmentSnapshots.filter(item => item.site_id === siteId) : db.assessmentSnapshots;
        send(200, { snapshots: list.slice(-250).reverse(), total: list.length });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/action-plans') {
        const siteId = url.searchParams.get('site_id') || '';
        const plans = siteId ? db.actionPlans.filter(item => item.site_id === siteId) : db.actionPlans;
        send(200, { plans: plans.slice(-100).reverse(), total: plans.length });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/action-plans') {
        const body = await readBody();
        if (!body.site_id || !String(body.title || '').trim() || !Array.isArray(body.actions) || !body.actions.length) throw Object.assign(new Error('site_id, title and at least one action are required.'), { status: 400 });
        const plan = { id: randomUUID(), site_id: String(body.site_id), site_name: String(body.site_name || body.site_id), title: String(body.title).slice(0, 160), rationale: String(body.rationale || '').slice(0, 2000), evidence: Array.isArray(body.evidence) ? body.evidence.slice(0, 30) : [], actions: body.actions.slice(0, 20).map(item => String(item).slice(0, 500)), status: 'proposed', created_at: new Date().toISOString(), review: null, physical_execution: false };
        db.actionPlans.push(plan);
        await store.persist();
        send(201, { ok: true, plan });
        return;
      }
      const planMatch = url.pathname.match(/^\/api\/action-plans\/([^/]+)\/review$/);
      if (req.method === 'PATCH' && planMatch) {
        const body = await readBody(64 * 1024);
        const plan = db.actionPlans.find(item => item.id === decodeURIComponent(planMatch[1]));
        if (!plan) { send(404, { error: 'Action plan not found.' }); return; }
        if (!['approved', 'rejected', 'completed'].includes(body.status)) throw Object.assign(new Error('Review status must be approved, rejected or completed.'), { status: 400 });
        if (!String(body.reviewer || '').trim()) throw Object.assign(new Error('Reviewer name or role is required.'), { status: 400 });
        plan.status = body.status;
        plan.review = { reviewer: String(body.reviewer).slice(0, 120), note: String(body.note || '').slice(0, 1000), reviewed_at: new Date().toISOString() };
        plan.physical_execution = false;
        await store.persist();
        send(200, { ok: true, plan, note: 'Review recorded only. No valve, pump, gate or other physical equipment was operated.' });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/training/datasets') {
        send(200, { datasets: db.trainingDatasets, runs: db.trainingRuns.slice(-20).reverse(), persistent: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/training/datasets') {
        const body = await readBody(16 * 1024 * 1024);
        const csv = String(body.csv || '');
        if (!csv.trim() || csv.length > 14 * 1024 * 1024) throw Object.assign(new Error('A non-empty CSV file smaller than 14 MB is required.'), { status: 400 });
        if (!String(body.source_name || '').trim() || !String(body.label_basis || '').trim() || !String(body.data_origin || '').trim()) throw Object.assign(new Error('Source name, data origin and label basis are required for training provenance.'), { status: 400 });
        if (/simulat|synthetic|mock|demo/i.test(String(body.data_origin))) throw Object.assign(new Error('Simulated, synthetic, mock or demo data cannot be used as verified model-training data.'), { status: 400 });
        const parsed = parseCsvMeta(csv);
        if (!parsed.headers.includes('site_id') || !parsed.headers.includes('quality_class')) throw Object.assign(new Error('Training CSV must include site_id and quality_class columns. See training/template.csv.'), { status: 400 });
        const id = randomUUID();
        const fileName = safeName(body.file_name, 'water-training-data.csv');
        const datasetPath = path.join(trainingDir, 'datasets', `${id}.csv`);
        const metaPath = path.join(trainingDir, 'datasets', `${id}.json`);
        await mkdir(path.dirname(datasetPath), { recursive: true });
        await writeFile(datasetPath, csv, 'utf8');
        const meta = { id, file_name: fileName, file_path: datasetPath, sha256: createHash('sha256').update(csv).digest('hex'), bytes: Buffer.byteLength(csv), headers: parsed.headers, approximate_rows: parsed.approximateRows, source_name: String(body.source_name).slice(0, 200), source_url: String(body.source_url || '').slice(0, 1000), data_origin: String(body.data_origin).slice(0, 120), label_basis: String(body.label_basis).slice(0, 1000), licence: String(body.licence || '').slice(0, 500), uploaded_at: new Date().toISOString(), training_status: 'uploaded_not_trained' };
        await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf8');
        db.trainingDatasets.push({ ...meta, file_path: undefined });
        await store.persist();
        send(201, { ok: true, dataset: { ...meta, file_path: undefined }, message: 'Dataset saved. It has not been trained or validated yet.' });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/training/run') {
        const body = await readBody(64 * 1024);
        const dataset = db.trainingDatasets.find(item => item.id === body.dataset_id);
        if (!dataset) throw Object.assign(new Error('Select an uploaded training dataset first.'), { status: 404 });
        const datasetPath = path.join(trainingDir, 'datasets', `${dataset.id}.csv`);
        const metadataPath = path.join(trainingDir, 'datasets', `${dataset.id}.json`);
        const outputDir = path.join(root, 'training', 'output');
        const scriptPath = path.join(root, 'training', 'train_water_models.py');
        const python = pythonCommand(root);
        const baseArgs = [scriptPath, datasetPath, '--metadata', metadataPath, '--output', outputDir];
        try {
          let result;
          try {
            result = await execFileAsync(python.command, baseArgs, { cwd: root, timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
          } catch (localError) {
            // A missing local venv is normal until the user installs optional training dependencies.
            if (localError.code !== 'ENOENT') throw localError;
            result = await execFileAsync(python.fallback, [...python.prefixArgs, ...baseArgs], { cwd: root, timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
          }
          let report = {};
          try { report = JSON.parse(result.stdout.trim().split('\n').at(-1)); } catch { report = { output: result.stdout.slice(-5000) }; }
          const run = { id: randomUUID(), dataset_id: dataset.id, dataset_name: dataset.file_name, completed_at: new Date().toISOString(), status: 'completed', report };
          db.trainingRuns.push(run); dataset.training_status = 'trained_experimental'; await store.persist();
          send(200, { ok: true, run, message: 'Experimental model training completed. Review the held-out evaluation before any research use.' });
        } catch (error) {
          const stderr = String(error.stderr || error.message || 'Training failed.').slice(0, 5000);
          const run = { id: randomUUID(), dataset_id: dataset.id, dataset_name: dataset.file_name, completed_at: new Date().toISOString(), status: 'failed', error: stderr };
          db.trainingRuns.push(run); await store.persist();
          send(400, { error: `Training could not run. Check Python and training/requirements.txt. ${stderr}` });
        }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/ai/predict') {
        const body = await readBody(64 * 1024);
        const modelPath = path.join(root, 'training', 'output', 'quality_model.joblib');
        const inputJson = JSON.stringify(body.features || {});
        const scriptPath = path.join(root, 'training', 'predict_water_model.py');
        const python = pythonCommand(root);
        const baseArgs = [scriptPath, '--model', modelPath, '--features', inputJson];
        try {
          let result;
          try {
            result = await execFileAsync(python.command, baseArgs, { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
          } catch (localError) {
            if (localError.code !== 'ENOENT') throw localError;
            result = await execFileAsync(python.fallback, [...python.prefixArgs, ...baseArgs], { cwd: root, timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true });
          }
          send(200, { ok: true, prediction: JSON.parse(result.stdout.trim()) });
        } catch (error) {
          const message = String(error.stderr || error.message || 'No trained model is available.').slice(0, 4000);
          send(409, { error: message.includes('No trained') ? message : `No usable trained model is available yet. ${message}` });
        }
        return;
      }
      send(404, { error: 'Unknown JalRakshak API route.' });
    } catch (error) {
      send(error.status || 400, { error: error instanceof Error ? error.message : 'JalRakshak API request failed.' });
    }
  }

  return {
    name: 'jalrakshak-persistent-data-platform',
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}

export const sensorGatewayPlugin = decisionSupportPlugin;
