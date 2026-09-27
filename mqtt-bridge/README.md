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
| `MQTT_URL` | Yes | e.g. `mqtt://192.168.0.132:1883` — must match the server/port the ESP32 boards are configured with |
| `MQTT_USERNAME` / `MQTT_PASSWORD` | If broker requires auth | Leave blank for an unauthenticated broker (not recommended — see below) |
| `MQTT_TOPIC` | No (default `home/sensors/temp`) | Must match `MQTT_TOPIC` in [../esp32 code/config.h](../esp32%20code/config.h) |
| `SUPABASE_URL` | Yes | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Project Settings → API → service_role key. **Never** put this in a browser-facing app — it bypasses RLS. |

## Why MQTT auth matters

Without a username/password, any device that can reach the broker can publish fake readings
or read every sensor's data. Configure your broker (e.g. Mosquitto) to require auth, then set
`MQTT_USERNAME`/`MQTT_PASSWORD` here and on each ESP32 via its captive portal setup page.

## Behavior

- Reconnects automatically (both to MQTT and implicitly on the next message if a Supabase
  write fails — failures are logged, not queued/retried).
- Skips `null` entries in a payload's `temperatures` array (a disconnected probe) rather than
  writing a bad reading.
- Ignores malformed/non-JSON payloads with a warning instead of crashing.
