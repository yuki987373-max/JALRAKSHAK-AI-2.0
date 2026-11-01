const PARAMETER_MAP = [
  { key: 'pH', sensor: 'pH', lab: 'pH', label: 'pH', unit: '' },
  { key: 'turbidity', sensor: 'turbidity_ntu', lab: 'turbidity', label: 'Turbidity', unit: 'NTU' },
  { key: 'dissolvedOxygen', sensor: 'dissolved_oxygen_mg_l', lab: 'dissolvedOxygen', label: 'Dissolved oxygen', unit: 'mg/L' },
  { key: 'tds', sensor: 'tds_mg_l', lab: 'tds', label: 'TDS', unit: 'mg/L' },
  { key: 'temperature', sensor: 'temperature_c', lab: 'temperature', label: 'Temperature', unit: '°C' },
  { key: 'waterLevel', sensor: 'water_level_m', lab: 'waterLevel', label: 'Water level', unit: 'm' },
  { key: 'conductivity', sensor: 'conductivity_us_cm', lab: 'conductivity', label: 'Conductivity', unit: 'µS/cm' },
  { key: 'salinity', sensor: 'salinity_ppt', lab: 'salinity', label: 'Salinity', unit: 'ppt' },
  { key: 'flowRate', sensor: 'flow_rate_l_s', lab: 'flowRate', label: 'Flow rate', unit: 'L/s' },
  { key: 'nitrate', sensor: 'nitrate_mg_l', lab: 'nitrate', label: 'Nitrate', unit: 'mg/L' },
  { key: 'phosphate', sensor: 'phosphate_mg_l', lab: 'phosphate', label: 'Phosphate', unit: 'mg/L' },
  { key: 'ammonia', sensor: 'ammonia_mg_l', lab: 'ammonia', label: 'Ammonia', unit: 'mg/L' },
  { key: 'bod', sensor: 'bod_mg_l', lab: 'bod', label: 'BOD', unit: 'mg/L' },
  { key: 'cod', sensor: 'cod_mg_l', lab: 'cod', label: 'COD', unit: 'mg/L' },
  { key: 'hardness', sensor: null, lab: 'hardness', label: 'Hardness', unit: 'mg/L as CaCO₃' },
  { key: 'alkalinity', sensor: null, lab: 'alkalinity', label: 'Alkalinity', unit: 'mg/L as CaCO₃' },
  { key: 'lead', sensor: null, lab: 'lead', label: 'Lead', unit: 'µg/L' },
  { key: 'mercury', sensor: null, lab: 'mercury', label: 'Mercury', unit: 'µg/L' },
  { key: 'cadmium', sensor: null, lab: 'cadmium', label: 'Cadmium', unit: 'µg/L' },
  { key: 'arsenic', sensor: null, lab: 'arsenic', label: 'Arsenic', unit: 'µg/L' },
  { key: 'ecoli', sensor: null, lab: 'ecoli', label: 'E. coli', unit: 'CFU/100 mL' },
  { key: 'totalSuspendedSolids', sensor: 'tss_mg_l', lab: 'totalSuspendedSolids', label: 'Total suspended solids', unit: 'mg/L' },
  { key: 'color', sensor: null, lab: 'color', label: 'Apparent colour', unit: 'Pt-Co' },
  { key: 'orp', sensor: 'orp_mv', lab: 'orp', label: 'ORP', unit: 'mV' },
  { key: 'chloride', sensor: 'chloride_mg_l', lab: 'chloride', label: 'Chloride', unit: 'mg/L' },
  { key: 'sulfate', sensor: 'sulfate_mg_l', lab: 'sulfate', label: 'Sulphate / sulfate', unit: 'mg/L' },
  { key: 'fluoride', sensor: 'fluoride_mg_l', lab: 'fluoride', label: 'Fluoride', unit: 'mg/L' },
  { key: 'freeChlorine', sensor: null, lab: 'freeChlorine', label: 'Free residual chlorine', unit: 'mg/L' },
  { key: 'iron', sensor: 'iron_mg_l', lab: 'iron', label: 'Iron', unit: 'mg/L' },
  { key: 'manganese', sensor: 'manganese_mg_l', lab: 'manganese', label: 'Manganese', unit: 'mg/L' },
  { key: 'totalColiform', sensor: null, lab: 'totalColiform', label: 'Total coliform', unit: 'CFU/100 mL' },
];

