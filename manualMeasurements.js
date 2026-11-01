export const MANUAL_PARAMETER_GROUPS = [
  {
    title: 'Physical measurements',
    description: 'Basic physical condition and water movement.',
    fields: [
      { key: 'waterLevel', label: 'Water level / depth', unit: 'm', min: 0, max: 10000, step: 'any', aliases: ['water level', 'depth'] },
      { key: 'temperature', label: 'Temperature', unit: '°C', min: -5, max: 70, step: 'any', aliases: ['temperature', 'water temperature'] },
      { key: 'turbidity', label: 'Turbidity', unit: 'NTU', min: 0, max: 100000, step: 'any', aliases: ['turbidity', 'turgidity', 'ntu'] },
      { key: 'totalSuspendedSolids', label: 'Total suspended solids (TSS)', unit: 'mg/L', min: 0, max: 100000, step: 'any', aliases: ['tss', 'total suspended solids'] },
      { key: 'color', label: 'Apparent colour', unit: 'Pt-Co', min: 0, max: 100000, step: 'any', aliases: ['color', 'colour'] },
      { key: 'flowRate', label: 'Flow rate', unit: 'L/s', min: 0, max: 100000000, step: 'any', aliases: ['flow rate', 'flow'] },
    ],
  },
  {
    title: 'General chemistry',
    description: 'Acidity, dissolved material, salts and oxygen conditions.',
    fields: [
      { key: 'pH', label: 'pH', unit: '', min: 0, max: 14, step: '0.01', aliases: ['ph', 'acidity'] },
      { key: 'conductivity', label: 'Electrical conductivity', unit: 'µS/cm', min: 0, max: 200000, step: 'any', aliases: ['conductivity', 'electrical conductivity', 'ec'] },
      { key: 'tds', label: 'Total dissolved solids (TDS)', unit: 'mg/L', min: 0, max: 100000, step: 'any', aliases: ['tds', 'total dissolved solids'] },
      { key: 'salinity', label: 'Salinity', unit: 'ppt', min: 0, max: 100, step: 'any', aliases: ['salinity'] },
      { key: 'dissolvedOxygen', label: 'Dissolved oxygen (DO)', unit: 'mg/L', min: 0, max: 30, step: 'any', aliases: ['dissolved oxygen', 'do'] },
      { key: 'orp', label: 'Oxidation-reduction potential (ORP)', unit: 'mV', min: -2000, max: 2000, step: 'any', aliases: ['orp', 'redox'] },
      { key: 'hardness', label: 'Total hardness', unit: 'mg/L as CaCO₃', min: 0, max: 100000, step: 'any', aliases: ['hardness', 'total hardness'] },
      { key: 'alkalinity', label: 'Alkalinity', unit: 'mg/L as CaCO₃', min: 0, max: 100000, step: 'any', aliases: ['alkalinity'] },
      { key: 'chloride', label: 'Chloride', unit: 'mg/L', min: 0, max: 100000, step: 'any', aliases: ['chloride', 'chlorides'] },
      { key: 'sulfate', label: 'Sulphate / sulfate', unit: 'mg/L', min: 0, max: 100000, step: 'any', aliases: ['sulfate', 'sulphate'] },
      { key: 'fluoride', label: 'Fluoride', unit: 'mg/L', min: 0, max: 100000, step: 'any', aliases: ['fluoride'] },
      { key: 'freeChlorine', label: 'Free residual chlorine', unit: 'mg/L', min: 0, max: 1000, step: 'any', aliases: ['free chlorine', 'residual chlorine'] },
    ],
  },
  {
    title: 'Nutrients and organic pollution indicators',
    description: 'Indicators that may help investigate runoff and organic loading.',
    fields: [
      { key: 'nitrate', label: 'Nitrate', unit: 'mg/L', min: 0, max: 10000, step: 'any', aliases: ['nitrate', 'nitrates'] },
      { key: 'phosphate', label: 'Phosphate', unit: 'mg/L', min: 0, max: 10000, step: 'any', aliases: ['phosphate', 'phosphates'] },
      { key: 'ammonia', label: 'Ammonia', unit: 'mg/L', min: 0, max: 10000, step: 'any', aliases: ['ammonia', 'nh3'] },
      { key: 'bod', label: 'Biochemical oxygen demand (BOD)', unit: 'mg/L', min: 0, max: 100000, step: 'any', aliases: ['bod', 'biochemical oxygen demand'] },
      { key: 'cod', label: 'Chemical oxygen demand (COD)', unit: 'mg/L', min: 0, max: 100000, step: 'any', aliases: ['cod', 'chemical oxygen demand'] },
    ],
  },
  {
    title: 'Metals and microbiology',
    description: 'Usually requires a suitable laboratory method; verify units and reporting limits.',
    fields: [
      { key: 'lead', label: 'Lead', unit: 'µg/L', min: 0, max: 100000000, step: 'any', aliases: ['lead', 'pb'] },
      { key: 'mercury', label: 'Mercury', unit: 'µg/L', min: 0, max: 100000000, step: 'any', aliases: ['mercury', 'hg'] },
      { key: 'cadmium', label: 'Cadmium', unit: 'µg/L', min: 0, max: 100000000, step: 'any', aliases: ['cadmium', 'cd'] },
      { key: 'arsenic', label: 'Arsenic', unit: 'µg/L', min: 0, max: 100000000, step: 'any', aliases: ['arsenic', 'as'] },
      { key: 'iron', label: 'Iron', unit: 'mg/L', min: 0, max: 100000, step: 'any', aliases: ['iron', 'fe'] },
      { key: 'manganese', label: 'Manganese', unit: 'mg/L', min: 0, max: 100000, step: 'any', aliases: ['manganese', 'mn'] },
      { key: 'ecoli', label: 'E. coli', unit: 'CFU/100 mL', min: 0, max: 1e12, step: '1', aliases: ['e coli', 'ecoli', 'escherichia coli'] },
      { key: 'totalColiform', label: 'Total coliform', unit: 'CFU/100 mL', min: 0, max: 1e12, step: '1', aliases: ['total coliform', 'coliform'] },
    ],
  },
];

