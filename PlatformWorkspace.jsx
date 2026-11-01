import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BrainCircuit, CheckCircle2, Clock3, Database, Download, FileSpreadsheet, History, Play, RefreshCw, ShieldCheck, Upload, XCircle } from 'lucide-react';

const FEATURE_KEYS = {
  pH: 'ph', turbidity: 'turbidity_ntu', dissolvedOxygen: 'dissolved_oxygen_mg_l', tds: 'tds_mg_l',
  temperature: 'temperature_c', conductivity: 'conductivity_us_cm', nitrate: 'nitrate_mg_l',
  phosphate: 'phosphate_mg_l', ammonia: 'ammonia_mg_l', bod: 'bod_mg_l', cod: 'cod_mg_l',
  hardness: 'hardness_mg_l', alkalinity: 'alkalinity_mg_l', lead: 'lead_ug_l', mercury: 'mercury_ug_l',
  cadmium: 'cadmium_ug_l', arsenic: 'arsenic_ug_l', ecoli: 'ecoli_cfu_100ml',
};

function prettyDate(value) {
  if (!value) return 'Date not recorded';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'Date not recorded' : parsed.toLocaleString();
}

function sourceLabel(source) {
  return ({ sensor: 'DEVICE SENSOR', 'simulated-sensor': 'SIMULATED SENSOR', 'laboratory-upload': 'LABORATORY', 'manual-input': 'MANUAL ENTRY', 'field-measurement': 'FIELD MEASUREMENT', 'official-dataset': 'OFFICIAL DATASET' })[source] || String(source || 'UNKNOWN').toUpperCase();
}