const asFinite = value => {
  const number = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(number) ? number : null;
};
const timeValue = value => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function labValueMap(labImport) {
  const values = labImport?.values && typeof labImport.values === 'object' ? labImport.values : {};
  if (Object.keys(values).length) return values;
  const output = {};
  for (const [label, value] of (labImport?.metrics || [])) {
    const normalized = String(label).toLowerCase();
    const spec = PARAMETER_MAP.find(item => normalized.includes(item.label.toLowerCase()));
    if (spec) output[spec.lab] = value;
  }
  return output;
}

/**
 * Merge per-parameter device sensor, manual-entry, and laboratory measurements.
 * For each parameter the newest dated observation wins. Manual entries are
 * explicitly labelled as user-entered and must be checked against source records.
 * Demo metrics are shown only when no explicit measurement source is available.
 */
export function fuseWaterData({ baseMetrics = [], sensorReadings = [], labImport = null, manualReadings = null } = {}) {
  const candidates = new Map(PARAMETER_MAP.map(spec => [spec.key, []]));
  const labValues = labValueMap(labImport);

  for (const sensor of sensorReadings || []) {
    const readings = sensor?.readings || {};
    for (const spec of PARAMETER_MAP) {
      if (!spec.sensor || readings[spec.sensor] === undefined) continue;
      const value = asFinite(readings[spec.sensor]);
      if (value === null) continue;
      candidates.get(spec.key).push({
        value,
        source: sensor.source === 'simulated' ? 'SIMULATED SENSOR' : 'SENSOR NETWORK',
        sourceType: sensor.source === 'simulated' ? 'simulated-sensor' : 'sensor',
        sensorId: sensor.sensor_id || 'Unknown sensor',
        timestamp: sensor.timestamp || null,
        timestampMs: timeValue(sensor.timestamp),
        receivedAt: sensor.received_at || null,
      });
    }
  }

  const labTimestamp = labImport?.timestamp || labImport?.sampledAt || null;
  for (const spec of PARAMETER_MAP) {
    if (labValues[spec.lab] === undefined) continue;
    const value = asFinite(labValues[spec.lab]);
    if (value === null) continue;
    candidates.get(spec.key).push({
      value,
      source: 'LAB REPORT · VERIFY EXTRACTED VALUE',
      sourceType: 'laboratory-upload',
      fileName: labImport?.fileName || 'Uploaded laboratory report',
      labName: labImport?.labName || '',
      sampleId: labImport?.sampleId || '',
      timestamp: labTimestamp,
      timestampMs: timeValue(labTimestamp),
      receivedAt: labImport?.importedAt || null,
    });
  }

  const manualValues = manualReadings?.values && typeof manualReadings.values === 'object' ? manualReadings.values : {};
  const manualTimestamp = manualReadings?.timestamp || manualReadings?.enteredAt || null;
  for (const spec of PARAMETER_MAP) {
    if (manualValues[spec.key] === undefined) continue;
    const value = asFinite(manualValues[spec.key]);
    if (value === null) continue;
    candidates.get(spec.key).push({
      value,
      source: 'MANUAL USER ENTRY · VERIFY SOURCE',
      sourceType: 'manual-input',
      timestamp: manualTimestamp,
      timestampMs: timeValue(manualTimestamp),
      receivedAt: manualReadings?.enteredAt || manualTimestamp,
    });
  }

  const fusedMetrics = [];
  const provenance = [];
  for (const spec of PARAMETER_MAP) {
    const options = candidates.get(spec.key) || [];
    if (!options.length) continue;
    options.sort((a, b) => {
      if (a.timestampMs !== null && b.timestampMs !== null) return b.timestampMs - a.timestampMs;
      if (a.timestampMs !== null) return -1;
      if (b.timestampMs !== null) return 1;
      const rank = { 'manual-input': 0, 'laboratory-upload': 1, sensor: 2, 'simulated-sensor': 3 };
      return (rank[a.sourceType] ?? 9) - (rank[b.sourceType] ?? 9);
    });
    const selected = options[0];
    const sourceLabel = selected.sourceType === 'laboratory-upload' ? 'LAB' : selected.sourceType === 'simulated-sensor' ? 'SIMULATED SENSOR' : selected.sourceType === 'manual-input' ? 'MANUAL' : 'SENSOR';
    fusedMetrics.push([`${spec.label} · ${sourceLabel}`, String(selected.value), spec.unit, 'normal']);
    provenance.push({ key: spec.key, label: spec.label, value: selected.value, unit: spec.unit, ...selected, competingSources: options.length });
  }

  const hasActualData = fusedMetrics.length > 0;
  const sourceMix = {
    sensor: provenance.filter(item => item.sourceType === 'sensor').length,
    simulated: provenance.filter(item => item.sourceType === 'simulated-sensor').length,
    lab: provenance.filter(item => item.sourceType === 'laboratory-upload').length,
    manual: provenance.filter(item => item.sourceType === 'manual-input').length,
  };
  return {
    metrics: hasActualData ? fusedMetrics : [...(baseMetrics || [])],
    provenance,
    hasSensorData: sourceMix.sensor > 0 || sourceMix.simulated > 0,
    hasDeviceSensorData: sourceMix.sensor > 0,
    hasLabData: sourceMix.lab > 0,
    hasManualData: sourceMix.manual > 0,
    hasLabReport: Boolean(labImport),
    labCandidateCount: PARAMETER_MAP.filter(spec => labValues[spec.lab] !== undefined && asFinite(labValues[spec.lab]) !== null).length,
    manualCandidateCount: Object.keys(manualValues).filter(key => asFinite(manualValues[key]) !== null).length,
    parameterCount: fusedMetrics.length,
    sensorCount: new Set(provenance.filter(item => item.sensorId).map(item => item.sensorId)).size,
    latestTimestamp: provenance.map(item => item.timestampMs).filter(value => value !== null).sort((a, b) => b - a)[0] || null,
    sourceMix,
    usedFallbackMetrics: !hasActualData && (baseMetrics || []).length > 0,
  };
}

