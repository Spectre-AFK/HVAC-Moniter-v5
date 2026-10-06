# HVAC Telemetry Hub

React + Vite dashboard for ESP32 temperature probes, with Supabase authentication/storage
and a Cloudflare Worker for hosting, admin user lookup, scheduled threshold emails and
persisted temperature-pattern events.

## Setup

Use Node.js 22 and a Supabase project with email/password authentication enabled.
From the repository root:

```powershell
Set-Location iot-dashboard
npm ci
Copy-Item .env.example .env
Copy-Item .dev.vars.example .dev.vars
```

Fill in the local files, which are git-ignored. Never place a service-role key in a
`VITE_` variable: those values are public and embedded in the browser bundle.

| Variable | Location | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Dashboard `.env` | Public browser connection |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Worker vars / `.dev.vars` | Verify sessions |
| `SUPABASE_SERVICE_ROLE_KEY` | Worker secret / `.dev.vars` | Trusted database writes and admin lookups |
| `RESEND_API_KEY` | Worker secret / `.dev.vars` | Threshold email provider |
| `ALERT_FROM_EMAIL` | Worker var / `.dev.vars` | Sender on a verified Resend domain |

### Database setup and upgrades

1. For a new project, run [supabase/schema.sql](supabase/schema.sql) in the SQL editor.
   Existing tables are not replaced. Bootstrap tables are fail-closed until policies are applied.
2. Review and run [the hardening migration](supabase/migrations/20261002_monitoring_hardening.sql).
3. Run [supabase/verify_rls.sql](supabase/verify_rls.sql) and inspect every result.

**The migration replaces every policy on the five monitoring tables.** Review custom
policies before applying it. It leaves unrelated tables alone and runs in a transaction.
Duplicate device grants cause the unique-index step to fail; inspect and resolve duplicates
before retrying, rather than deleting data automatically.

New threshold/name constraints are `NOT VALID` so existing data is not deleted. New writes
must comply. Repair old invalid rows identified by verification, then validate the constraints.
Existing installations must have the columns/unique keys described in the bootstrap schema.
Deploy the migration before the updated UI: notification-state columns are server-managed.

Authenticated users can read readings, names and events only for sensors granted through
`device_permissions`. Administrators can read all sensors and manage grants/names.
Users can manage their own alert rules only for granted sensors (or any sensor for admins).
Only trusted backend credentials can ingest data or update notification state.

Set an administrator's **app_metadata** from the Supabase dashboard/Admin API:

```json
{ "role": "admin" }
```

Do not use user-editable `user_metadata` for authorization. The Worker independently
verifies sessions and administrator roles; client UI checks are not authorization.

### Local development

From [iot-dashboard](iot-dashboard), run `npm run dev`. In a second terminal in that
directory, run `npm run dev:worker` for API features. Vite proxies `/api` to port 8787.
Local Worker credentials can reach real Supabase/Resend services; use a dedicated test
project for scheduled tests, never production secrets.

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite development server |
| `npm run dev:worker` | Local Worker runtime |
| `npm run lint` | Oxlint |
| `npm test` | Detection, history, ingestion, UI, Worker and PostgreSQL policy tests |
| `npm run build` | Production assets |
| `npm run check` | Lint, tests and production build |
| `npm run check:worker` | Worker packaging dry run; does not deploy |
| `npm run preview` | Preview built assets; API routes require a Worker |
| `npm run deploy` | Build and deploy to Cloudflare |

CI runs checks with placeholder public credentials, packages the Worker without deployment,
verifies generated ingestion code, audits dependencies and compiles the classic ESP32 target.
PostgreSQL policy tests use an isolated in-memory PGlite database, not your live project.

## Dashboard behavior

- Public landing page uses simulated data, with its chart loaded near the viewport.
- Email/password sign-in, light/dark theme and multi-device sensor cards.
- Physical sensors are identified by **device_id + sensor_index**, not the index alone.
- Readings are paginated in 500-row requests, up to **10,000 readings** per selected range.
  Reaching the cap always displays a warning: statistics may be partial and slower sensors
  may be absent. Narrow the date range for complete history.
- Live history refreshes every minute; manual sync is available. Requests for obsolete
  dates/users are cancelled and cannot replace the current user's data.
- Fetch errors are shown explicitly. A loaded card is not proof of a healthy connection.
  Paginated queries time out after 30 seconds so a stalled request can be retried.
  Fixed-end ranges show `HISTORY`, not `LIVE`.
- Min/average/max are computed from the loaded rows, not a server-side aggregate of omitted history.
- Friendly sensor names are admin-editable, at most 100 characters.
- Saved alert rules for sensors outside the current readings remain removable in the alerts panel.
- Admin user search supports keyboard selection, paginates users, and reports its scan limit.
  User-ID resolution is batched in groups of 50.