function HistoryPanel({ siteId, siteName, provenance }) {
  const [records, setRecords] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('Loading stored observations…');

  const refresh = useCallback(async () => {
    setState('loading');
    try {
      const [historyResponse, snapshotResponse] = await Promise.all([
        fetch(`/api/sites/${encodeURIComponent(siteId)}/history?limit=100`),
        fetch(`/api/assessment-snapshots?site_id=${encodeURIComponent(siteId)}`),
      ]);
      if (!historyResponse.ok) throw new Error(`History API returned HTTP ${historyResponse.status}`);
      const history = await historyResponse.json();
      const snapshotData = snapshotResponse.ok ? await snapshotResponse.json() : { snapshots: [] };
      setRecords(Array.isArray(history.records) ? history.records : []);
      setSnapshots(Array.isArray(snapshotData.snapshots) ? snapshotData.snapshots : []);
      setState('online');
      setMessage(`${history.total || 0} observation record(s) stored permanently for this site.`);
    } catch (error) {
      setState('offline');
      setMessage(error instanceof Error ? error.message : 'Could not load history. Start JalRakshak with npm run dev.');
    }
  }, [siteId]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 12000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const latest = records.slice(0, 8);
  const sources = useMemo(() => [...new Set(records.map(item => item.source_type))], [records]);
  const parameterCount = useMemo(() => new Set(records.flatMap(item => Object.keys(item.values || {}))).size, [records]);
  const currentParameterCount = provenance?.length || 0;

  return (
    <section className="platform-panel history-panel" aria-labelledby="history-panel-title">
      <div className="platform-panel-heading">
        <div><span className="section-eyebrow">PERSISTENT ENVIRONMENTAL RECORD</span><h2 id="history-panel-title"><History size={18} /> Historical monitoring and trends</h2></div>
        <button className="secondary-button" onClick={refresh}><RefreshCw size={13} /> Refresh</button>
      </div>
      <p className="platform-panel-intro">Sensor observations, manual entries and laboratory results saved by this JalRakshak installation are collected here. Records remain on this computer in the local data store when the development server is restarted.</p>
      <div className={`platform-api-status ${state}`}><span />{message}</div>
      <div className="platform-stat-grid">
        <div><strong>{records.length}</strong><span>Stored observations in current history window</span></div>
        <div><strong>{parameterCount}</strong><span>Distinct parameters seen historically</span></div>
        <div><strong>{sources.length}</strong><span>Different source types recorded</span></div>
        <div><strong>{currentParameterCount}</strong><span>Parameters in current assessment</span></div>
      </div>
      {latest.length ? <div className="history-record-list">
        {latest.map(record => <article className="history-record" key={record.id}>
          <div className="history-record-head"><span className="history-source-chip">{sourceLabel(record.source_type)}</span><time>{prettyDate(record.timestamp)}</time></div>
          <div className="history-values">{Object.entries(record.values || {}).slice(0, 8).map(([key, value]) => <span key={key}><b>{key.replaceAll('_', ' ')}</b> {value}</span>)}</div>
          {record.metadata?.sample_id && <small>Sample ID: {record.metadata.sample_id}</small>}
          {record.metadata?.sensor_id && <small>Sensor ID: {record.metadata.sensor_id}</small>}
        </article>)}
      </div> : <div className="platform-empty"><Database size={19} /><strong>No permanent measurements saved yet</strong><span>Send a sensor reading, apply manual values, or upload a laboratory report to start building this site's history.</span></div>}
      <div className="snapshot-history"><div className="snapshot-history-head"><strong>Previous assessment snapshots</strong><span>{snapshots.length} saved</span></div>
        {snapshots.slice(0, 4).map(snapshot => <div className="snapshot-row" key={snapshot.id}><span>{prettyDate(snapshot.timestamp)}</span><strong>{snapshot.assessment?.priorityLabel || 'Assessment saved'}</strong><small>{snapshot.assessment?.measuredCount ?? '—'} measured · {snapshot.assessment?.flags?.length ?? 0} flag(s)</small></div>)}
        {!snapshots.length && <small>No assessment snapshots have been saved yet.</small>}
      </div>
      <div className="platform-panel-note"><AlertTriangle size={13} /> History is local to this project folder and computer. Back up the `data` folder to preserve it. No cloud account or off-device sync is configured.</div>
    </section>
  );
}

function TrainingWorkspace({ siteId, siteName, provenance }) {
  const [datasets, setDatasets] = useState([]);
  const [runs, setRuns] = useState([]);
  const [sourceName, setSourceName] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [dataOrigin, setDataOrigin] = useState('official monitoring dataset');
  const [labelBasis, setLabelBasis] = useState('');
  const [licence, setLicence] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [prediction, setPrediction] = useState(null);
  const [features, setFeatures] = useState({});

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/training/datasets');
      if (!response.ok) throw new Error('Training workspace API is not available.');
      const data = await response.json();
      setDatasets(data.datasets || []);
      setRuns(data.runs || []);
    } catch (error) {
      setStatus({ tone: 'warning', text: error.message || 'Could not load training workspace.' });
    }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const map = {};
    for (const item of provenance || []) {
      const feature = FEATURE_KEYS[item.key];
      if (feature) map[feature] = Number(item.value);
    }
    setFeatures(map);
    setPrediction(null);
  }, [siteId, provenance]);

  const uploadDataset = async event => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true); setStatus({ tone: 'info', text: 'Reading dataset and recording its provenance…' });
    try {
      if (!file.name.toLowerCase().endsWith('.csv')) throw new Error('The training workspace accepts curated CSV files. Convert spreadsheets to CSV after checking the units and labels.');
      const csv = await file.text();
      const response = await fetch('/api/training/datasets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: file.name, csv, source_name: sourceName, source_url: sourceUrl, data_origin: dataOrigin, label_basis: labelBasis, licence }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Dataset upload failed.');
      setStatus({ tone: 'good', text: `${data.dataset.file_name} saved (${data.dataset.approximate_rows} approximate data row(s)). It has not been trained yet.` });
      await refresh();
    } catch (error) { setStatus({ tone: 'danger', text: error.message || 'Could not upload dataset.' }); }
    finally { setBusy(false); input.value = ''; }
  };

  const train = async dataset => {
    setBusy(true); setStatus({ tone: 'info', text: `Training experimental model with ${dataset.file_name}. This may take several minutes.` });
    try {
      const response = await fetch('/api/training/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataset_id: dataset.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Model training failed.');
      setStatus({ tone: 'good', text: `Training complete. Review balanced accuracy and macro-F1 in the evaluation report before using this model.` });
      await refresh();
    } catch (error) { setStatus({ tone: 'danger', text: error.message || 'Model training failed.' }); }
    finally { setBusy(false); }
  };

  const runPrediction = async () => {
    setBusy(true); setPrediction(null); setStatus({ tone: 'info', text: 'Requesting prediction from the locally trained model…' });
    try {
      const response = await fetch('/api/ai/predict', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site_id: siteId, features }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No trained model is ready.');
      setPrediction(data.prediction);
      setStatus({ tone: 'good', text: `Model prediction returned for ${siteName}. It is a research output, not a water-safety verdict.` });
    } catch (error) { setStatus({ tone: 'warning', text: error.message || 'Could not run prediction.' }); }
    finally { setBusy(false); }
  };

  const downloadTemplate = () => {
    const text = 'timestamp,site_id,latitude,longitude,waterbody_type,ph,turbidity_ntu,dissolved_oxygen_mg_l,tds_mg_l,temperature_c,conductivity_us_cm,nitrate_mg_l,phosphate_mg_l,ammonia_mg_l,bod_mg_l,cod_mg_l,hardness_mg_l,alkalinity_mg_l,lead_ug_l,mercury_ug_l,cadmium_ug_l,arsenic_ug_l,ecoli_cfu_100ml,quality_class,cause_class\n';
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'jalrakshak-labelled-training-template.csv'; anchor.click(); URL.revokeObjectURL(url);
  };

  return (
    <section className="platform-panel training-panel" aria-labelledby="training-panel-title">
      <div className="platform-panel-heading"><div><span className="section-eyebrow">MODEL DEVELOPMENT WORKSPACE</span><h2 id="training-panel-title"><BrainCircuit size={18} /> AI training, evaluation and inference</h2></div><span className="assessment-chip">REAL LABELS REQUIRED</span></div>
      <p className="platform-panel-intro">Upload a documented, labelled water-quality CSV, train an experimental model locally, inspect the held-out evaluation, and run a prediction against the selected site's current measurements. This project does not include a pre-trained model or fabricate training records.</p>
      <div className="training-metadata-grid">
        <label><span>Dataset / publisher name *</span><input value={sourceName} onChange={event => setSourceName(event.target.value)} placeholder="CPCB NWMP / laboratory / agency" /></label>
        <label><span>Data origin *</span><select value={dataOrigin} onChange={event => setDataOrigin(event.target.value)}><option value="official monitoring dataset">Official monitoring dataset</option><option value="laboratory observations">Laboratory observations</option><option value="field sensor observations">Field sensor observations</option><option value="curated verified research data">Curated verified research data</option><option value="synthetic demo data">Synthetic/demo data (blocked)</option></select></label>
        <label><span>Source URL (recommended)</span><input value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} placeholder="https://…" /></label>
        <label><span>How were quality labels assigned? *</span><input value={labelBasis} onChange={event => setLabelBasis(event.target.value)} placeholder="Documented standard / qualified lab classification" /></label>
        <label><span>Licence / access terms</span><input value={licence} onChange={event => setLicence(event.target.value)} placeholder="Licence, terms or permission" /></label>
      </div>
      <div className="training-actions">
        <label className={`csv-file-button ${busy || !sourceName.trim() || !labelBasis.trim() ? 'disabled' : ''}`}><Upload size={13} /> Upload labelled CSV<input type="file" accept=".csv,text/csv" disabled={busy || !sourceName.trim() || !labelBasis.trim()} onChange={uploadDataset} /></label>
        <button className="secondary-button" type="button" onClick={downloadTemplate}><Download size={13} /> Download CSV schema</button>
      </div>
      {status && <div className={`platform-feedback ${status.tone}`} role="status">{status.text}</div>}
      <div className="training-dataset-list">
        <div className="snapshot-history-head"><strong>Uploaded datasets</strong><span>{datasets.length} stored</span></div>
        {datasets.map(dataset => <article className="training-dataset" key={dataset.id}>
          <div className="training-dataset-title"><div><FileSpreadsheet size={16} /><strong>{dataset.file_name}</strong></div><span>{dataset.training_status || 'uploaded · not trained'}</span></div>
          <p>{dataset.source_name} · {dataset.data_origin} · {dataset.approximate_rows} approximate rows</p>
          <small>SHA-256: {dataset.sha256} · Label basis: {dataset.label_basis}</small>
          <button className="primary-button" type="button" disabled={busy || dataset.approximate_rows < 100} onClick={() => train(dataset)}><Play size={13} /> Train experimental model</button>
          {dataset.approximate_rows < 100 && <small>At least 100 labelled rows and five distinct monitoring sites are required by the training script.</small>}
        </article>)}
        {!datasets.length && <div className="platform-empty"><Database size={19} /><strong>No training datasets uploaded</strong><span>Use documented real observations and preserve the licence, collection method, labels and site identifiers.</span></div>}
      </div>
      <div className="training-run-list">
        <div className="snapshot-history-head"><strong>Training / evaluation runs</strong><span>{runs.length} recorded</span></div>
        {runs.slice(0, 5).map(run => <article className="training-run" key={run.id}><div><strong>{run.dataset_name}</strong><span>{run.status} · {prettyDate(run.completed_at)}</span></div>{run.report?.quality_metrics && <div className="training-metrics"><span>Accuracy <b>{(run.report.quality_metrics.accuracy * 100).toFixed(1)}%</b></span><span>Balanced accuracy <b>{(run.report.quality_metrics.balanced_accuracy * 100).toFixed(1)}%</b></span><span>Macro-F1 <b>{(run.report.quality_metrics.macro_f1 * 100).toFixed(1)}%</b></span></div>}{run.error && <small>{run.error}</small>}</article>)}
        {!runs.length && <small>No model training run has been recorded.</small>}
      </div>
      <div className="trained-model-prediction">
        <div className="snapshot-history-head"><strong>Prediction for selected site</strong><span>{Object.keys(features).length} recognised feature(s)</span></div>
        <p>Current readings from the sensor/manual/laboratory fusion will be matched to the trained model's features. A model prediction is only available after a successful training run.</p>
        <button className="secondary-button" disabled={busy || !Object.keys(features).length} onClick={runPrediction}><BrainCircuit size={13} /> Run trained-model prediction</button>
        {prediction && <div className="prediction-result"><strong>Predicted class: {prediction.predicted_quality_class}</strong><span>{prediction.top_class_probability_uncalibrated === null ? 'Probability not available' : `Uncalibrated top-class probability: ${(prediction.top_class_probability_uncalibrated * 100).toFixed(1)}%`}</span><small>Model trained from: {prediction.source_name} · {prediction.validation}</small>{prediction.cause_prediction && <><strong>Predicted investigation class: {prediction.cause_prediction.predicted_cause_class}</strong><small>Cause-class output is a model hypothesis, not source attribution.</small></>}<small>{prediction.warning}</small></div>}
      </div>
      <div className="platform-panel-note"><AlertTriangle size={13} /> Accuracy is dataset- and site-dependent. Require external validation, calibrated measurements and qualified labels. A classifier cannot certify water as safe or independently identify a polluter.</div>
    </section>
  );
}

