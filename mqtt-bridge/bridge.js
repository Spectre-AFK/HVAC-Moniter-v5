// Bridges the local MQTT broker (that the ESP32 boards publish to — see esp32 code/main.ino)
// into Supabase's `sensor_data` table. Run this as a long-lived process on any machine that
// can reach both the MQTT broker (usually the same LAN) and the internet (for Supabase).
//
// This is the missing piece between the firmware and the dashboard: the ESP32s only speak
// MQTT, and nothing else in this repo turns those messages into rows the dashboard can read.
import 'dotenv/config';
import mqtt from 'mqtt';

const {
  MQTT_URL,
  MQTT_USERNAME,
  MQTT_PASSWORD,
  MQTT_TOPIC = 'home/sensors/temp',
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

for (const [name, value] of Object.entries({ MQTT_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!value) {
    console.error(`Missing required environment variable: ${name}. Copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
}

// Parses one ESP32 payload (see esp32 code/main.ino) into sensor_data rows, or null if the
// payload doesn't look like a valid reading (malformed JSON, wrong types, etc).
function parseReadingRows(rawPayload) {
  let msg;
  try {
    msg = JSON.parse(rawPayload);
  } catch {
    return null;
  }

  const { device_id, timestamp, temperatures } = msg;
  if (typeof device_id !== 'string' || !device_id) return null;
  if (!Number.isFinite(timestamp)) return null;
  if (!Array.isArray(temperatures)) return null;

  const isoTimestamp = new Date(timestamp * 1000).toISOString();
  const rows = [];
  temperatures.forEach((tempC, sensorIndex) => {
    if (typeof tempC === 'number' && Number.isFinite(tempC)) {
      rows.push({ device_id, sensor_index: sensorIndex, temperature_c: tempC, timestamp: isoTimestamp });
    }
    // null/missing entries mean that probe was disconnected — skip rather than write a bad reading.
  });
  return rows;
}

async function insertReadings(rows) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/sensor_data`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error(`Supabase insert failed (${res.status}):`, await res.text());
  }
}

const client = mqtt.connect(MQTT_URL, {
  username: MQTT_USERNAME || undefined,
  password: MQTT_PASSWORD || undefined,
  clientId: `hvac-mqtt-bridge-${Math.random().toString(16).slice(2)}`,
  reconnectPeriod: 5000,
});

client.on('connect', () => {
  console.log(`Connected to MQTT broker at ${MQTT_URL}`);
  client.subscribe(MQTT_TOPIC, (err) => {
    if (err) console.error(`Failed to subscribe to ${MQTT_TOPIC}:`, err);
    else console.log(`Subscribed to ${MQTT_TOPIC}`);
  });
});

client.on('reconnect', () => console.log('Reconnecting to MQTT broker...'));
client.on('close', () => console.log('MQTT connection closed'));
client.on('error', (err) => console.error('MQTT client error:', err));

client.on('message', async (topic, payload) => {
  try {
    const rows = parseReadingRows(payload.toString());
    if (!rows) {
      console.warn('Ignoring malformed MQTT payload:', payload.toString());
      return;
    }
    if (rows.length === 0) return; // every probe on this board reported disconnected
    await insertReadings(rows);
    console.log(`Wrote ${rows.length} reading(s) for device ${rows[0].device_id}`);
  } catch (err) {
    console.error('Failed to handle MQTT message:', err);
  }
});

function shutdown() {
  console.log('Shutting down MQTT bridge...');
  client.end(false, {}, () => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
