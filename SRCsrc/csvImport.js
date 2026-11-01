const PARAMETER_SPECS = [
  { key: 'waterLevel', label: 'Water level', unit: 'm', headers: ['waterlevel', 'waterlevelm', 'levelm', 'depthm', 'depth'], tone: 'normal' },
  { key: 'pH', label: 'pH', unit: '', headers: ['ph', 'phvalue', 'acidity'], tone: 'normal' },
  { key: 'turbidity', label: 'Turbidity', unit: 'NTU', headers: ['turbidity', 'turbidityntu', 'ntu'], tone: 'normal' },
  { key: 'dissolvedOxygen', label: 'Dissolved oxygen', unit: 'mg/L', headers: ['dissolvedoxygen', 'dissolvedoxygenmgl', 'do', 'domgl', 'dooxygenmgl'], tone: 'normal' },
  { key: 'tds', label: 'TDS', unit: 'mg/L', headers: ['tds', 'tdsmgl', 'totaldissolvedsolids', 'totaldissolvedsolidsmgl'], tone: 'normal' },
  { key: 'temperature', label: 'Temperature', unit: '°C', headers: ['temperature', 'temperaturec', 'tempc', 'watertemperature'], tone: 'normal' },
  { key: 'conductivity', label: 'Conductivity', unit: 'µS/cm', headers: ['conductivity', 'conductivityuscm', 'electricalconductivity', 'ecuscm'], tone: 'normal' },
  { key: 'salinity', label: 'Salinity', unit: 'ppt', headers: ['salinity', 'salinityppt'], tone: 'normal' },
  { key: 'nitrate', label: 'Nitrate', unit: 'mg/L', headers: ['nitrate', 'nitrates', 'nitratesmgl', 'nitratesn', 'nitraten'], tone: 'normal' },
  { key: 'phosphate', label: 'Phosphate', unit: 'mg/L', headers: ['phosphate', 'phosphates', 'phosphatemgl', 'phosphatesmgl'], tone: 'normal' },
  { key: 'ammonia', label: 'Ammonia', unit: 'mg/L', headers: ['ammonia', 'ammoniamgl', 'nh3', 'nh3mgl'], tone: 'normal' },
  { key: 'bod', label: 'BOD', unit: 'mg/L', headers: ['bod', 'bodmgl', 'biochemicaloxygendemand'], tone: 'normal' },
  { key: 'cod', label: 'COD', unit: 'mg/L', headers: ['cod', 'codmgl', 'chemicaloxygendemand'], tone: 'normal' },
  { key: 'hardness', label: 'Hardness', unit: 'mg/L', headers: ['hardness', 'hardnessmgl', 'totalhardness'], tone: 'normal' },
  { key: 'alkalinity', label: 'Alkalinity', unit: 'mg/L', headers: ['alkalinity', 'alkalinitymgl'], tone: 'normal' },
  { key: 'lead', label: 'Lead', unit: 'µg/L', headers: ['lead', 'leadugl', 'leadugperliter'], tone: 'normal' },
  { key: 'mercury', label: 'Mercury', unit: 'µg/L', headers: ['mercury', 'mercuryugl'], tone: 'normal' },
  { key: 'cadmium', label: 'Cadmium', unit: 'µg/L', headers: ['cadmium', 'cadmiumugl'], tone: 'normal' },
  { key: 'arsenic', label: 'Arsenic', unit: 'µg/L', headers: ['arsenic', 'arsenicugl'], tone: 'normal' },
  { key: 'ecoli', label: 'E. coli', unit: 'CFU/100 mL', headers: ['ecoli', 'ecolicfu100ml', 'ecolicfu100ml'], tone: 'normal' },
  { key: 'totalSuspendedSolids', label: 'Total suspended solids', unit: 'mg/L', headers: ['tss', 'totalsuspendedsolids', 'totalsuspendedsolidsmgl'], tone: 'normal' },
  { key: 'color', label: 'Apparent colour', unit: 'Pt-Co', headers: ['color', 'colour', 'apparentcolour', 'truecolour'], tone: 'normal' },
  { key: 'orp', label: 'ORP', unit: 'mV', headers: ['orp', 'redox', 'oxidationreductionpotential'], tone: 'normal' },
  { key: 'chloride', label: 'Chloride', unit: 'mg/L', headers: ['chloride', 'chlorides', 'chloridemgl'], tone: 'normal' },
  { key: 'sulfate', label: 'Sulphate / sulfate', unit: 'mg/L', headers: ['sulfate', 'sulphate', 'sulfatemgl', 'sulphatemgl'], tone: 'normal' },
  { key: 'fluoride', label: 'Fluoride', unit: 'mg/L', headers: ['fluoride', 'fluoridemgl'], tone: 'normal' },
  { key: 'freeChlorine', label: 'Free residual chlorine', unit: 'mg/L', headers: ['freechlorine', 'residualchlorine', 'freeresidualchlorine'], tone: 'normal' },
  { key: 'iron', label: 'Iron', unit: 'mg/L', headers: ['iron', 'fe', 'ironmgl'], tone: 'normal' },
  { key: 'manganese', label: 'Manganese', unit: 'mg/L', headers: ['manganese', 'mn', 'manganesemgl'], tone: 'normal' },
  { key: 'totalColiform', label: 'Total coliform', unit: 'CFU/100 mL', headers: ['totalcoliform', 'coliform', 'totalcoliformcfu100ml'], tone: 'normal' },
];

