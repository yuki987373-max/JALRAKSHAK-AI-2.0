import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowLeft, ArrowUpRight, BarChart3,
  Bell, CheckCircle2, ChevronRight, CircleDot, Clock3, Droplets, ExternalLink,
  Factory, FileSpreadsheet, FlaskConical, Gauge, Layers3, MapPin, Maximize2, RadioTower,
  RotateCcw, Scan, Search, ShieldCheck, SlidersHorizontal, Sparkles, Upload, Waves,
  Wind, Zap
} from 'lucide-react';
import WaterScene from './components/WaterScene.jsx';
import LocationWaterExplorer from './components/LocationWaterExplorer.jsx';
import LocationWaterHologram from './components/LocationWaterHologram.jsx';
import SensorHub from './components/SensorHub.jsx';
import PlatformWorkspace from './components/PlatformWorkspace.jsx';
import { navItems, siteData } from './data.js';
import { analyseWaterQuality, applySampleValues } from './analysisEngine.js';
import { metricsFromCsvValues, SAMPLE_WATER_CSV } from './csvImport.js';
import { parseWaterReadingsFile, SUPPORTED_IMPORT_EXTENSIONS } from './universalImport.js';
import { fuseWaterData, describeDataFusion } from './waterDataFusion.js';
import { MANUAL_PARAMETER_GROUPS, parseManualMeasurementText, validateManualMeasurements } from './manualMeasurements.js';
import { analyseEnvironmentalContext, buildRemedyPlan } from './environmentalAssessment.js';

function StatusPill({ tone = 'info', children }) {
  return <span className={`status-pill ${tone}`}><span className="status-dot" />{children}</span>;
}

function MetricCard({ metric }) {
  const [label, value, unit, originalTone] = metric;
  const numeric = Number.parseFloat(String(value).replaceAll(',', ''));
  let tone = originalTone;
  const normalized = label.toLowerCase();
  if (/\bph\b/.test(normalized) && Number.isFinite(numeric)) tone = numeric < 6.5 || numeric > 8.5 ? 'danger' : 'good';
  else if (normalized.includes('turbidity') && Number.isFinite(numeric)) tone = numeric > 25 ? 'danger' : numeric > 5 ? 'warning' : 'good';
  else if (normalized.includes('dissolved oxygen') && Number.isFinite(numeric)) tone = numeric < 3 ? 'danger' : numeric < 5 ? 'warning' : 'good';
  else if (/\btds\b/.test(normalized) && Number.isFinite(numeric)) tone = numeric > 500 ? 'warning' : 'good';
  return (
    <div className="metric-card">
      <span className="metric-label">{label}</span>
      <div className="metric-value-row">
        <strong className={tone}>{value}</strong><span>{unit}</span>
      </div>
      <div className="metric-meter"><span className={tone} style={{ width: tone === 'danger' ? '83%' : tone === 'warning' ? '66%' : '44%' }} /></div>
    </div>
  );
}

function navIcon(id) {
  const common = { size: 17, strokeWidth: 1.8 };
  if (id === 'river') return <Waves {...common} />;
  if (id === 'hotspot') return <AlertTriangle {...common} />;
  if (id === 'sensor') return <RadioTower {...common} />;
  if (id === 'reservoir') return <Droplets {...common} />;
  if (id === 'source') return <Factory {...common} />;
  return <FlaskConical {...common} />;
}

function mappedFeatureIcon(category) {
  const common = { size: 15, strokeWidth: 1.8 };
  if (category === 'waterbody') return <Waves {...common} />;
  if (category === 'building') return <Factory {...common} />;
  if (category === 'industrial' || category === 'facility') return <Factory {...common} />;
  if (category === 'drainage' || category === 'water-infrastructure') return <Droplets {...common} />;
  if (category === 'road' || category === 'bridge' || category === 'railway') return <MapPin {...common} />;
  if (category === 'agriculture' || category === 'landuse') return <Wind {...common} />;
  return <Layers3 {...common} />;
}

function mappedFeatureName(feature, isWater = false) {
  if (feature.name && !/^Unnamed mapped feature$/i.test(feature.name)) return feature.name;
  if (isWater) return `${feature.kind || 'Water body'} · ${feature.osmType}/${feature.osmId}`;
  return `${feature.context?.label || 'Mapped feature'} · ${feature.osmType}/${feature.osmId}`;
}

function readNumericMetric(metrics, matcher) {
  const matches = metrics.filter(([label]) => matcher.test(label));
  const metric = matches.find(([label]) => /manual sample/i.test(label)) || matches[0];
  if (!metric) return '';
  const value = Number.parseFloat(String(metric[1]).replaceAll(',', ''));
  return Number.isFinite(value) ? String(value) : '';
}

function ManualMeasurementsPanel({ siteId, siteName, manualReadings, fusedData, onApply, onClear }) {
  const [draft, setDraft] = useState(() => ({ ...(manualReadings?.values || {}) }));
  const [pasteText, setPasteText] = useState('');
  const [message, setMessage] = useState(null);
  useEffect(() => {
    setDraft({ ...(manualReadings?.values || {}) });
    setPasteText('');
    setMessage(null);
  }, [siteId, manualReadings]);

  const update = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const fillFromPaste = () => {
    const parsed = parseManualMeasurementText(pasteText);
    if (!Object.keys(parsed.values).length) {
      setMessage({ tone: 'danger', text: 'No supported parameter/value pairs were found. Use formats such as pH=7.2, Turbidity=4.5, Conductivity=420.' });
      return;
    }
    setDraft(current => ({ ...current, ...Object.fromEntries(Object.entries(parsed.values).map(([key, value]) => [key, String(value)])) }));
    setMessage({ tone: parsed.unknown.length ? 'warning' : 'good', text: `${Object.keys(parsed.values).length} value(s) filled.${parsed.unknown.length ? ` Not recognised: ${parsed.unknown.join(', ')}.` : ''} Review the values and units before applying.` });
  };
  const submit = event => {
    event.preventDefault();
    const checked = validateManualMeasurements(draft);
    if (checked.errors.length) { setMessage({ tone: 'danger', text: checked.errors.join(' ') }); return; }
    if (!Object.keys(checked.values).length) { setMessage({ tone: 'danger', text: 'Enter at least one numeric measurement before analysing.' }); return; }
    onApply(siteId, checked.values);
    setMessage({ tone: 'good', text: `${Object.keys(checked.values).length} user-entered parameter(s) saved for ${siteName}. The assessment has been recalculated.` });
  };

  return (
    <section className="manual-assessment-panel" aria-labelledby="manual-assessment-title">
      <div className="manual-panel-heading">
        <div>
          <span className="section-eyebrow">MANUAL WATER-QUALITY INPUT</span>
          <h2 id="manual-assessment-title"><FlaskConical size={17} /> Enter or paste water measurements</h2>
          <p>Selected water body: <strong>{siteName}</strong>. Enter individual readings or paste parameter=value pairs. The water status, screening flags, likely-source investigation and remedy panels update from these values.</p>
        </div>
        <span className="assessment-chip">{Object.keys(manualReadings?.values || {}).length} MANUAL VALUES</span>
      </div>
      <div className="manual-paste-row">
        <label htmlFor="manual-bulk-readings">Paste multiple readings</label>
        <textarea id="manual-bulk-readings" value={pasteText} onChange={event => setPasteText(event.target.value)} rows={3} placeholder={'pH=7.2, Turbidity=4.5, Conductivity=420\nDissolved oxygen=6.8, Nitrate=2.1, E. coli=0'} />
        <button type="button" className="secondary-button" onClick={fillFromPaste}><FileSpreadsheet size={13} /> Fill fields from pasted values</button>
      </div>
      <form onSubmit={submit}>
        <div className="manual-group-grid">
          {MANUAL_PARAMETER_GROUPS.map((group, index) => (
            <details className="manual-parameter-group" key={group.title}>
              <summary><span>{group.title}</span><small>{group.fields.length} parameters</small></summary>
              <p>{group.description}</p>
              <div className="manual-fields-grid">
                {group.fields.map(field => (
                  <label key={field.key}>
                    <span>{field.label} {field.unit && <small>({field.unit})</small>}</span>
                    <input
                      aria-label={`${field.label}${field.unit ? ` in ${field.unit}` : ''}`}
                      type="number" min={field.min} max={field.max} step={field.step}
                      value={draft[field.key] ?? ''}
                      onChange={event => update(field.key, event.target.value)}
                      placeholder="Not entered"
                    />
                  </label>
                ))}
              </div>
            </details>
          ))}
        </div>
        <div className="manual-actions">
          <button type="submit" className="primary-button"><Scan size={14} /> Analyse all entered measurements</button>
          <button type="button" className="secondary-button" onClick={() => { onClear(siteId); setDraft({}); setMessage({ tone: 'info', text: 'Manual readings cleared for this water body. Sensor and laboratory records remain unchanged.' }); }} disabled={!Object.keys(manualReadings?.values || {}).length}><RotateCcw size={13} /> Clear manual entries</button>
          <span className="manual-coverage">{fusedData.parameterCount} combined parameter(s) currently assessed</span>
        </div>
      </form>
      {message && <div className={`manual-feedback ${message.tone}`} role="status" aria-live="polite">{message.text}</div>}
      <div className="manual-panel-note">Manual entries are labelled separately from sensor and laboratory data. Use the units shown, confirm chemical reporting bases (for example nitrate as NO₃⁻ versus NO₃-N), and verify values against original records. Empty fields are not treated as zero. This version uses transparent prototype screening rules and contextual evidence; it is not yet a trained or independently validated contamination-prediction model.</div>
    </section>
  );
}

