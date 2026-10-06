# HVAC MQTT → Supabase Bridge

**Not currently deployed.** The production ingestion path is the Node-RED flow in
[../node-red](../node-red), running on the same Pi as the MQTT broker — see its README for
details and important security notes about the Supabase key it uses.

This is a Node.js equivalent of that flow: a small always-on process that subscribes to the
broker and writes each reading into Supabase's `sensor_data` table using the service role key
(bypasses Row Level Security, same as the alert Cron Trigger in
[../iot-dashboard/worker/index.js](../iot-dashboard/worker/index.js)). Use it instead of
Node-RED if you'd rather not run/maintain a Node-RED instance, or as a reference for what a
minimal, dependency-light bridge looks like.

Run it anywhere that can reach both the MQTT broker (typically the same LAN as the ESP32s)
and the internet (for Supabase) — a Raspberry Pi or always-on home server next to the broker
works well.

## Setup

```bash
cd mqtt-bridge
npm install
cp .env.example .env   # fill in your broker + Supabase details
npm start
```

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `MQTT_URL` | Yes | `mqtts://mqtt.checkmytemp.com:8883` — certificate DNS hostname; raw IPs/plaintext URLs are rejected |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | Yes | Authenticated broker credentials in separate variables, never embedded in the URL |
| `MQTT_TOPIC` | No (default `home/sensors/temp`) | Must match `MQTT_TOPIC` in [../esp32 code/config.h](../esp32%20code/config.h) |
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Project Settings → API → service_role key. **Never** put this in a browser-facing app — it bypasses RLS. |

## Why MQTT auth matters

Without a username/password, any device that can reach the broker can publish fake readings
or read every sensor's data. Configure your broker (e.g. Mosquitto) to require auth, then set
`MQTT_USERNAME`/`MQTT_PASSWORD` here and on each ESP32 via its captive portal setup page.

The bridge requires TLS 1.2 or newer and verifies the server certificate/hostname using
Node.js's public CA trust store. It never sets `rejectUnauthorized: false`.
Follow [the broker rollout](../mosquitto/README.md), update old `.env` URLs to `mqtts://`,
and keep Node.js CA trust current. A hosts/DNS override can route the hostname locally
without disabling certificate verification.

## Behavior

- Reconnects automatically to MQTT. Database writes time out after 15 seconds; a failed
  write is logged as a failure and never followed by a "Wrote" success message.
  Failed readings are not queued or automatically retried.
- Skips `null` entries in a payload's `temperatures` array (a disconnected probe) rather than
  writing a bad reading.
- Rejects malformed/non-JSON payloads with an error instead of crashing. Uses
  [the shared validation contract](../shared/readingPayload.js), also generated into Node-RED.
  Epoch timestamps must be from a synchronized clock and no more than five minutes ahead.
  Invalid timestamps are never replaced by the bridge's current time.