function DecisionSupportWorkspace({ siteId, siteName, assessment, environmentalContext, remedyPlan }) {
  const [plans, setPlans] = useState([]);
  const [reviewer, setReviewer] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/action-plans?site_id=${encodeURIComponent(siteId)}`);
      if (!response.ok) throw new Error('Decision-support service is unavailable.');
      const data = await response.json(); setPlans(data.plans || []);
    } catch (error) { setStatus({ tone: 'warning', text: error.message }); }
  }, [siteId]);
  useEffect(() => { refresh(); }, [refresh]);

  const createPlan = async () => {
    const actions = [...new Set([...(assessment.nextSteps || []), ...(remedyPlan || []).flatMap(item => item.actions || [])])].slice(0, 12);
    if (!actions.length) { setStatus({ tone: 'warning', text: 'No evidence-based follow-up actions are available yet. Add measurements or laboratory results first.' }); return; }
    setBusy(true);
    try {
      const response = await fetch('/api/action-plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site_id: siteId, site_name: siteName, title: `Water protection review — ${siteName}`, rationale: assessment.summary, evidence: (environmentalContext?.likelyCauses || []).map(item => `${item.title}: ${item.explanation}`), actions }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not save action plan.');
      setStatus({ tone: 'good', text: 'A proposed response plan has been saved to the persistent local database. No equipment was operated.' }); await refresh();
    } catch (error) { setStatus({ tone: 'danger', text: error.message }); }
    finally { setBusy(false); }
  };

  const review = async (plan, nextStatus) => {
    if (!reviewer.trim()) { setStatus({ tone: 'warning', text: 'Enter the responsible reviewer name or role before recording a review.' }); return; }
    setBusy(true);
    try {
      const response = await fetch(`/api/action-plans/${encodeURIComponent(plan.id)}/review`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: nextStatus, reviewer, note: 'Recorded as a human review only. Any physical operation requires separate site procedures and controls.' }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not record review.');
      setStatus({ tone: 'good', text: data.note || 'Review recorded.' }); await refresh();
    } catch (error) { setStatus({ tone: 'danger', text: error.message }); }
    finally { setBusy(false); }
  };

  return (
    <section className="platform-panel decision-panel" aria-labelledby="decision-panel-title">
      <div className="platform-panel-heading"><div><span className="section-eyebrow">WATER PROTECTION DECISION SUPPORT</span><h2 id="decision-panel-title"><ShieldCheck size={18} /> Recommended action plans</h2></div><span className="assessment-chip">HUMAN REVIEW REQUIRED</span></div>
      <p className="platform-panel-intro">Turn assessment follow-up items and remedy recommendations into a persistent review plan. This records recommendations and human review only; it never controls a valve, pump, gate or treatment system.</p>
      <button className="primary-button" type="button" disabled={busy} onClick={createPlan}><CheckCircle2 size={13} /> Create proposed protection plan</button>
      <label className="reviewer-field"><span>Responsible reviewer / operator role</span><input value={reviewer} onChange={event => setReviewer(event.target.value)} placeholder="e.g. Water quality supervisor" /></label>
      {status && <div className={`platform-feedback ${status.tone}`} role="status">{status.text}</div>}
      <div className="action-plan-list">
        {plans.map(plan => <article className="action-plan-card" key={plan.id}>
          <div className="action-plan-title"><strong>{plan.title}</strong><span className={`plan-status ${plan.status}`}>{plan.status.replaceAll('_', ' ')}</span></div>
          <p>{plan.rationale}</p>
          <ol>{plan.actions.map((action, index) => <li key={`${plan.id}-${index}`}>{action}</li>)}</ol>
          {plan.evidence?.length > 0 && <details><summary>Evidence and investigation context ({plan.evidence.length})</summary><ul>{plan.evidence.map((item, index) => <li key={`${plan.id}-e-${index}`}>{item}</li>)}</ul></details>}
          {plan.review && <small>Reviewed by {plan.review.reviewer} · {prettyDate(plan.review.reviewed_at)} · {plan.review.note}</small>}
          {plan.status === 'proposed' && <div className="action-plan-review-actions"><button className="secondary-button" disabled={busy} onClick={() => review(plan, 'approved')}><CheckCircle2 size={12} /> Record approval</button><button className="secondary-button" disabled={busy} onClick={() => review(plan, 'rejected')}><XCircle size={12} /> Reject plan</button></div>}
        </article>)}
        {!plans.length && <div className="platform-empty"><ShieldCheck size={19} /><strong>No protection plans saved</strong><span>Create a proposed plan after reviewing the available measurements, environmental evidence and treatment cautions.</span></div>}
      </div>
      <div className="platform-panel-note"><AlertTriangle size={13} /> A plan marked “approved” is an approval record only. It is not an instruction to actuate hardware. Site operators must apply independent procedures, confirm hazards and verify equipment state.</div>
    </section>
  );
}

export default function PlatformWorkspace({ siteId, siteName, provenance, assessment, environmentalContext, remedyPlan }) {
  return <div className="platform-workspace-grid">
    <HistoryPanel siteId={siteId} siteName={siteName} provenance={provenance} />
    <div className="platform-workspace-stack">
      <TrainingWorkspace siteId={siteId} siteName={siteName} provenance={provenance} />
      <DecisionSupportWorkspace siteId={siteId} siteName={siteName} assessment={assessment} environmentalContext={environmentalContext} remedyPlan={remedyPlan} />
    </div>
  </div>;
}