function SelectedDescriptionPanel({ object }) {
  if (!object) return null;
  return (
    <section className="selected-description-panel" aria-live="polite">
      <div className="selected-description-heading">
        <div><span className="section-eyebrow">VISIBLE OBJECT DESCRIPTION</span><h2>{object.title}</h2><span className="selected-description-subtitle">{object.category || 'Selected mapped object'} {object.distanceLabel ? `· ${object.distanceLabel}` : ''}</span></div>
        <StatusPill tone="info">{object.sourceLabel || 'MAP-DERIVED'}</StatusPill>
      </div>
      <p className="selected-description-text">{object.description}</p>
      <div className="selected-description-grid">
        <div><strong>Geographical position</strong><span>{object.coordinates || 'Not provided'}</span></div>
        <div><strong>Relationship to water body</strong><span>{object.relevance || 'No verified physical or drainage connection is available.'}</span></div>
      </div>
      {object.tagItems?.length > 0 && <div className="selected-description-tags"><strong>Mapped attributes</strong><div>{object.tagItems.map(tag => <span key={tag.key}><b>{tag.key}</b> {tag.value}</span>)}</div></div>}
      <p className="selected-description-caution">Map tags describe mapped objects only. They do not confirm the structure's current use, occupancy, discharge, connection, or environmental impact.</p>
    </section>
  );
}

function EnvironmentalAssessmentPanels({ context, remedyPlan, assessment }) {
  return (
    <div className="environmental-panels-grid">
      <section className="environmental-panel cause-assessment-panel">
        <div className="environmental-panel-heading"><div><span className="section-eyebrow">CATCHMENT CONTEXT + MEASUREMENTS</span><h2><AlertTriangle size={17} /> Likely causes to investigate</h2></div><span className="assessment-chip">EVIDENCE-LED</span></div>
        <p className="environmental-panel-intro">This panel compares measured warning patterns with nearby mapped land use and infrastructure. It identifies investigation leads—not confirmed polluters.</p>
        <div className="cause-assessment-list">
          {context.likelyCauses.map(cause => <article className="cause-assessment-item" key={cause.key}>
            <div className="cause-assessment-title"><strong>{cause.title}</strong><span>{cause.confidence}</span></div>
            <p>{cause.explanation}</p>
            {cause.evidence.length > 0 && <div className="evidence-chips">{cause.evidence.map(item => <span key={item}>{item}</span>)}</div>}
            <div className="investigation-checks"><strong>Checks needed</strong><ul>{cause.checks.map(check => <li key={check}>{check}</li>)}</ul></div>
          </article>)}
        </div>
        <div className="context-factor-block"><div className="context-factor-title">Environmental factors considered</div><div className="context-factor-grid">
          {context.contextFactors.map(factor => <div className="context-factor-card" key={factor.key}><strong>{factor.label}</strong><b>{factor.value}</b><span>{factor.detail}</span></div>)}
        </div></div>
        <div className="data-gap-note"><strong>Important data gaps</strong>{context.dataGaps.map(gap => <span key={gap}>• {gap}</span>)}</div>
      </section>

      <section className="environmental-panel remedy-assessment-panel">
        <div className="environmental-panel-heading"><div><span className="section-eyebrow">RESPONSE PLANNING</span><h2><ShieldCheck size={17} /> Remedies and corrective actions</h2></div><span className="assessment-chip">CONDITION-DEPENDENT</span></div>
        <p className="environmental-panel-intro">Recommendations are matched to the measured indicators. A qualified water professional must confirm the contaminant and design treatment before action.</p>
        {remedyPlan.map(remedy => <article className="remedy-assessment-item" key={remedy.key}>
          <strong>{remedy.title}</strong><p>{remedy.why}</p>
          <ol>{remedy.actions.map(action => <li key={action}>{action}</li>)}</ol>
          {remedy.caution && <small>{remedy.caution}</small>}
        </article>)}
        {assessment.nextSteps?.length > 0 && <div className="extra-remedy-steps"><strong>Additional assessment follow-up</strong><ul>{assessment.nextSteps.slice(0, 5).map(step => <li key={step}>{step}</li>)}</ul></div>}
      </section>
    </div>
  );
}