export const MANUAL_PARAMETER_FIELDS = MANUAL_PARAMETER_GROUPS.flatMap(group => group.fields);
export const MANUAL_PARAMETER_BY_KEY = new Map(MANUAL_PARAMETER_FIELDS.map(field => [field.key, field]));

export function parseManualMeasurementText(text) {
  const source = String(text ?? '').trim();
  if (!source) return { values: {}, unknown: [] };
  const aliases = new Map();
  for (const field of MANUAL_PARAMETER_FIELDS) {
    for (const alias of [field.key, field.label, ...(field.aliases || [])]) {
      aliases.set(String(alias).toLowerCase().replace(/[^a-z0-9]/g, ''), field);
    }
  }
  const values = {};
  const unknown = [];
  const pairs = source.split(/[\n;,]+/).map(part => part.trim()).filter(Boolean);
  for (const pair of pairs) {
    const match = pair.match(/^(.+?)\s*(?:=|:)\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*([^=:]*)$/i);
    if (!match) { unknown.push(pair); continue; }
    const normalized = match[1].trim().toLowerCase().replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, '').replace(/[^a-z0-9]/g, '');
    const field = aliases.get(normalized);
    if (!field) { unknown.push(match[1].trim()); continue; }
    const value = Number(match[2]);
    if (!Number.isFinite(value) || value < field.min || value > field.max) { unknown.push(`${field.label}: out of range`); continue; }
    values[field.key] = value;
  }
  return { values, unknown };
}

export function validateManualMeasurements(input) {
  const values = {};
  const errors = [];
  for (const [key, raw] of Object.entries(input || {})) {
    if (raw === '' || raw === null || raw === undefined) continue;
    const field = MANUAL_PARAMETER_BY_KEY.get(key);
    if (!field) continue;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < field.min || value > field.max) {
      errors.push(`${field.label} must be between ${field.min} and ${field.max}${field.unit ? ` ${field.unit}` : ''}.`);
      continue;
    }
    values[key] = value;
  }
  return { values, errors };
}
