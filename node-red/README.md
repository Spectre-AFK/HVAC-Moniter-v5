# Node-RED: MQTT → Supabase Ingestion

This is the **production** bridge between the ESP32 boards ([../esp32 code](../esp32%20code))
and Supabase's `sensor_data` table: it runs on the same Pi as the local MQTT broker, subscribes
to `home/sensors/temp`, reshapes each payload into one row per sensor, and POSTs them to
Supabase's REST API.

[mqtt-bridge](../mqtt-bridge) is a Node.js implementation of the same job — useful if you ever
want to run this without Node-RED installed, but it isn't what's actually deployed.

## Importing

In the Node-RED editor: menu → Import → paste [flows.json](flows.json) (or "select a file"),
then open the **Push to Supabase** node and fill in the `apikey` / `Authorization` headers with
your Supabase **service_role** key (Project Settings → API — this bypasses RLS, which is correct
for a trusted backend process like this one, but never put it anywhere reachable from a browser),
and open the **Local Pi Broker** config node's *Security* tab to set MQTT username/password if
the broker requires auth.

## What changed vs. the raw export

- **Format for Supabase** now checks that `temperatures` is an array and `device_id` is a string
  before mapping, instead of throwing (and silently losing the message) on a malformed payload.
- **Push to Supabase** has `senderr` enabled and its response is now wired to a new
  **Handle Supabase Response** node, which logs (`node.error`) and surfaces a node status dot for
  any non-2xx response — previously a failed insert (bad policy, network blip, schema mismatch)
  had no visible trace anywhere.
- The MQTT broker still has no username/password configured. Set one (Security tab on **Local Pi
  Broker**) once your ESP32 boards are flashed with the `MQTT_USERNAME`/`MQTT_PASSWORD` support
  added in [../esp32 code/config.h](../esp32%20code/config.h) — otherwise anything on the LAN can
  publish fake sensor data or read every reading.
