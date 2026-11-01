import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, CircleDot, Cpu, Pause, Play, RadioTower, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { createDemoSensorPayload, SENSOR_FIELD_RULES } from '../sensorGateway.js';

const DISPLAY_FIELDS = [
  ['pH', 'pH', ''],
  ['turbidity_ntu', 'Turbidity', 'NTU'],
  ['dissolved_oxygen_mg_l', 'Dissolved oxygen', 'mg/L'],
  ['tds_mg_l', 'TDS', 'mg/L'],
  ['temperature_c', 'Temperature', '°C'],
  ['water_level_m', 'Water level', 'm'],
  ['conductivity_us_cm', 'Conductivity', 'µS/cm'],
  ['flow_rate_l_s', 'Flow rate', 'L/s'],
  ['nitrate_mg_l', 'Nitrate', 'mg/L'],
  ['phosphate_mg_l', 'Phosphate', 'mg/L'],
];

function formatTime(value) {
  if (!value) return 'No reading received';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown time' : date.toLocaleString();
}

export default function SensorHub({ siteId, siteName, lat, lon, onReadingsUpdate }) {
  const [sensors, setSensors] = useState([]);
  const [feedRunning, setFeedRunning] = useState(false);
  const [gateway, setGateway] = useState('checking');
  const [message, setMessage] = useState('Connecting to the local sensor gateway…');
  const [busy, setBusy] = useState(false);
  const [showPayload, setShowPayload] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/sensors/latest?site_id=${encodeURIComponent(siteId)}`);
      if (!response.ok) throw new Error(`Gateway returned HTTP ${response.status}`);
      const data = await response.json();
      const nextSensors = Array.isArray(data.sensors) ? data.sensors : [];
      setSensors(nextSensors);
      onReadingsUpdate?.(siteId, nextSensors);
      setGateway('online');
      setMessage(`${data.total_readings || 0} reading(s) saved in the local project database`);
    } catch {
      setGateway('offline');
      setMessage('Sensor gateway is unavailable. Restart JalRakshak with npm run dev.');
    }
  }, [siteId, onReadingsUpdate]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const sendReading = useCallback(async (source = 'simulated') => {
    const payload = createDemoSensorPayload({ siteId, siteName, lat, lon });
    payload.source = source;
    setBusy(true);
    try {
      const response = await fetch('/api/sensor-readings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Gateway returned HTTP ${response.status}`);
      setGateway('online');
      setMessage(`Received a ${source} reading from ${payload.sensor_id}.`);
      await refresh();
    } catch (error) {
      setGateway('offline');
      setMessage(error instanceof Error ? error.message : 'Could not send reading to gateway.');
      setFeedRunning(false);
    } finally {
      setBusy(false);
    }
  }, [siteId, siteName, lat, lon, refresh]);

  useEffect(() => {
    if (!feedRunning) return undefined;
    sendReading('simulated');
    const timer = window.setInterval(() => sendReading('simulated'), 4000);
    return () => window.clearInterval(timer);
  }, [feedRunning, sendReading]);

  const orderedSensors = useMemo(() => [...sensors].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()), [sensors]);

  return (
    <section className="sensor-hub">
      <div className="sensor-hub-head">
        <div>
          <span className="section-eyebrow">LIVE DATA GATEWAY · v3.0.0</span>
          <h3><RadioTower size={15} /> Sensor network</h3>
        </div>
        <span className={`sensor-gateway-status ${gateway}`}><span />{gateway === 'online' ? 'GATEWAY ONLINE' : gateway === 'offline' ? 'OFFLINE' : 'CHECKING'}</span>
      </div>
      <p className="sensor-hub-copy">Receive water-quality readings from a compatible physical device or use clearly labelled synthetic demo readings. The gateway does not train the AI model by itself; model training uses documented, labelled datasets in the separate AI training workspace. Current site: <strong>{siteName}</strong>.</p>
      <div className="sensor-hub-controls">
        <button className={feedRunning ? 'secondary-button' : 'primary-button'} onClick={() => setFeedRunning(value => !value)} disabled={gateway === 'offline' || busy}>
          {feedRunning ? <><Pause size={13} /> Stop simulator</> : <><Play size={13} /> Start live simulator</>}
        </button>
        <button className="secondary-button" onClick={() => sendReading('simulated')} disabled={gateway === 'offline' || busy}><RefreshCw size={13} /> Send one reading</button>
      </div>
      <div className="sensor-hub-message"><span className={gateway === 'online' ? 'sensor-message-dot good' : 'sensor-message-dot'} />{busy ? 'Sending reading…' : message}</div>

      {orderedSensors.length ? <div className="sensor-device-list">
        {orderedSensors.map(sensor => <div className="sensor-device-card" key={sensor.sensor_id}>
          <div className="sensor-device-top"><div><Cpu size={14} /><strong>{sensor.sensor_id}</strong></div><span className={`sensor-source ${sensor.source}`}>{sensor.source === 'simulated' ? 'SIMULATED' : 'DEVICE READING'}</span></div>
          <div className="sensor-device-meta"><span><CircleDot size={11} /> {sensor.site_id}</span><span><Activity size={11} /> {formatTime(sensor.timestamp)}</span></div>
          <div className="sensor-reading-grid">
            {DISPLAY_FIELDS.filter(([key]) => sensor.readings?.[key] !== undefined).map(([key, label, unit]) => <div className="sensor-reading-cell" key={key}><span>{label}</span><strong>{sensor.readings[key]} <small>{unit}</small></strong></div>)}
          </div>
          <div className="sensor-device-foot"><CheckCircle2 size={12} /> Latest validated payload · received {formatTime(sensor.received_at)}</div>
        </div>)}
      </div> : <div className="sensor-empty"><WifiOff size={17} /><strong>No sensor readings yet</strong><span>Start the simulator or send a reading from a device.</span></div>}

      <button className="sensor-payload-toggle" onClick={() => setShowPayload(value => !value)}>{showPayload ? 'Hide' : 'Show'} device connection details <span>{showPayload ? '−' : '+'}</span></button>
      {showPayload && <div className="sensor-api-help">
        <div><strong>HTTP endpoint</strong><code>POST /api/sensor-readings</code></div>
        <div><strong>Example JSON payload</strong><pre>{JSON.stringify({ sensor_id: 'ESP32-WATER-01', site_id: siteId, site_name: siteName, source: 'device', readings: { pH: 7.2, turbidity_ntu: 3.8, dissolved_oxygen_mg_l: 7.1, tds_mg_l: 305, temperature_c: 25.5, water_level_m: 2.4 } }, null, 2)}</pre></div>
        <small>Accepted fields: {Object.entries(SENSOR_FIELD_RULES).map(([key, rule]) => `${key}${rule.unit ? ` (${rule.unit})` : ''}`).join(' · ')}. The endpoint is a local development gateway without authentication; use it only on a trusted private network and never expose it directly to the public internet.</small>
      </div>}
      <div className="sensor-prediction-warning" role="note"><strong>This is predicted output, please check with real data or else put the manual values.</strong><span>Simulated values are for interface testing only. They are not sensor observations and must never be used to decide whether water is safe.</span></div>
      <div className="sensor-hub-note"><Wifi size={12} /> The simulator produces synthetic readings. Physical probes, calibration, Wi-Fi configuration and device firmware are still required for real measurements.</div>
    </section>
  );
}
