// Bridges the local MQTT broker (that the ESP32 boards publish to — see esp32 code/main.ino)
// into Supabase's `sensor_data` table. Run this as a long-lived process on any machine that
// can reach both the MQTT broker (usually the same LAN) and the internet (for Supabase).
//
// Alternative to node-red/flows.json. Run only one ingestion path for a topic to avoid duplicates.
import 'dotenv/config';
import mqtt from 'mqtt';
import { parseReadingRows } from '../shared/readingPayload.js';
import { insertReadings, describeBrokerUrl } from './ingestion.js';

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

let brokerDescription;
try {
  brokerDescription = describeBrokerUrl(MQTT_URL);
} catch {
  console.error('Invalid MQTT_URL. Use a broker URL such as mqtt://host:1883.');
  process.exit(1);
}

const client = mqtt.connect(MQTT_URL, {
  username: MQTT_USERNAME || undefined,
  password: MQTT_PASSWORD || undefined,
  clientId: `hvac-mqtt-bridge-${Math.random().toString(16).slice(2)}`,
  reconnectPeriod: 5000,
});

client.on('connect', () => {
  console.log(`Connected to MQTT broker at ${brokerDescription}`);
  client.subscribe(MQTT_TOPIC, (err) => {
    if (err) console.error(`Failed to subscribe to ${MQTT_TOPIC}:`, err);
    else console.log(`Subscribed to ${MQTT_TOPIC}`);
  });
});

client.on('reconnect', () => console.log('Reconnecting to MQTT broker...'));
client.on('close', () => console.log('MQTT connection closed'));
client.on('error', (err) => console.error('MQTT client error:', err));

const pendingWrites = new Set();
let shuttingDown = false;
async function handleMessage(payload) {
  try {
    const rows = parseReadingRows(payload.toString());
    if (rows.length === 0) return; // every probe on this board reported disconnected
    await insertReadings(rows, { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY });
    console.log(`Wrote ${rows.length} reading(s) for device ${rows[0].device_id}`);
  } catch (err) {
    console.error('Failed to handle MQTT message:', err);
  }
}
client.on('message', (_topic, payload) => {
  if (shuttingDown) {
    console.warn('MQTT message arrived during shutdown and was not processed.');
    return;
  }
  const task = handleMessage(payload);
  pendingWrites.add(task);
  task.then(() => pendingWrites.delete(task));
});

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('Shutting down MQTT bridge...');
  client.end(false, {}, async () => {
    await Promise.all([...pendingWrites]);
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