Pagination fixes an upper timestamp for each reading request; it is not an atomic database
snapshot. Concurrent backfilled readings may move offset boundaries. For much larger
installations, use a server-side inventory/aggregation and cursor-based pagination.

## Detection and its limits

[anomalyDetection.js](iot-dashboard/src/anomalyDetection.js) performs deterministic
z-score, short/long trend and flatline checks. It does not diagnose a mechanical fault.

[cycleDetection.js](iot-dashboard/src/cycleDetection.js) infers temperature oscillations
and unusually large drops. Temperature is **not a direct compressor-state measurement**.
Short-cycle inference requires median sample spacing no greater than three minutes and
no gap greater than six minutes. The default ten-minute firmware cadence cannot reliably
resolve sub-twelve-minute equipment cycles; the dashboard reports insufficient sampling.

The Worker logs detected large-drop events to `hvac_events`, deduplicated by physical sensor,
event type and occurrence timestamp.
[routineLearning.js](iot-dashboard/src/routineLearning.js) uses prior-day events only,
requiring four past same-weekday occurrences. Midnight-spanning times use circular clock
differences. Today/future events cannot train the profile being evaluated.
Clock profiles that straddle midnight report a timing caveat instead of declaring a
missing same-day event without a reliable calendar assignment.

Routine messages use the **viewer's local timezone**, update with time in live mode, and
are hidden for historical ranges or capped event history. A site-specific timezone and
multiple daily routine clusters remain future work.

AI summaries are **disabled in the UI** by `AI_SUMMARY_ENABLED` in
[App.jsx](iot-dashboard/src/App.jsx). The authenticated endpoint remains available.
It validates flags and limits bodies to 64 KiB. Its rate limit is best-effort per isolate,
not a distributed quota guarantee.

## Threshold emails

Users configure high/low thresholds through the bell panel. Thresholds must be finite;
when both are set, low must be less than high.

Every five minutes, the Cron Trigger evaluates enabled rules. It verifies the owner's
current sensor access before reading temperatures. Revoked grants do not keep producing emails.
Readings older than **30 minutes**, or more than five minutes in the future, are logged
and do not trigger breach/recovery transitions. No separate offline-sensor email is sent.

Emails are sent for configured threshold transitions only, **not every statistical flag**.
State changes only after provider acceptance. A bounded retry uses a Resend idempotency
key for the same rule/transition/reading. This is not an exactly-once transactional outbox;
provider acceptance followed by a database failure and a newer reading can still duplicate
a notification. Cron failures are logged and fail the invocation rather than looking successful.

## Ingestion and firmware

- [node-red](node-red): production MQTT-to-Supabase flow. Configure environment credentials
  and broker authentication before importing the updated flow.
- [mqtt-bridge](mqtt-bridge): alternative Node.js bridge; do not run both for the same topic.
- [shared/readingPayload.js](shared/readingPayload.js): common payload validation.
  Regenerate the Node-RED function with `node scripts/sync-node-red.mjs` after changing it.
- [esp32 code](esp32%20code): versioned firmware, pinned classic ESP32 build profile and
  [firmware instructions](esp32%20code/README.md).

Both ingestion paths preserve probe indices, skip `null` disconnected probes, and reject
malformed payloads/unsynchronized timestamps rather than substituting the current time.
Writes are still best-effort: neither bridge has a durable offline queue. MQTT now uses
authenticated certificate-verified TLS; follow [the broker rollout](mosquitto/README.md)
before deploying the updated firmware/ingestion configuration. The firmware setup portal
remains unsuitable for an untrusted/public network.
On routers without a working hairpin path, local boards can set an optional private
LAN destination in the portal while retaining the certificate hostname and verified TLS.
Remote boards leave that field blank; public DNS and fallback hostnames are unchanged.

## Deployment and observability

From [iot-dashboard](iot-dashboard), configure Worker secrets with the project-local CLI:

```powershell
npm exec -- wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npm exec -- wrangler secret put RESEND_API_KEY
npm run deploy
```

Secret commands change the deployed Worker; use them only against the intended project.
[wrangler.jsonc](iot-dashboard/wrangler.jsonc) keeps public vars in source because deployment
overwrites dashboard-set vars. Align its public Supabase project with the dashboard build.

The Worker routes `/api/*` before static assets, uses structured logs, and enables logs plus
sampled traces. `GET /api/health` is admin-only and reports configuration presence, not values
or end-to-end email health. Dry-run packaging/tests do not prove live bindings, policies or delivery.

Cron jobs process at most 10,000 discovery/rule rows and fail visibly at that boundary.
Large deployments also need batched database queries, durable jobs/outbox and a distributed
rate limit to stay within platform subrequest/runtime limits.

Personal/legacy backups are not deployed by this project and remain git-ignored.
Generated `.wrangler` state remains local and is not versioned.