export function describeDataFusion(fusion, labImport = null) {
  const parts = [];
  if (fusion.sourceMix.sensor) parts.push(`${fusion.sourceMix.sensor} parameter(s) from device sensors`);
  if (fusion.sourceMix.simulated) parts.push(`${fusion.sourceMix.simulated} parameter(s) from simulated sensors`);
  if (fusion.sourceMix.manual) parts.push(`${fusion.sourceMix.manual} parameter(s) from manual user entry`);
  if (fusion.hasLabReport) parts.push(`${fusion.labCandidateCount} parameter(s) in uploaded lab report${labImport?.fileName ? ` (${labImport.fileName})` : ''}${fusion.sourceMix.lab ? `; ${fusion.sourceMix.lab} selected for the combined status` : '; newer sensor or manual measurements were used where they overlapped'}`);
  if (!parts.length && fusion.usedFallbackMetrics) return 'Demonstration values only. Enter measurements, connect a sensor, or upload a laboratory report to assess this site.';
  if (!parts.length) return 'No sensor, manual, or laboratory measurements are available for this waterbody yet.';
  const labDate = labImport?.timestamp || labImport?.sampledAt;
  const dateNote = labImport && !labDate ? ' Laboratory sample date was not supplied; the uploaded values are marked for manual verification.' : '';
  return `${parts.join(' + ')} were combined parameter by parameter. Where dated results overlap, the newest measurement was selected. ${fusion.parameterCount} distinct parameter(s) are included.${dateNote}`;
}

export const WATER_PARAMETER_SPECS = PARAMETER_MAP.map(({ key, label, unit }) => ({ key, label, unit }));
