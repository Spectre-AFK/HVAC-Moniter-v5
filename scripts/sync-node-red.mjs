import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const flowPath = fileURLToPath(new URL('../node-red/flows.json', import.meta.url));
const source = readFileSync(new URL('../shared/readingPayload.js', import.meta.url), 'utf8')
  .replaceAll('export ', '')
  .replace('new TextEncoder().encode(rawPayload).length', "Buffer.byteLength(rawPayload, 'utf8')");
const flow = JSON.parse(readFileSync(flowPath, 'utf8'));
flow.find((node) => node.type === 'tab').info =
  'MQTT -> Supabase ingestion. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the Node-RED process environment. ' +
  'Payload validation is generated from shared/readingPayload.js; regenerate with node scripts/sync-node-red.mjs. ' +
  'Configure broker credentials in the MQTT broker node Security tab. Writes are best-effort, not durably queued.';
flow.find((node) => node.name === 'Format for Supabase').func = `${source}
try {
    const rows = parseReadingRows(JSON.stringify(msg.payload));
    if (rows.length === 0) return null;
    const baseUrl = env.get('SUPABASE_URL');
    const key = env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!baseUrl || !key) throw new Error('Missing Supabase ingestion environment variables.');
    msg.url = baseUrl.replace(/\\/$/, '') + '/rest/v1/sensor_data';
    msg.headers = {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
    };
    msg.payload = rows;
    return msg;
} catch (error) {
    node.error('MQTT ingestion rejected: ' + error.message, msg);
    return null;
}`;
const http = flow.find((node) => node.name === 'Push to Supabase');
http.url = '';
http.headers = [];
flow.find((node) => node.name === 'Handle Supabase Response').func = `if (!Number.isInteger(msg.statusCode) || msg.statusCode < 200 || msg.statusCode >= 300) {
    node.error('Supabase insert failed (' + (msg.statusCode ?? 'no HTTP response') + '): ' + msg.payload,
        { _msgid: msg._msgid, statusCode: msg.statusCode });
    node.status({ fill: 'red', shape: 'dot', text: 'Write failed @ ' + new Date().toLocaleTimeString() });
} else {
    node.status({ fill: 'green', shape: 'dot', text: 'ok @ ' + new Date().toLocaleTimeString() });
}
return null;`;
writeFileSync(flowPath, `${JSON.stringify(flow, null, 4)}\n`);