const SITE_HEADERS = ['siteid', 'objectid', 'site', 'object', 'location', 'asset', 'station', 'sensorid', 'area', 'waterbody', 'monitoringpoint'];
const TIME_HEADERS = ['timestamp', 'datetime', 'date', 'recordedat', 'measuredat', 'time', 'createdat'];
const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Parse RFC4180-style CSV cells, including quoted commas, escaped quotes and newlines. */
export function parseCsvRows(text) {
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === ',') {
      row.push(cell.trim()); cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell.trim()); cell = '';
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('The CSV has an unclosed quoted field. Check the file and try again.');
  row.push(cell.trim());
  if (row.some(value => value !== '')) rows.push(row);
  return rows;
}

function numberFromCell(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number(text.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function headerIndex(headers, accepted) {
  const aliases = new Set(accepted.map(normalize));
  return headers.findIndex(header => aliases.has(normalize(header)));
}

function siteAliases(selected) {
  return new Set([
    selected?.id,
    selected?.name,
    selected?.type,
    selected?.location,
    ...(selected?.id === 'river' ? ['River Reach A', 'river'] : []),
    ...(selected?.id === 'hotspot' ? ['Contamination zone', 'Possible contamination zone', 'hotspot'] : []),
    ...(selected?.id === 'sensor' ? ['Sensor Node 04', 'sensor'] : []),
    ...(selected?.id === 'reservoir' ? ['North Reservoir', 'reservoir'] : []),
    ...(selected?.id === 'source' ? ['Industrial Site B', 'source'] : []),
    ...(selected?.id === 'plant' ? ['Treatment plant', 'Water Treatment Plant', 'plant'] : []),
  ].filter(Boolean).map(normalize));
}

function validParameterValue(spec, value) {
  if (!Number.isFinite(value)) return false;
  if (spec.key === 'pH') return value >= 0 && value <= 14;
  return true;
}

/**
 * Reads common water-monitoring CSV headings and returns the newest non-empty value
 * per supported parameter. If a site column exists, it prefers rows for the selected
 * object. When the file contains just one different site, it can be applied to the
 * selected object but clearly reports that fallback.
 */
export function parseWaterReadingsCsv(text, selected) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error('The CSV needs a header row and at least one readings row.');

  const headers = rows[0];
  const parameterColumns = PARAMETER_SPECS.map(spec => ({ spec, index: headerIndex(headers, spec.headers) })).filter(item => item.index >= 0);
  if (parameterColumns.length === 0) {
    throw new Error('No supported measurement columns were found. Try the sample CSV to see accepted column names.');
  }

  const siteIndex = headerIndex(headers, SITE_HEADERS);
  const timeIndex = headerIndex(headers, TIME_HEADERS);
  let records = rows.slice(1).map((cells, index) => ({
    cells,
    index,
    site: siteIndex >= 0 ? (cells[siteIndex] || '').trim() : '',
    timestamp: timeIndex >= 0 ? (cells[timeIndex] || '').trim() : '',
    timeMs: timeIndex >= 0 ? Date.parse(cells[timeIndex] || '') : Number.NaN,
  })).filter(record => parameterColumns.some(({ spec, index }) => validParameterValue(spec, numberFromCell(record.cells[index]))));

  if (records.length === 0) throw new Error('No numeric readings were found in the supported columns. Check that measurement cells contain numbers.');

  const warnings = [];
  let chosenSite = '';
  if (siteIndex >= 0) {
    const namedSites = [...new Set(records.map(record => record.site).filter(Boolean))];
    const aliases = siteAliases(selected);
    const matching = records.filter(record => record.site && aliases.has(normalize(record.site)));
    if (matching.length) {
      records = matching;
      chosenSite = matching[matching.length - 1].site;
    } else if (namedSites.length === 1) {
      chosenSite = namedSites[0];
      warnings.push(`The file's only site is “${chosenSite}”, which did not match the selected object's name or ID. Its readings were applied to ${selected?.name || 'the selected object'} as requested.`);
    } else if (namedSites.length > 1) {
      throw new Error(`This CSV contains multiple sites (${namedSites.slice(0, 5).join(', ')}). No rows matched “${selected?.name || selected?.id}”. Select a matching object or make the site_id column match IDs such as river, hotspot, sensor, reservoir, source, or plant.`);
    }
  }

  const sortByAge = (a, b) => {
    if (Number.isFinite(a.timeMs) && Number.isFinite(b.timeMs)) return a.timeMs - b.timeMs || a.index - b.index;
    if (Number.isFinite(a.timeMs)) return 1;
    if (Number.isFinite(b.timeMs)) return -1;
    return a.index - b.index;
  };
  records.sort(sortByAge);
  const values = {};
  for (const { spec, index } of parameterColumns) {
    for (let i = records.length - 1; i >= 0; i -= 1) {
      const value = numberFromCell(records[i].cells[index]);
      if (validParameterValue(spec, value)) { values[spec.key] = value; break; }
    }
  }
  if (Object.keys(values).length === 0) throw new Error('No valid water-quality values were found in the selected rows.');

  const mostRecent = [...records].reverse().find(record => record.timestamp)?.timestamp || '';
  return {
    values,
    timestamp: mostRecent,
    rowsMatched: records.length,
    sourceSite: chosenSite,
    warnings,
  };
}

function toneFor(spec, value) {
  if (spec.key === 'pH') return value < 6.5 || value > 8.5 ? 'danger' : 'good';
  if (spec.key === 'turbidity') return value > 25 ? 'danger' : value > 5 ? 'warning' : 'good';
  if (spec.key === 'dissolvedOxygen') return value < 3 ? 'danger' : value < 5 ? 'warning' : 'good';
  if (spec.key === 'tds') return value > 500 ? 'warning' : 'good';
  return 'normal';
}

export function metricsFromCsvValues(values) {
  return PARAMETER_SPECS.filter(spec => Object.prototype.hasOwnProperty.call(values, spec.key))
    .map(spec => [spec.label, String(values[spec.key]), spec.unit, toneFor(spec, values[spec.key])]);
}

export function getSupportedCsvParameters() {
  return PARAMETER_SPECS.map(spec => ({ key: spec.key, label: spec.label, unit: spec.unit, aliases: [...spec.headers] }));
}

export const SAMPLE_WATER_CSV = `timestamp,site_id,pH,turbidity_ntu,dissolved_oxygen_mg_l,tds_mg_l,water_level_m,temperature_c,conductivity_us_cm,nitrate_mg_l,ammonia_mg_l\n2026-10-29T09:00:00+05:30,river,7.1,4.2,6.8,290,2.4,22.5,410,1.2,0.04\n2026-10-29T09:10:00+05:30,hotspot,5.2,30,2.5,760,2.1,26.8,1200,9.0,0.3\n2026-10-29T09:20:00+05:30,reservoir,7.0,2.0,7.4,275,78,21.4,390,0.5,0.01\n`;
