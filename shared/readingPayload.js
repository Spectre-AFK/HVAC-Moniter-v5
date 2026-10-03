export const MAX_PAYLOAD_BYTES = 16_384;

export function parseReadingRows(rawPayload, now = Date.now()) {
  if (typeof rawPayload !== 'string' || new TextEncoder().encode(rawPayload).length > MAX_PAYLOAD_BYTES) {
    throw new TypeError('MQTT payload must be a string of at most 16 KiB.');
  }
  const msg = JSON.parse(rawPayload);
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    throw new TypeError('MQTT payload must be an object.');
  }
  const { device_id, timestamp, temperatures } = msg;
  if (typeof device_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(device_id)) {
    throw new TypeError('device_id must contain 1-128 letters, numbers, underscores or hyphens.');
  }
  const milliseconds = timestamp * 1000;
  if (!Number.isFinite(timestamp) || timestamp < 946684800 ||
      !Number.isFinite(milliseconds) || milliseconds > now + 300_000) {
    throw new TypeError('timestamp must be epoch seconds from a synchronized clock, not in the future.');
  }
  if (!Array.isArray(temperatures) || temperatures.length === 0 || temperatures.length > 64) {
    throw new TypeError('temperatures must contain 1-64 probe positions.');
  }
  const isoTimestamp = new Date(milliseconds).toISOString();
  const rows = [];
  temperatures.forEach((temperature_c, sensor_index) => {
    if (temperature_c === null) return;
    if (!Number.isFinite(temperature_c) || temperature_c < -55 || temperature_c > 125) {
      throw new TypeError(`Invalid DS18B20 temperature at probe ${sensor_index}.`);
    }
    rows.push({ device_id, sensor_index, temperature_c, timestamp: isoTimestamp });
  });
  return rows;
}
