# Node-RED: MQTT to Supabase

Production ingestion flow, running on the Pi beside the MQTT broker. The
[Node.js bridge](../mqtt-bridge) is an alternative; do not run both for the same messages.

## Import and configuration

1. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the Node-RED process environment.
   The latter is a secret and bypasses RLS. Restart Node-RED after changing the environment.
2. Import [flows.json](flows.json) and deploy it.
3. Set broker credentials in **Pi Broker (verified TLS) -> Security**. The broker uses
   `mqtt.checkmytemp.com:8883` with TLS and server-certificate verification enabled.
   Never disable verification or put the broker private key into the client TLS config.
4. Verify the **Handle Supabase Response** status and Node-RED error log.

The exported HTTP node does not contain credentials or a hardcoded project URL: the
formatter sets `msg.url` and `msg.headers` from the environment. Do not export filled
service-role credentials back into source control.

First prepare the broker using [the TLS rollout guide](../mosquitto/README.md).
For an already-running flow, edit its existing broker/TLS configuration and preserve the
credentials rather than deploying a second active subscription. A Pi-only hosts entry
can map `mqtt.checkmytemp.com` to `127.0.0.1`, avoiding router hairpin NAT without changing
the certificate hostname. Client cert/key fields stay blank; the public certificate uses
the Node.js CA trust store. Older runtime trust stores may need updating.

## Validation and failures

The formatting function is generated from
[shared/readingPayload.js](../shared/readingPayload.js). Regenerate it from the repository
root using `node scripts/sync-node-red.mjs`; CI rejects a stale generated flow.

Payloads must have a nonempty device identifier, a synchronized epoch-seconds timestamp,
and a bounded array of finite DS18B20 temperatures or `null` disconnected probes. Indices
are preserved. Invalid/missing timestamps are errors, not replaced with "now".

Only an integer HTTP status in the 200-299 range shows green. Missing/non-numeric status,
transport failure and non-2xx responses show red and log an error. Bad payloads are logged
without dumping the complete payload.

Writes are best-effort, not durably queued or automatically retried. Broker/Internet
outages can lose readings; a durable queue and idempotent ingestion would be a separate
operational upgrade.
