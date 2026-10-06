export function mqttOptions({ MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD }) {
  const url = new URL(MQTT_URL);
  if (url.protocol !== 'mqtts:') throw new TypeError('MQTT_URL must use certificate-verified mqtts://.');
  const labels = url.hostname.split('.');
  if (!url.hostname || url.hostname.length > 253 || labels.length < 2 || /^[0-9.]+$/.test(url.hostname) ||
      labels.some(label => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) {
    throw new TypeError('MQTT_URL must use the broker certificate DNS hostname, not an IP address.');
  }
  if (url.port === '1883') throw new TypeError('Use the TLS listener port, normally 8883, not plaintext port 1883.');
  if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) {
    throw new TypeError('Put MQTT credentials in separate environment variables; do not add URL paths or options.');
  }
  if (!MQTT_USERNAME || !MQTT_PASSWORD) throw new TypeError('MQTT_USERNAME and MQTT_PASSWORD are required.');
  return {
    username: MQTT_USERNAME, password: MQTT_PASSWORD,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    servername: url.hostname,
    reconnectPeriod: 5000,
  };
}
