export const SENSOR_FIELD_RULES = {
  pH: { min: 0, max: 14, unit: '' },
  turbidity_ntu: { min: 0, max: 100000, unit: 'NTU' },
  dissolved_oxygen_mg_l: { min: 0, max: 30, unit: 'mg/L' },
  tds_mg_l: { min: 0, max: 100000, unit: 'mg/L' },
  temperature_c: { min: -5, max: 70, unit: '°C' },
  water_level_m: { min: 0, max: 10000, unit: 'm' },
  conductivity_us_cm: { min: 0, max: 200000, unit: 'µS/cm' },
  flow_rate_l_s: { min: 0, max: 100000000, unit: 'L/s' },
  nitrate_mg_l: { min: 0, max: 10000, unit: 'mg/L' },
  phosphate_mg_l: { min: 0, max: 10000, unit: 'mg/L' },
  ammonia_mg_l: { min: 0, max: 10000, unit: 'mg/L' },
  salinity_ppt: { min: 0, max: 100, unit: 'ppt' },
  bod_mg_l: { min: 0, max: 100000, unit: 'mg/L' },
  cod_mg_l: { min: 0, max: 100000, unit: 'mg/L' },
  tss_mg_l: { min: 0, max: 100000, unit: 'mg/L' },
  orp_mv: { min: -2000, max: 2000, unit: 'mV' },
  chloride_mg_l: { min: 0, max: 100000, unit: 'mg/L' },
  sulfate_mg_l: { min: 0, max: 100000, unit: 'mg/L' },
  fluoride_mg_l: { min: 0, max: 100000, unit: 'mg/L' },
  iron_mg_l: { min: 0, max: 100000, unit: 'mg/L' },
  manganese_mg_l: { min: 0, max: 100000, unit: 'mg/L' },
};

const cleanText = (value, fallback, maxLength = 80) => {
  const text = String(value ?? '').trim();
  return (text || fallback).slice(0, maxLength);
};

export function normalizeSensorPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Request body must be a JSON object.');
  }
  const sensorId = cleanText(payload.sensor_id, '', 64);
  const siteId = cleanText(payload.site_id, '', 128);
  if (!sensorId || !siteId) throw new Error('Both sensor_id and site_id are required.');

  const readingsInput = payload.readings && typeof payload.readings === 'object' && !Array.isArray(payload.readings)
    ? payload.readings
    : {};
  const readings = {};
  for (const [field, rule] of Object.entries(SENSOR_FIELD_RULES)) {
    if (readingsInput[field] === undefined || readingsInput[field] === null || readingsInput[field] === '') continue;
    const value = Number(readingsInput[field]);
    if (!Number.isFinite(value)) throw new Error(`${field} must be a finite number.`);
    if (value < rule.min || value > rule.max) throw new Error(`${field} must be between ${rule.min} and ${rule.max}${rule.unit ? ` ${rule.unit}` : ''}.`);
    readings[field] = value;
  }
  if (!Object.keys(readings).length) throw new Error('At least one supported numeric reading is required.');

  const timestamp = payload.timestamp ? new Date(payload.timestamp) : new Date();
  if (Number.isNaN(timestamp.getTime())) throw new Error('timestamp must be a valid date/time.');
  const now = Date.now();
  if (timestamp.getTime() > now + 5 * 60 * 1000) throw new Error('timestamp cannot be more than five minutes in the future.');

  const normalized = {
    sensor_id: sensorId,
    site_id: siteId,
    site_name: cleanText(payload.site_name, siteId, 120),
    timestamp: timestamp.toISOString(),
    received_at: new Date().toISOString(),
    source: payload.source === 'simulated' ? 'simulated' : 'device',
    readings,
  };
  if (Number.isFinite(Number(payload.lat)) && Number.isFinite(Number(payload.lon))) {
    const lat = Number(payload.lat); const lon = Number(payload.lon);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      normalized.lat = lat; normalized.lon = lon;
    }
  }
  return normalized;
}

export function latestBySensor(readings, siteId = '') {
  const latest = new Map();
  for (const reading of readings) {
    if (siteId && reading.site_id !== siteId) continue;
    const existing = latest.get(reading.sensor_id);
    if (!existing || new Date(reading.timestamp).getTime() > new Date(existing.timestamp).getTime()) {
      latest.set(reading.sensor_id, reading);
    }
  }
  return [...latest.values()].sort((a, b) => a.sensor_id.localeCompare(b.sensor_id));
}

export function createDemoSensorPayload({ siteId, siteName, lat, lon, now = new Date(), random = Math.random }) {
  const vary = (base, spread, digits = 2) => Number((base + (random() - 0.5) * spread).toFixed(digits));
  const payload = {
    sensor_id: `JR-SIM-${String(siteId || 'SITE').replace(/[^a-z0-9]/gi, '').slice(0, 12).toUpperCase() || 'SITE'}`,
    site_id: String(siteId || 'river'),
    site_name: String(siteName || siteId || 'Selected water site'),
    timestamp: now.toISOString(),
    source: 'simulated',
    readings: {
      pH: vary(7.2, 0.3),
      turbidity_ntu: vary(3.8, 1.4),
      dissolved_oxygen_mg_l: vary(7.1, 0.8),
      tds_mg_l: vary(305, 28, 1),
      temperature_c: vary(25.5, 1.2),
      water_level_m: vary(2.4, 0.12),
      conductivity_us_cm: vary(470, 35, 1),
      flow_rate_l_s: vary(43, 5, 1),
    },
  };
  if (Number.isFinite(lat) && Number.isFinite(lon)) { payload.lat = lat; payload.lon = lon; }
  return payload;
}
