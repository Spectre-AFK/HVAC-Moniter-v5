export const sensorKey = (deviceId, sensorIndex) => `${deviceId}_${sensorIndex}`;
export const SENSOR_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#a855f7', '#ef4444'];
export const sensorColor = (index) => SENSOR_COLORS[index % SENSOR_COLORS.length];
export const shortDeviceId = (deviceId) => deviceId ? deviceId.slice(-4).toUpperCase() : '????';
export const sensorNameLabel = (names, key, index) => names[key]?.trim() || `Sensor ${index}`;
export const sensorLabel = (names, deviceId, index) =>
  `${sensorNameLabel(names, sensorKey(deviceId, index), index)} · Device ${shortDeviceId(deviceId)}`;
export function convertCtoF(celsius) {
  if ((typeof celsius !== 'number' && typeof celsius !== 'string') ||
      (typeof celsius === 'string' && !celsius.trim()) || !Number.isFinite(Number(celsius))) {
    throw new TypeError('Temperature must be a finite Celsius reading.');
  }
  return Number(celsius) * 9 / 5 + 32;
}
