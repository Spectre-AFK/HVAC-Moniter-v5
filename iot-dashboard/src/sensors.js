export const sensorKey = (deviceId, sensorIndex) => `${deviceId}_${sensorIndex}`;
export const SENSOR_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#a855f7', '#ef4444'];
export const sensorColor = (index) => SENSOR_COLORS[index % SENSOR_COLORS.length];
export const shortDeviceId = (deviceId) => deviceId ? deviceId.slice(-4).toUpperCase() : '????';
export const sensorNameLabel = (names, key, index) => names[key]?.trim() || `Sensor ${index}`;
export const sensorLabel = (names, deviceId, index) =>
  `${sensorNameLabel(names, sensorKey(deviceId, index), index)} · Device ${shortDeviceId(deviceId)}`;
// Every sensor the signed-in user can see, regardless of the dashboard's selected date range.
// `sources` are rows shaped like { device_id, sensor_index } from any table (readings, grants,
// names, events, alert rules); duplicates and malformed rows are dropped.
export function buildSensorCatalog(sources, names = {}) {
  const byKey = new Map();
  for (const row of sources) {
    if (typeof row?.device_id !== 'string' || !Number.isInteger(row.sensor_index) || row.sensor_index < 0) continue;
    const key = sensorKey(row.device_id, row.sensor_index);
    if (!byKey.has(key)) {
      byKey.set(key, { key, deviceId: row.device_id, sensorIndex: row.sensor_index,
        label: sensorLabel(names, row.device_id, row.sensor_index) });
    }
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}
export function convertCtoF(celsius) {
  if ((typeof celsius !== 'number' && typeof celsius !== 'string') ||
      (typeof celsius === 'string' && !celsius.trim()) || !Number.isFinite(Number(celsius))) {
    throw new TypeError('Temperature must be a finite Celsius reading.');
  }
  return Number(celsius) * 9 / 5 + 32;
}