function CsvImportPanel({ selected, importedInfo, onImport, onClear }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [labName, setLabName] = useState('');
  const [sampleId, setSampleId] = useState('');
  const [sampleDate, setSampleDate] = useState('');

  const handleFile = async event => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus({ tone: 'info', message: 'Preparing file…' });
    try {
      const parsed = await parseWaterReadingsFile(file, selected, message => setStatus({ tone: 'info', message }));
      const metrics = metricsFromCsvValues(parsed.values);
      if (metrics.length === 0) throw new Error('No supported numeric water measurements were found.');
      const enteredSampleDate = sampleDate ? new Date(sampleDate) : null;
      const measurementTimestamp = enteredSampleDate && !Number.isNaN(enteredSampleDate.getTime()) ? enteredSampleDate.toISOString() : parsed.timestamp;
      onImport(selected.id, {
        recordType: 'laboratory-report',
        labName: labName.trim(),
        sampleId: sampleId.trim(),
        sampledAt: measurementTimestamp,
        metrics,
        values: parsed.values,
        timestamp: measurementTimestamp,
        rowsMatched: parsed.rowsMatched,
        sourceSite: parsed.sourceSite,
        warnings: parsed.warnings || [],
        fileName: file.name,
        fileType: parsed.fileType || file.name.split('.').pop().toUpperCase(),
        extractionMethod: parsed.extractionMethod || 'File parser',
        importedAt: new Date().toISOString(),
      });
      setStatus({
        tone: parsed.warnings?.length ? 'warning' : 'good',
        message: `Loaded ${metrics.length} parameter(s) from ${parsed.rowsMatched} row(s). The results are now linked to ${selected.name} and will be combined with matching sensor measurements. Verify every extracted value against the original report.`,
      });
    } catch (error) {
      setStatus({ tone: 'danger', message: error instanceof Error ? error.message : 'Could not read this file.' });
    } finally {
      setBusy(false);
      input.value = '';
    }
  };

  const downloadSample = () => {
    const blob = new Blob([SAMPLE_WATER_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'jalrakshak-sample-water-readings.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="csv-import-panel">
      <div className="sample-editor-heading">
        <div><span className="section-eyebrow">LABORATORY DATA CONNECTOR</span><h3><FileSpreadsheet size={14} /> Upload laboratory results</h3></div>
        <span className="assessment-chip">v3.0.0</span>
      </div>
      <p className="sample-editor-copy">Upload a laboratory certificate, spreadsheet, PDF, or instrument export containing labelled water-quality measurements. The results are attached to the selected waterbody and fused parameter-by-parameter with sensor readings. Newer dated measurements take precedence for the same parameter.</p>
      <div className="lab-metadata-grid">
        <label><span>Laboratory name (optional)</span><input value={labName} onChange={event => setLabName(event.target.value)} placeholder="e.g. Water testing laboratory" /></label>
        <label><span>Sample ID (optional)</span><input value={sampleId} onChange={event => setSampleId(event.target.value)} placeholder="e.g. SAMPLE-001" /></label>
        <label><span>Sample collection date/time (recommended)</span><input type="datetime-local" value={sampleDate} onChange={event => setSampleDate(event.target.value)} /></label>
      </div>
      <div className="csv-import-actions">
        <label className={`csv-file-button ${busy ? 'disabled' : ''}`}>
          <Upload size={13} /> {busy ? 'Reading report…' : 'Choose laboratory report'}
          <input type="file" accept={SUPPORTED_IMPORT_EXTENSIONS} onChange={handleFile} disabled={busy} />
        </label>
        <button type="button" className="secondary-button csv-sample-button" onClick={downloadSample} disabled={busy}><FileSpreadsheet size={12} /> Sample CSV</button>
      </div>
      {status && <div className={`csv-import-status ${status.tone}`} role="status" aria-live="polite">{status.message}</div>}
      {importedInfo && <div className="csv-import-saved">
        <div className="csv-saved-heading"><span className="csv-saved-dot" /> Laboratory report linked to this waterbody</div>
        <strong title={importedInfo.fileName}>{importedInfo.fileName || 'Imported file'}</strong>
        <span>{Object.keys(importedInfo.values || {}).length} parameter(s){importedInfo.timestamp ? ` · latest timestamp ${importedInfo.timestamp}` : ''}</span>
        {importedInfo.labName && <span>Laboratory: {importedInfo.labName}</span>}
        {importedInfo.sampleId && <span>Sample ID: {importedInfo.sampleId}</span>}
        {importedInfo.extractionMethod && <span>Extraction: {importedInfo.extractionMethod}</span>}
        <button type="button" className="csv-clear-button" onClick={() => { onClear(selected.id); setStatus({ tone: 'info', message: 'Imported readings cleared for this object.' }); }}>Clear import for this object</button>
        {(importedInfo.warnings || []).map((warning, index) => <p className="csv-warning-copy" key={`${warning}-${index}`}>{warning}</p>)}
      </div>}
      <p className="csv-import-note">Supported formats include CSV, TSV, TXT, JSON, Excel, PDF, DOCX, HTML/XML, Markdown, and common images. Scanned documents may use OCR and can misread decimals or units. Check extracted values against the original report. The upload is processed in this browser and stored locally; it is not independently certified by JalRakshak AI.</p>
    </section>
  );
}


function WaterStatusCard({ assessment, fusion, labImport, selectedName, profile, onProfileChange }) {
  const statusTone = assessment.measuredCount === 0 ? 'warning' : assessment.flags.some(flag => flag.tone === 'danger') ? 'danger' : assessment.flags.length ? 'warning' : 'info';
  const sourceItems = [
    fusion.sourceMix.sensor ? `${fusion.sourceMix.sensor} parameter(s) from device sensors` : null,
    fusion.sourceMix.simulated ? `${fusion.sourceMix.simulated} parameter(s) from simulated sensors` : null,
    fusion.sourceMix.lab ? `${fusion.sourceMix.lab} parameter(s) selected from laboratory report` : null,
    fusion.sourceMix.manual ? `${fusion.sourceMix.manual} parameter(s) entered manually` : null,
  ].filter(Boolean);
  return (
    <section className="water-status-card" aria-live="polite">
      <div className="water-status-main">
        <div className="water-status-copy">
          <span className="section-eyebrow">CURRENT WATER QUALITY ASSESSMENT</span>
          <h3>{selectedName}</h3>
          <div className={`water-status-banner ${statusTone}`}><span className="water-status-dot" />{assessment.priorityLabel}</div>
          <p>{assessment.summary}</p>
          <div className="water-status-source-line">
            <strong>{fusion.parameterCount || fusion.metrics.length} parameter(s) available</strong>
            <span>{sourceItems.length ? sourceItems.join(' · ') : fusion.usedFallbackMetrics ? 'Demonstration data only' : 'No sensor or laboratory data yet'}</span>
          </div>
          {labImport && <div className="water-lab-provenance">Laboratory report: <strong>{labImport.fileName || 'Uploaded report'}</strong>{labImport.labName ? ` · ${labImport.labName}` : ''}{labImport.sampleId ? ` · Sample ${labImport.sampleId}` : ''}{labImport.timestamp ? ` · Sampled ${new Date(labImport.timestamp).toLocaleString()}` : ' · sample date not supplied'}</div>}
        </div>
        <div className="water-status-controls">
          <label htmlFor="assessment-profile">Assessment profile</label>
          <select id="assessment-profile" value={profile} onChange={event => onProfileChange(event.target.value)}>
            <option value="surface">Surface water screening</option>
            <option value="bis10500">Drinking-water reference check</option>
          </select>
          <div className="water-status-counts">
            <div><strong>{assessment.measuredCount}</strong><span>values available</span></div>
            <div><strong>{assessment.flags.length}</strong><span>screening flags</span></div>
            <div><strong>{fusion.sourceMix.sensor + fusion.sourceMix.simulated}</strong><span>sensor params</span></div>
            <div><strong>{fusion.sourceMix.lab}</strong><span>lab params selected</span></div>
            <div><strong>{fusion.sourceMix.manual}</strong><span>manual params</span></div>
          </div>
        </div>
      </div>
      {assessment.flags.length > 0 ? <div className="water-status-flags">{assessment.flags.slice(0, 4).map(flag => <div className={`water-status-flag ${flag.tone}`} key={flag.key}><strong>{flag.label}: {flag.value} {flag.unit}</strong><span>{flag.message}</span></div>)}</div> : <div className="water-status-no-flags">{assessment.measuredCount ? 'No configured trigger crossed in the parameters checked. This is not a safety clearance.' : 'Upload a laboratory report or start the sensor simulator to calculate a water-quality status.'}</div>}
      {assessment.unscoredMeasurements?.length > 0 && <div className="unscored-measurements-note"><strong>Recorded but not scored by this profile ({assessment.unscoredMeasurements.length})</strong><div>{assessment.unscoredMeasurements.map(item => `${item.label}: ${item.value}${item.unit ? ` ${item.unit}` : ''}`).join(' · ')}</div><span>These values are included in the record, but this prototype does not apply a validated limit for them under the selected profile. They still require interpretation against the correct local standard and intended use.</span></div>}
      <div className="water-status-footnote">Source selection is performed parameter by parameter using measurement dates. The status is decision support only; it is not a certified water-quality grade.</div>
    </section>
  );
}

function loadSavedCsvImports() {
  try {
    const saved = localStorage.getItem('jalrakshak.csvImports.v1');
    const parsed = saved ? JSON.parse(saved) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function loadSavedManualReadings() {
  try {
    const saved = localStorage.getItem('jalrakshak.manualReadings.v1');
    const parsed = saved ? JSON.parse(saved) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export default function App() {
  const [selectedId, setSelectedId] = useState('river');
  const [activeLayer, setActiveLayer] = useState('All layers');
  const [search, setSearch] = useState('');
  const [metricOverrides, setMetricOverrides] = useState({});
  const [csvImports, setCsvImports] = useState(loadSavedCsvImports);
  const [manualReadingsBySite, setManualReadingsBySite] = useState(loadSavedManualReadings);
  const [locationResult, setLocationResult] = useState(null);
  const [selectedMapWaterId, setSelectedMapWaterId] = useState(null);
  const [selectedMapObjectId, setSelectedMapObjectId] = useState(null);
  const [selectedMapObjectDetails, setSelectedMapObjectDetails] = useState(null);
  const [sensorReadingsBySite, setSensorReadingsBySite] = useState({});
  const [assessmentProfile, setAssessmentProfile] = useState('surface');
  const sceneCardRef = useRef(null);
  const localDataMigrationStarted = useRef(false);
  useEffect(() => {
    if (localDataMigrationStarted.current) return;
    localDataMigrationStarted.current = true;
    try {
      if (localStorage.getItem('jalrakshak.localData.migrated.v2')) return;
      const requests = [];
      for (const [siteId, record] of Object.entries(loadSavedCsvImports())) {
        if (record?.values && Object.keys(record.values).length) requests.push(fetch('/api/observations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site_id: siteId, source_type: 'laboratory-upload', timestamp: record.timestamp || record.sampledAt, values: record.values, metadata: { file_name: record.fileName, lab_name: record.labName, sample_id: record.sampleId, migrated_from_browser_storage: true } }) }));
      }
      for (const [siteId, record] of Object.entries(loadSavedManualReadings())) {
        if (record?.values && Object.keys(record.values).length) requests.push(fetch('/api/observations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site_id: siteId, source_type: 'manual-input', timestamp: record.timestamp || record.enteredAt, values: record.values, metadata: { migrated_from_browser_storage: true } }) }));
      }
      Promise.all(requests).then(responses => {
        if (responses.every(response => response.ok)) localStorage.setItem('jalrakshak.localData.migrated.v2', 'true');
      }).catch(() => { /* Keep the migration marker unset so saved browser records remain available for a later retry. */ });
      if (!requests.length) localStorage.setItem('jalrakshak.localData.migrated.v2', 'true');
    } catch { /* Browser storage may be disabled; the local server database still works for new records. */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem('jalrakshak.csvImports.v1', JSON.stringify(csvImports)); }
    catch { /* The app remains usable if browser storage is unavailable or full. */ }
  }, [csvImports]);
  useEffect(() => {
    try { localStorage.setItem('jalrakshak.manualReadings.v1', JSON.stringify(manualReadingsBySite)); }
    catch { /* Keep analysis available if browser storage is full or disabled. */ }
  }, [manualReadingsBySite]);
  const activeMappedWaterBody = locationResult?.waterBodies?.find(item => item.id === selectedMapWaterId) || locationResult?.waterBodies?.[0] || null;
  // Feed the selected OpenFreeMap rendered features and imported offline features
  // into the same local Three.js scene. Provider-native Google / Apple places are
  // not enabled in this standalone build.
  const sceneWaterBodies = locationResult ? (locationResult.waterBodies || []) : [];
  const sceneContextFeatures = locationResult ? (locationResult.contextFeatures || []) : [];
  const sceneMappedWaterBody = sceneWaterBodies.find(item => item.id === selectedMapWaterId) || sceneWaterBodies[0] || null;
  const sceneSelectedObjectId = [sceneMappedWaterBody, ...sceneContextFeatures].some(item => item?.id === selectedMapObjectId)
    ? selectedMapObjectId
    : sceneMappedWaterBody?.id;
  const environmentalMapContext = locationResult ? {
    ...locationResult,
    waterBodies: sceneWaterBodies,
    contextFeatures: sceneContextFeatures,
  } : null;
  const environmentalWaterBody = ['google', 'apple'].includes(locationResult?.provider) ? null : activeMappedWaterBody;
  const isLiveProviderSite = ['google', 'apple'].includes(locationResult?.provider);
  const assessmentKey = activeMappedWaterBody?.id || selectedId;
  const baseSelected = siteData[selectedId] || siteData.river;
  // Do not persist provider-supplied place names in the local sensor / action-plan database.
  // Use baseSelected here: the fully assessed `selected` object is created below.
  const platformSiteName = isLiveProviderSite ? 'Selected mapped site' : (activeMappedWaterBody?.name || baseSelected.name);
  const labImport = csvImports[assessmentKey] || null;
  const siteSensors = sensorReadingsBySite[assessmentKey] || [];
  const manualReadings = manualReadingsBySite[assessmentKey] || null;
  const baseMetrics = activeMappedWaterBody ? [] : (metricOverrides[selectedId] || baseSelected.metrics);
  const fusedData = useMemo(() => fuseWaterData({ baseMetrics, sensorReadings: siteSensors, labImport, manualReadings }), [assessmentKey, baseMetrics, siteSensors, labImport, manualReadings]);
  const currentMetrics = fusedData.metrics;
  const assessmentInput = activeMappedWaterBody ? {
    id: assessmentKey,
    name: activeMappedWaterBody.name || activeMappedWaterBody.kind || 'Mapped waterbody',
    type: activeMappedWaterBody.kind || 'Mapped waterbody',
    location: `${Number(activeMappedWaterBody.lat).toFixed(5)}, ${Number(activeMappedWaterBody.lon).toFixed(5)}`,
    coordinates: `${Number(activeMappedWaterBody.lat).toFixed(5)}, ${Number(activeMappedWaterBody.lon).toFixed(5)}`,
    description: 'Assessment is based only on the sensor measurements and uploaded laboratory data linked to this mapped waterbody.',
    conservation: 'Protect the waterbody from new pollution inputs, preserve potentially unaffected supplies separately, and verify any reuse or treatment decision with appropriate testing.',
    metrics: currentMetrics,
    causes: [], remedies: [],
  } : { ...baseSelected, metrics: currentMetrics };
  const assessment = useMemo(() => analyseWaterQuality(assessmentInput, { profile: assessmentProfile }), [assessmentKey, currentMetrics, assessmentProfile]);
  const displayStatus = assessment.measuredCount === 0
    ? { status: 'Insufficient data', statusTone: 'warning' }
    : assessment.flags.length > 0
      ? { status: assessment.priorityTone === 'danger' ? 'High screening priority' : 'Review needed', statusTone: assessment.priorityTone }
      : { status: 'No configured trigger · not cleared', statusTone: 'info' };
  const selected = { ...assessmentInput, ...displayStatus };
  const filteredItems = useMemo(() => navItems.filter(item => `${item.label} ${item.kind}`.toLowerCase().includes(search.toLowerCase())), [search]);
  const mappedSidebarItems = useMemo(() => {
    if (!locationResult) return [];
    const waterItems = (locationResult.waterBodies || []).map(feature => ({
      id: `water:${feature.id}`, objectId: feature.id, category: 'waterbody', label: mappedFeatureName(feature, true),
      kind: `${feature.kind} · ${Math.round(feature.distanceM)} m from searched point`, feature, isWater: true,
    }));
    const contextItems = (locationResult.contextFeatures || []).map(feature => ({
      id: `context:${feature.id}`, objectId: feature.id, category: feature.context?.category || 'other',
      label: mappedFeatureName(feature), kind: `${feature.context?.label || 'Mapped feature'} · ${Math.round(feature.distanceM)} m from searched point`, feature, isWater: false,
    }));
    return [...waterItems, ...contextItems].filter(item => `${item.label} ${item.kind} ${JSON.stringify(item.feature.tags || {})}`.toLowerCase().includes(search.toLowerCase()));
  }, [locationResult, search]);
  const mappedContextCounts = useMemo(() => {
    if (!locationResult) return [];
    const counts = new Map();
    for (const feature of locationResult.contextFeatures || []) {
      const label = feature.context?.label || 'Other mapped feature';
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [locationResult]);

  const selectedMappedFeature = useMemo(() => {
    if (!locationResult || !selectedMapObjectId) return null;
    const water = (locationResult.waterBodies || []).find(item => item.id === selectedMapObjectId);
    if (water) return { feature: water, isWater: true };
    const context = (locationResult.contextFeatures || []).find(item => item.id === selectedMapObjectId);
    return context ? { feature: context, isWater: false } : null;
  }, [locationResult, selectedMapObjectId]);
  const selectedDescriptionObject = useMemo(() => {
    if (selectedMapObjectDetails && selectedMapObjectDetails.id === selectedMapObjectId) {
      return {
        title: selectedMapObjectDetails.title,
        category: selectedMapObjectDetails.category,
        description: selectedMapObjectDetails.explanation,
        relevance: selectedMapObjectDetails.relevance,
        coordinates: `${Number(selectedMapObjectDetails.lat).toFixed(5)}, ${Number(selectedMapObjectDetails.lon).toFixed(5)}`,
        distanceLabel: Number.isFinite(selectedMapObjectDetails.distanceFromOrigin) ? `${Math.round(selectedMapObjectDetails.distanceFromOrigin)} m from searched point` : '',
        tagItems: selectedMapObjectDetails.tagItems || [],
        sourceLabel: 'MAP-DERIVED',
      };
    }
    if (selectedMappedFeature) {
      const feature = selectedMappedFeature.feature;
      const isWater = selectedMappedFeature.isWater;
      const tags = feature.tags || {};
      const category = isWater ? 'Water body' : (feature.context?.label || feature.context?.category || 'Mapped infrastructure');
      const description = tags.description || (isWater
        ? `${feature.providerLabel || tags.source_provider || 'The selected map provider'} returned this as ${tags.provider_type || feature.kind || 'a water feature'}. This is a map-search candidate only; its exact boundaries, current water quality, source, flow and safety are not established by map data.`
        : (feature.context?.explanation || 'This infrastructure feature is present in the map data. Its actual condition and role should be confirmed in the field.'));
      const relevance = isWater
        ? 'This is the selected water source. Use current sensor readings and suitable laboratory results to assess its condition.'
        : feature.context?.category === 'drainage'
          ? 'Investigate its direction and outfall. Map proximity does not prove it discharges into the selected water body.'
          : ['industrial', 'facility'].includes(feature.context?.category)
            ? 'A mapped facility is an investigation lead, not proof of pollution. Verify activity, permits, discharge records and physical connections.'
            : feature.context?.category === 'agriculture'
              ? 'Agricultural land can guide runoff investigation. Check rainfall, slope, field practices and connected drains.'
              : 'This feature provides catchment context. Its physical connection to, or impact on, the waterbody has not been established.';
      return {
        title: feature.name && !/^Unnamed mapped feature$/i.test(feature.name) ? feature.name : (isWater ? feature.kind : feature.context?.label) || 'Mapped feature',
        category,
        description,
        relevance,
        coordinates: `${Number(feature.lat).toFixed(5)}, ${Number(feature.lon).toFixed(5)}`,
        distanceLabel: Number.isFinite(feature.distanceM) ? `${Math.round(feature.distanceM)} m from searched point` : '',
        tagItems: Object.entries(tags).slice(0, 12).map(([key, value]) => ({ key, value: String(value) })),
        sourceLabel: 'MAP-DERIVED',
      };
    }
    return { title: selected.name, category: selected.type, description: selected.description, relevance: selected.conservation, coordinates: selected.coordinates, sourceLabel: 'CURRENT APP DATA' };
  }, [selectedMapObjectDetails, selectedMapObjectId, selectedMappedFeature, selected]);
  const environmentalContext = useMemo(() => analyseEnvironmentalContext({ assessment, locationResult: environmentalMapContext, waterBody: environmentalWaterBody }), [assessment, environmentalMapContext, environmentalWaterBody]);
  const remedyPlan = useMemo(() => buildRemedyPlan(assessment), [assessment]);
  const snapshotSignatureRef = useRef('');
  useEffect(() => {
    if (!fusedData.provenance?.length) return;
    const signature = `${assessmentKey}|${fusedData.provenance.map(item => `${item.key}:${item.value}:${item.timestamp || ''}`).join('|')}|${assessment.priorityLabel}|${assessment.flags.map(flag => flag.key).join(',')}`;
    if (snapshotSignatureRef.current === signature) return;
    snapshotSignatureRef.current = signature;
    fetch('/api/assessment-snapshots', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: assessmentKey, timestamp: new Date().toISOString(), profile: assessmentProfile, assessment: { priorityLabel: assessment.priorityLabel, summary: assessment.summary, measuredCount: assessment.measuredCount, flags: assessment.flags.map(({ key, label, value, unit, tone }) => ({ key, label, value, unit, tone })), hypotheses: assessment.hypotheses }, fusion: { parameterCount: fusedData.parameterCount, sourceMix: fusedData.sourceMix } }),
    }).catch(() => { /* Dashboard remains usable if local persistence is unavailable. */ });
  }, [assessmentKey, assessment, assessmentProfile, fusedData]);

  const selectObject = (id) => { if (siteData[id]) { setSelectedId(id); setActiveLayer('All layers'); setLocationResult(null); setSelectedMapWaterId(null); setSelectedMapObjectId(null); setSelectedMapObjectDetails(null); } };
  const resetView = () => selectObject('river');
  const handleLocationResult = (result) => {
    setLocationResult(result);
    const firstWater = result?.waterBodies?.[0] || null;
    setSelectedMapWaterId(firstWater?.id || null);
    setSelectedMapObjectId(firstWater?.id || null);
    setSelectedMapObjectDetails(null);
  };
  const handleMapWaterSelect = (id) => {
    setSelectedMapWaterId(id);
    setSelectedMapObjectId(id);
    setSelectedMapObjectDetails(null);
  };
  const handleMapContextSelect = (id) => { setSelectedMapObjectId(id); setSelectedMapObjectDetails(null); };
  const handleMapObjectSelect = (id, details) => {
    setSelectedMapObjectId(id);
    setSelectedMapObjectDetails(details || null);
  };
  const enterSceneFullscreen = () => {
    const element = sceneCardRef.current;
    if (!element || document.fullscreenElement === element) return;
    element.requestFullscreen?.().catch(() => { /* The user can use the hologram Full screen button if the browser blocks this. */ });
  };
  const exitSceneFullscreen = () => {
    if (sceneCardRef.current && document.fullscreenElement === sceneCardRef.current) {
      document.exitFullscreen?.().catch(() => {});
    }
  };
  const handleSceneSelect = (id) => { if (siteData[id]) setSelectedId(id); };
  const handleSampleApply = (id, values) => {
    const baseMetrics = metricOverrides[id] || csvImports[id]?.metrics || siteData[id].metrics;
    setMetricOverrides(current => ({ ...current, [id]: applySampleValues(baseMetrics, values) }));
  };
  const handleSampleReset = (id) => setMetricOverrides(current => {
    const next = { ...current };
    delete next[id];
    return next;
  });

  const handleManualApply = (id, values) => {
    const timestamp = new Date().toISOString();
    setManualReadingsBySite(current => ({
      ...current,
      [id]: { values: { ...(current[id]?.values || {}), ...values }, timestamp, enteredAt: timestamp },
    }));
    fetch('/api/observations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site_id: id, source_type: 'manual-input', timestamp, values, metadata: { entry_method: 'manual measurement panel' } }) }).catch(() => {});
  };
  const handleManualClear = (id) => setManualReadingsBySite(current => {
    const next = { ...current };
    delete next[id];
    return next;
  });
  const handleCsvImport = (id, imported) => {
    setMetricOverrides(current => { const next = { ...current }; delete next[id]; return next; });
    setCsvImports(current => ({ ...current, [id]: imported }));
    if (siteData[id]) setSelectedId(id);
    fetch('/api/observations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ site_id: id, source_type: 'laboratory-upload', timestamp: imported.timestamp || imported.sampledAt, values: imported.values || {}, metadata: { file_name: imported.fileName, lab_name: imported.labName, sample_id: imported.sampleId, extraction_method: imported.extractionMethod } }) }).catch(() => {});
  };
  const handleCsvClear = (id) => {
    setCsvImports(current => { const next = { ...current }; delete next[id]; return next; });
    setMetricOverrides(current => { const next = { ...current }; delete next[id]; return next; });
  };
  const handleSensorReadings = useCallback((siteId, readings) => {
    setSensorReadingsBySite(current => {
      const previous = current[siteId] || [];
      if (JSON.stringify(previous) === JSON.stringify(readings || [])) return current;
      return { ...current, [siteId]: readings || [] };
    });
  }, []);
  const selectedSource = fusedData.hasDeviceSensorData && fusedData.hasLabReport ? 'SENSOR + LAB' : fusedData.hasDeviceSensorData ? 'SENSOR NETWORK' : fusedData.hasLabReport ? 'LAB REPORT' : fusedData.hasManualData ? 'MANUAL MEASUREMENTS' : fusedData.sourceMix.simulated ? 'SIMULATED SENSOR' : metricOverrides[selectedId] ? 'MANUAL WHAT-IF' : csvImports[assessmentKey] ? 'LAB IMPORT' : 'DEMO';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><Droplets size={25} strokeWidth={2.2} /></div>
          <div>
            <div className="brand-name">JalRakshak <span>AI</span></div>
            <div className="brand-subtitle">WATER INTELLIGENCE PLATFORM</div>
          </div>
        </div>
        <div className="topbar-center"><span className="pulse-dot" /> SYSTEM ONLINE <span className="top-separator">/</span> {locationResult ? 'MAPPED LOCATION / DIGITAL TWIN' : csvImports[selectedId] ? `IMPORTED ${csvImports[selectedId].fileType || 'FILE'} DATA` : 'DEMONSTRATION MODE'}</div>
        <div className="topbar-actions">
          <div className="demo-badge"><CircleDot size={13} /> {fusedData.hasDeviceSensorData ? 'DEVICE SENSOR DATA' : fusedData.hasLabReport ? 'LAB REPORT LINKED' : fusedData.hasManualData ? 'MANUAL MEASUREMENTS' : fusedData.sourceMix.simulated ? 'SIMULATED SENSOR DATA' : locationResult ? 'MAP DATA · NOT WATER TEST' : metricOverrides[selectedId] ? 'MANUAL SAMPLE' : 'SIMULATED DATA'}</div>
          <button className="icon-button notification-button" aria-label="Notifications" title="Notifications"><Bell size={18} /><span /></button>
          <div className="user-avatar">JR</div>
        </div>
      </header>

      <main className="workspace">
        <aside className="left-sidebar">
          <div className="section-eyebrow">MONITORING</div>
          <div className="side-title">Catchment explorer</div>
          <p className="side-description">Choose any object to open its contextual 3D view.</p>
          <div className="search-box"><Search size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find an area or asset" aria-label="Find an area or asset" /></div>
          {locationResult ? <>
            <div className="mapped-sidebar-summary"><span className="section-eyebrow">MAP EXPLORER RESULTS</span><strong>{locationResult.waterBodies.length + locationResult.contextFeatures.length} mapped objects</strong><small>{locationResult.waterBodies.length} water bodies · {locationResult.contextFeatures.length} surrounding features</small></div>
            <div className="mapped-sidebar-group"><div className="mapped-sidebar-group-title">WATER BODIES <span>{locationResult.waterBodies.length}</span></div>
              <div className="nav-list">
                {mappedSidebarItems.filter(item => item.isWater).map(item => <button key={item.id} title={item.feature.tags?.description || `${item.label}. ${item.feature.kind}`} className={`nav-item mapped-nav-item ${selectedMapObjectId === item.objectId ? 'selected' : ''}`} onClick={() => handleMapWaterSelect(item.objectId)}>
                  <span className="nav-icon good">{mappedFeatureIcon(item.category)}</span><span className="nav-copy"><strong>{item.label}</strong><small>{item.kind}</small></span><ChevronRight className="nav-chevron" size={15} />
                </button>)}
                {!locationResult.waterBodies.length && <div className="no-results">No waterbody candidates were returned by the selected provider. Try a different map search term, provider, or imported local map data.</div>}
              </div>
            </div>
            <div className="mapped-sidebar-group"><div className="mapped-sidebar-group-title">INFRASTRUCTURE & SURROUNDINGS <span>{locationResult.contextFeatures.length}</span></div>
              <div className="nav-list">
                {mappedSidebarItems.filter(item => !item.isWater).map(item => <button key={item.id} title={item.feature.context?.explanation || item.label} className={`nav-item mapped-nav-item ${selectedMapObjectId === item.objectId ? 'selected' : ''}`} onClick={() => handleMapContextSelect(item.objectId)}>
                  <span className="nav-icon">{mappedFeatureIcon(item.category)}</span><span className="nav-copy"><strong>{item.label}</strong><small>{item.kind}</small></span><ChevronRight className="nav-chevron" size={15} />
                </button>)}
                {!locationResult.contextFeatures.length && <div className="no-results">No tagged buildings or infrastructure were returned. Map coverage may be incomplete.</div>}
              </div>
            </div>
          </> : <div className="nav-list">
            {filteredItems.map(item => {
              const data = siteData[item.id];
              return <button key={item.id} className={`nav-item ${selectedId === item.id ? 'selected' : ''}`} onClick={() => selectObject(item.id)}>
                <span className={`nav-icon ${data.statusTone}`}>{navIcon(item.id)}</span>
                <span className="nav-copy"><strong>{item.label}</strong><small>{item.kind}</small></span>
                <ChevronRight className="nav-chevron" size={15} />
              </button>;
            })}
            {filteredItems.length === 0 && <div className="no-results">No matching objects in this demo scene.</div>}
          </div>}
          <div className="sidebar-rule" />
          <div className="section-eyebrow">VISUALIZATION LAYERS</div>
          <div className="layer-list">
            {['All layers', 'Water quality', 'Infrastructure', 'Alert zones'].map((layer, i) => <button key={layer} className={`layer-option ${activeLayer === layer ? 'active' : ''}`} onClick={() => setActiveLayer(layer)}><span className={`layer-swatch swatch-${i}`} />{layer}{activeLayer === layer && <CheckCircle2 size={14} />}</button>)}
          </div>
          <div className="sidebar-bottom-card">
            <div className="mini-shield"><ShieldCheck size={20} /></div>
            <strong>Protect every drop.</strong>
            <span>Observe · Understand · Preserve</span>
            <div className="sidebar-version">JALRAKSHAK PLATFORM <span>v3.0.0</span></div>
          </div>
        </aside>

        <section className="main-column">
          <div className="page-heading">
            <div>
              <div className="breadcrumb">OVERVIEW <ChevronRight size={12} /> 3D DIGITAL TWIN</div>
              <h1>Water intelligence <span>at a glance.</span></h1>
              <p>Explore the selected catchment in 3D. Select any water body or mapped asset to read its description; the water-status panel combines the latest available sensor and laboratory measurements.</p>
            </div>
            <div className="heading-actions"><button className="secondary-button" onClick={resetView}><RotateCcw size={15} /> Reset view</button><button className="primary-button" onClick={() => selectObject('hotspot')}><Scan size={15} /> Inspect alert</button></div>
          </div>

          <section className="beginner-guide" aria-label="How to use JalRakshak">
            <div className="beginner-guide-icon"><Droplets size={22} /></div>
            <div className="beginner-guide-copy"><span className="section-eyebrow">QUICK START · NO TECHNICAL KNOWLEDGE NEEDED</span><h2>Start with a location. Add water test results. Get clear next steps.</h2><p><b>1.</b> Enter an Indian address or GPS coordinates in <b>Nearby water-body explorer</b>. <b>2.</b> Choose a waterbody and inspect its 3D surroundings. <b>3.</b> Add real sensor, lab or manual readings. <b>4.</b> Read the assessment and the separate remedies panel.</p></div>
            <div className="beginner-guide-note"><ShieldCheck size={15} /><span>Map context is not a water test. Predicted values are labelled.</span></div>
          </section>

          <div className="kpi-strip">
            <div className="kpi-cell"><div className="kpi-icon cyan"><Waves size={17} /></div><div><span>{locationResult ? 'MAPPED OBJECTS' : 'MONITORED OBJECTS'}</span><strong>{locationResult ? String(locationResult.waterBodies.length + locationResult.contextFeatures.length).padStart(2, '0') : '06'} <small>{locationResult ? 'mapped objects' : 'demo assets'}</small></strong></div></div>
            <div className="kpi-cell"><div className="kpi-icon red"><AlertTriangle size={17} /></div><div><span>WATER QUALITY STATUS</span><strong className={assessment.flags.length ? 'red-text' : ''}>{assessment.measuredCount ? String(assessment.flags.length).padStart(2, '0') : '—'} <small>{assessment.measuredCount ? `flag(s) · ${assessment.measuredCount} readings` : 'sensor / lab data needed'}</small></strong></div></div>
            <div className="kpi-cell"><div className="kpi-icon green"><Droplets size={17} /></div><div><span>WATER SAVING</span><strong>— <small>not yet measured</small></strong></div></div>
            <div className="kpi-cell"><div className="kpi-icon purple"><Activity size={17} /></div><div><span>DATA SOURCE</span><strong>{locationResult ? 'MAP + TEST DATA' : selectedSource} <small>{fusedData.hasDeviceSensorData ? 'device readings received' : fusedData.hasLabReport ? 'lab report linked' : 'map/demo source only'}</small></strong></div></div>
          </div>

          <WaterStatusCard assessment={assessment} fusion={fusedData} labImport={labImport} selectedName={selected.name} profile={assessmentProfile} onProfileChange={setAssessmentProfile} />
          <ManualMeasurementsPanel
            key={`manual-${assessmentKey}`}
            siteId={assessmentKey}
            siteName={selected.name}
            manualReadings={manualReadings}
            fusedData={fusedData}
            onApply={handleManualApply}
            onClear={handleManualClear}
          />

          <div className="section-header">
            <div><div className="section-eyebrow">LIVE DIGITAL TWIN</div><h2>3D holographic environment</h2></div>
            <div className="scene-badges"><span className="scene-badge"><span className="small-pulse" /> Interactive</span><span className="scene-badge"><Layers3 size={13} /> {activeLayer}</span></div>
          </div>

          <div ref={sceneCardRef} className={`scene-card ${sceneMappedWaterBody ? 'scene-card-map-mode' : ''}`}>
            {sceneMappedWaterBody ? <LocationWaterHologram
              key={sceneMappedWaterBody.id}
              waterBody={sceneMappedWaterBody}
              contextFeatures={sceneContextFeatures}
              origin={locationResult.coordinates}
              radiusM={locationResult.radiusM}
              selectedObjectId={sceneSelectedObjectId || sceneMappedWaterBody.id}
              onSelectObject={handleMapObjectSelect}
            /> : <>
              <div className="scene-top-hud"><div><span className="hud-overline">SELECTED OBJECT</span><strong>{selected.name}</strong><small><MapPin size={12} /> {selected.location}</small></div><div className="hud-live"><span className="live-line" /> DEMO FEED</div></div>
              <WaterScene selectedId={selectedId} onSelect={handleSceneSelect} activeLayer={activeLayer} />
              <div className="scene-gradient" />
              <div className="scene-corner scene-corner-tl" /><div className="scene-corner scene-corner-br" />
              <div className="scene-bottom-hud"><span><span className="axis-x">X</span> LONGITUDE AXIS</span><span><span className="axis-y">Y</span> ELEVATION</span><span><span className="axis-z">Z</span> DEPTH AXIS</span><span className="drag-hint">DRAG TO ROTATE · SCROLL TO ZOOM · R: IN · F: OUT</span></div>
              <div className="scene-float-card"><div className="float-title"><span className={`float-dot ${selected.statusTone}`} />{selected.type.toUpperCase()}</div><strong>{selected.name}</strong><p>{selected.description}</p><button onClick={() => document.getElementById('detail-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>View selected data <ArrowDownRight size={14} /></button></div>
              <div className="scene-key"><span><i className="key-blue" /> Monitored water</span><span><i className="key-green" /> Protected / normal</span><span><i className="key-red" /> Potential alert</span></div>
            </>}
          </div>

          <section className="information-workspace-heading" aria-label="Environmental information sections">
            <div>
              <span className="section-eyebrow">ENVIRONMENTAL INFORMATION CENTRE</span>
              <h2>Descriptions, explanations and recommended actions</h2>
              <p>Each information area is shown in its own clearly labelled section. These explanations are separate from the manual measurement fields above and update when the selected waterbody or mapped object changes.</p>
            </div>
            <span className="information-workspace-badge">SEPARATE INFORMATION PANELS</span>
          </section>
          <SelectedDescriptionPanel object={selectedDescriptionObject} />
          <EnvironmentalAssessmentPanels context={environmentalContext} remedyPlan={remedyPlan} assessment={assessment} />
          <PlatformWorkspace siteId={assessmentKey} siteName={platformSiteName} provenance={fusedData.provenance} assessment={assessment} environmentalContext={environmentalContext} remedyPlan={remedyPlan} />

          {locationResult ? <div className="lower-grid mapped-lower-grid">
            <section className="content-card trend-card">
              <div className="card-heading"><div><span className="section-eyebrow">MAPPED CATCHMENT INVENTORY</span><h3>Surrounding feature categories</h3></div><span className="assessment-chip">MAP DATA</span></div>
              <div className="mapped-count-grid">
                <div><strong>{locationResult.waterBodies.length}</strong><span>Mapped water bodies</span></div>
                <div><strong>{locationResult.contextFeatures.length}</strong><span>Mapped surroundings</span></div>
                <div><strong>{locationResult.featureCount || 0}</strong><span>Unique map objects</span></div>
              </div>
              <div className="mapped-category-list">
                {mappedContextCounts.slice(0, 8).map(([label, count]) => <div className="mapped-category-row" key={label}><span>{label}</span><strong>{count}</strong></div>)}
                {mappedContextCounts.length > 8 && <small>Use Catchment Explorer search to find the remaining categories and individual features.</small>}
                {!mappedContextCounts.length && <small>No classified surrounding features were returned by the map service.</small>}
              </div>
            </section>
            <section className="content-card alert-card">
              <div className="card-heading"><div><span className="section-eyebrow">WATER QUALITY STATUS</span><h3>Measurements still needed</h3></div><span className="alert-count">—</span></div>
              <div className="map-data-status"><strong>Map data is not a water test</strong><p>The location lookup describes mapped geography. It cannot measure pH, turbidity, dissolved oxygen, heavy metals, or microbes.</p><p>Import readings from a sensor or obtain suitable laboratory results before drawing conclusions about contamination or safe use.</p></div>
              <div className="alert-foot"><span><MapPin size={13} /> {locationResult.providerLabel || 'Imported map'} context</span><a href={locationResult.mapUrl} target="_blank" rel="noreferrer">Open selected map provider <ExternalLink size={12} /></a></div>
            </section>
          </div> : <div className="lower-grid">
            <section className="content-card trend-card">
              <div className="card-heading"><div><span className="section-eyebrow">WATER QUALITY</span><h3>Parameter trends</h3></div><button className="card-icon-button" title="Trend information"><BarChart3 size={17} /></button></div>
              <div className="sparkline-wrap">
                <div className="chart-labels"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>NOW</span></div>
                <svg viewBox="0 0 560 105" preserveAspectRatio="none" className="trend-svg" role="img" aria-label="Illustrative demo trends for turbidity and dissolved oxygen">
                  <defs><linearGradient id="areaCyan" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#21c9ed" stopOpacity=".2"/><stop offset="100%" stopColor="#21c9ed" stopOpacity="0"/></linearGradient></defs>
                  {[15,40,65,90].map(y => <line key={y} x1="0" y1={y} x2="560" y2={y} stroke="#244052" strokeWidth="1" strokeDasharray="3 6" />)}
                  <path d="M0,58 C30,51 45,55 65,48 S102,35 125,46 S163,55 185,39 S220,36 244,49 S277,63 302,58 S345,47 367,29 S405,34 430,43 S470,28 500,37 S537,27 560,32 L560,105 L0,105 Z" fill="url(#areaCyan)" />
                  <path d="M0,58 C30,51 45,55 65,48 S102,35 125,46 S163,55 185,39 S220,36 244,49 S277,63 302,58 S345,47 367,29 S405,34 430,43 S470,28 500,37 S537,27 560,32" fill="none" stroke="#42d9f6" strokeWidth="2.2" />
                  <path d="M0,31 C28,37 47,28 70,34 S104,42 130,39 S160,29 185,33 S218,53 244,48 S275,42 302,47 S343,56 367,60 S405,51 430,58 S470,64 500,60 S535,71 560,67" fill="none" stroke="#58d9aa" strokeWidth="2" />
                </svg>
              </div>
              <div className="chart-legend"><span><i className="line-cyan" /> Turbidity (illustrative)</span><span><i className="line-green" /> Dissolved oxygen (illustrative)</span></div>
            </section>
            <section className="content-card alert-card">
              <div className="card-heading"><div><span className="section-eyebrow">ATTENTION REQUIRED</span><h3>Alert centre</h3></div><span className="alert-count">{String(assessment.flags.length).padStart(2, '0')}</span></div>
              <button className={`alert-item ${selectedId === 'hotspot' ? 'chosen' : ''}`} onClick={() => document.getElementById('detail-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>
                <div className="alert-symbol"><AlertTriangle size={17} /></div><div className="alert-copy"><strong>{assessment.flags.length ? 'Screening flags detected' : 'No current screening flags'}</strong><span>{csvImports[selectedId] && !metricOverrides[selectedId] ? `Imported ${csvImports[selectedId].fileType || 'file'} · selected object` : metricOverrides[selectedId] ? 'Manual what-if · selected object' : 'Simulated data · selected object'}</span><small>{assessment.flags.length ? `${assessment.flags.length} illustrative trigger(s) · verify readings` : 'No safety clearance implied'}</small></div><ChevronRight size={16} />
              </button>
              <div className="alert-foot"><span><Clock3 size={13} /> {csvImports[selectedId] ? 'File import' : 'Prototype screening'}</span><button onClick={() => document.getElementById('detail-panel')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}>View details <ExternalLink size={12} /></button></div>
            </section>
          </div>}
          <footer className="footer-note"><span><ShieldCheck size={14} /> Decision support prototype</span><span>{locationResult ? 'Map context is not a water-safety certification.' : 'Demo data is not a water-safety certification.'}</span></footer>
        </section>

        <aside className="right-panel" id="detail-panel">
          <div className="detail-header"><div><span className="section-eyebrow">OBJECT INSPECTOR</span><h2>Selected data</h2></div><button className="icon-button" onClick={resetView} title="Return to river view"><ArrowLeft size={16} /></button></div>
          {activeMappedWaterBody ? <div className="selected-object-card mapped-selection-card">
            <div className="object-emblem"><Waves size={17} /></div>
            <div className="selected-object-copy"><h3>{selectedMapObjectDetails?.title || activeMappedWaterBody.name}</h3><span>{selectedMapObjectDetails?.category || activeMappedWaterBody.kind}</span></div>
            <StatusPill tone="info">MAP-DERIVED</StatusPill>
            <p>{selectedMapObjectDetails?.explanation || 'Select any individually listed building, road, bridge, drain, utility, facility, or the water body in the 3D scene to inspect its mapped description.'}</p>
            <div className="object-location"><MapPin size={13} />{selectedMapObjectDetails ? `${Number(selectedMapObjectDetails.lat).toFixed(5)}, ${Number(selectedMapObjectDetails.lon).toFixed(5)}` : `${activeMappedWaterBody.lat.toFixed(5)}, ${activeMappedWaterBody.lon.toFixed(5)}`}</div>
          </div> : <div className="selected-object-card">
            <div className="object-emblem">{navIcon(selectedId)}</div>
            <div className="selected-object-copy"><h3>{selected.name}</h3><span>{selected.type}</span></div>
            <StatusPill tone={selected.statusTone}>{selected.status}</StatusPill>
            <p>{selected.description}</p>
            <div className="object-location"><MapPin size={13} />{selected.coordinates}</div>
          </div>}
          <LocationWaterExplorer onLookupResult={handleLocationResult} selectedWaterBodyId={selectedMapWaterId} onWaterBodySelect={handleMapWaterSelect} onContextFeatureSelect={handleMapContextSelect} onStartLookup={enterSceneFullscreen} onLookupFailure={exitSceneFullscreen} />
          <SensorHub key={`sensor-${assessmentKey}`} siteId={assessmentKey} siteName={platformSiteName} lat={activeMappedWaterBody?.lat || undefined} lon={activeMappedWaterBody?.lon || undefined} onReadingsUpdate={handleSensorReadings} />
          <CsvImportPanel key={`csv-${assessmentKey}`} selected={isLiveProviderSite ? { ...selected, name: 'Selected mapped site' } : selected} importedInfo={labImport} onImport={handleCsvImport} onClear={handleCsvClear} />
          <div className="details-section">
            <div className="detail-section-heading"><h3>Water parameters</h3><span>{fusedData.hasDeviceSensorData ? 'SENSOR / LAB FUSED' : fusedData.hasLabReport ? 'LAB REPORT' : fusedData.sourceMix.simulated ? 'SIMULATED SENSOR' : metricOverrides[selectedId] ? 'MANUAL WHAT-IF' : 'DEMO'}</span></div>
            {selected.metrics.length ? <div className="metric-grid">{selected.metrics.map(metric => <MetricCard key={metric[0]} metric={metric} />)}</div> : <div className="sensor-empty"><Activity size={17} /><strong>No measured parameters yet</strong><span>Start the sensor simulator or upload a laboratory report for {selected.name}.</span></div>}
            <p className="assessment-source-explainer">{describeDataFusion(fusedData, labImport)}</p>
          </div>
          <div className="details-section ai-section">
            <div className="detail-section-heading"><h3><Sparkles size={15} /> Explainable water assessment</h3><span className="assessment-chip">{assessmentProfile === 'bis10500' ? 'BIS REFERENCE' : 'SURFACE SCREEN'}</span></div>
            <div className={`analysis-priority ${assessment.priorityTone}`}><span />{assessment.priorityLabel}</div>
            <p className="analysis-copy status-summary-copy">{assessment.summary}</p>
            {assessment.flags.length > 0 && <div className="screening-flags"><div className="cause-heading"><AlertTriangle size={14} /> Screening flags</div>{assessment.flags.map((flag) => <div className={`screening-flag ${flag.tone}`} key={flag.key}><strong>{flag.label}: {flag.value}{flag.unit ? ` ${flag.unit}` : ''}</strong><span>{flag.message}</span></div>)}</div>}
            <div className="cause-heading"><AlertTriangle size={14} /> Possible causes / observations</div>
            <div className="cause-list">{assessment.hypotheses.map((cause, index) => <div className="cause-item" key={cause}><span>{String(index + 1).padStart(2, '0')}</span>{cause}</div>)}</div>
          </div>
          <div className="details-section remedies-section">
            <div className="detail-section-heading"><h3><ShieldCheck size={15} /> Recommended next steps</h3></div>
            <ul className="remedy-list">{assessment.nextSteps.map(remedy => <li key={remedy}><CheckCircle2 size={14} />{remedy}</li>)}</ul>
          </div>
          <div className="conservation-box"><div className="conservation-title"><Droplets size={16} /> Water conservation</div><p>{selected.conservation}</p></div>
          <section className="detail-disclaimer" aria-label="Assessment limitations and safety notes"><AlertTriangle size={17} /><div><strong>Safety, evidence and assessment limitations</strong><span>Decision-support prototype only. Uploaded laboratory files are not independently authenticated, and extracted values must be checked against the original report. Sensor status depends on calibration and connection quality. This assessment cannot certify water safety; use suitable accredited laboratory testing and qualified review before health, treatment, or isolation decisions.</span></div></section>
          <button className="export-button" onClick={() => {
            const reportName = isLiveProviderSite ? 'Selected mapped site' : selected.name;
            const reportType = isLiveProviderSite ? 'Selected provider map result' : selected.type;
            const reportLocation = isLiveProviderSite ? 'Provider-derived coordinates omitted from this export' : selected.location;
            const lines = [`JalRakshak AI v3.0.0 — Unified Water Intelligence Report`, `Object: ${reportName}`, `Type: ${reportType}`, `Location: ${reportLocation}`, `Data fusion: ${describeDataFusion(fusedData, labImport)}`, `Assessment profile: ${assessmentProfile}`, ...(labImport ? [`Laboratory: ${labImport.labName || 'Not supplied'}`, `Sample ID: ${labImport.sampleId || 'Not supplied'}`, `Sample timestamp: ${labImport.timestamp || 'Not supplied'}`, `Uploaded file: ${labImport.fileName || 'Not recorded'}`, `Imported at: ${labImport.importedAt || 'Not recorded'}`] : []), '', 'PARAMETERS', ...selected.metrics.map(([l,v,u]) => `${l}: ${v}${u ? ` ${u}` : ''}`), '', 'ASSESSMENT PRIORITY', assessment.priorityLabel, assessment.summary, '', 'SCREENING FLAGS', ...(assessment.flags.length ? assessment.flags.map(f => `- ${f.label}: ${f.value}${f.unit ? ` ${f.unit}` : ''} — ${f.message}`) : ['- No configured trigger crossed; this is not a safety clearance.']), '', 'POSSIBLE CAUSES / OBSERVATIONS', ...assessment.hypotheses.map(c => `- ${c}`), '', 'RECOMMENDED NEXT STEPS', ...assessment.nextSteps.map(r => `- ${r}`), '', 'WATER CONSERVATION', selected.conservation, '', 'This report is decision support, not a water-safety certificate. Verify lab values, sensor calibration, standards, intended use, and sample traceability.'];
            const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
            const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `jalrakshak-${assessmentKey}-inspection-report.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}><BarChart3 size={15} /> Export inspection report <ArrowUpRight size={14} /></button>
        </aside>
      </main>
    </div>
  );
}
