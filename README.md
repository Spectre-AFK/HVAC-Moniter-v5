# HVAC Telemetry Hub

A React + Vite dashboard for monitoring live temperature data streamed from ESP32 edge devices, backed by Supabase for authentication and storage.

## Features

- **Marketing landing page** — a public page with a simulated live demo dashboard, shown before sign-in.
- **Authenticated access** — email/password sign-in via Supabase Auth; the real dashboard is hidden until a session exists.
- **Light/dark theme toggle** — available on every screen, defaults to dark, and persists across visits.
- **Live temperature readout** — current reading (converted from °C to °F) with a color-coded status (cold/normal/hot).
- **Multi-sensor support** — every sensor detected in the incoming data is shown on one dashboard.
- **Rolling statistics** — max, average, and min temperature per sensor over the selected date range.
- **Historical trend chart** — combined line chart (via Recharts) of every sensor over time.
- **Auto-refresh** — polls Supabase every 60 seconds when viewing live data, with a manual "force sync" button.
- **Admin device access panel** — admins can grant or revoke a user's access to a specific sensor.
- **Anomaly detection** — plain-statistics checks (z-score, trend slope, flatline) flag unusual readings per sensor, client-side, for free.
- **AI anomaly summaries** — an optional "Summarize with AI" button sends already-detected anomalies to a Cloudflare Worker (Workers AI) to generate a plain-English explanation for technicians.

## Tech Stack

- [React 19](https://react.dev/) + [Vite](https://vitejs.dev/)
- [Supabase](https://supabase.com/) (`@supabase/supabase-js`) for auth and data
- [Recharts](https://recharts.org/) for charting
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [lucide-react](https://lucide.dev/) for icons
- [Oxlint](https://oxc.rs/) for linting
- [Cloudflare Workers](https://developers.cloudflare.com/workers/) + [Workers AI](https://developers.cloudflare.com/workers-ai/) for hosting and the anomaly-summary endpoint

## Getting Started

### Prerequisites

- Node.js (LTS recommended)
- A Supabase project with:
  - Auth enabled (email/password)
  - A `sensor_data` table with at least: `sensor_index`, `temperature_c`, `timestamp`
  - A `device_permissions` table with at least: `id`, `user_id` (uuid), `sensor_index` (int)

### Install & Run

```bash
npm install
cp .env.example .env   # then fill in your Supabase project values
cp .dev.vars.example .dev.vars   # then fill in the same Supabase project values (for the Worker)
npm run dev
```

The app will be available at the local URL printed by Vite (typically `http://localhost:5173`).

The "Summarize with AI" button calls a Cloudflare Worker endpoint (`/api/anomaly-summary`), which Vite proxies to `http://127.0.0.1:8787`. Run it in a second terminal to test that feature locally:

```bash
npm run dev:worker
```

### Other Scripts

| Command              | Description                                          |
| -------------------- | ----------------------------------------------------- |
| `npm run dev`        | Start the Vite dev server                              |
| `npm run dev:worker` | Start `wrangler dev` for the `/api/anomaly-summary` Worker |
| `npm run build`      | Build for production                                   |
| `npm run preview`    | Preview the production build                           |
| `npm run lint`       | Run Oxlint                                             |
| `npm run deploy`     | Build, then deploy the app + Worker to Cloudflare       |

## Configuration

Supabase connection details are read from environment variables (see [src/App.jsx](src/App.jsx)):

| Variable                    | Description                          |
| --------------------------- | ------------------------------------- |
| `VITE_SUPABASE_URL`         | Your Supabase project URL             |
| `VITE_SUPABASE_ANON_KEY`    | Your Supabase anonymous/publishable key |

Copy `.env.example` to `.env` and fill in your project's values. `.env` is git-ignored, so it won't be committed. Note that Vite exposes any `VITE_`-prefixed variable to the client bundle, so continue to rely on Supabase Row Level Security to protect your data — the anon key is not a secret, but should still be kept out of source control.

## Admin Access

The admin panel ([src/AdminPanel.jsx](src/AdminPanel.jsx)) lets an admin grant or revoke a user's access to a sensor by inserting/deleting rows in `device_permissions`. It's shown in the nav (gear icon) only when the signed-in user's session has `app_metadata.role === 'admin'`.

To make a user an admin, set their `app_metadata` from the Supabase dashboard or via the admin API (service role key required) — this field cannot be edited by the user themselves:

```json
{ "role": "admin" }
```

**Important:** the client-side check above only controls UI visibility. Anyone with the anon key can otherwise call the same Supabase queries directly, so enforce this for real with Row Level Security policies on `device_permissions`, e.g. restrict `insert`/`delete` to requests where `auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'`, and restrict `select` so users can only read their own permission rows (admins can read all).

Run this in the Supabase SQL editor to enforce it:

```sql
-- Enable RLS so no row is accessible unless a policy explicitly allows it
alter table public.device_permissions enable row level security;

-- Admins can see every permission row; regular users can only see their own
create policy "device_permissions_select"
on public.device_permissions
for select
to authenticated
using (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  or user_id = auth.uid()
);

-- Only admins can grant access
create policy "device_permissions_insert"
on public.device_permissions
for insert
to authenticated
with check (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

-- Only admins can revoke access
create policy "device_permissions_delete"
on public.device_permissions
for delete
to authenticated
using (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);
```

## Restricting Sensor Visibility

By default, any authenticated user can read every row in `sensor_data`, regardless of what's granted in `device_permissions` — the permissions table only guards the admin panel above. To make `device_permissions` actually gate which sensors a user can view on the dashboard, add RLS to `sensor_data` as well:

```sql
alter table public.sensor_data enable row level security;

-- Admins see every sensor; regular users only see sensors granted to them
create policy "sensor_data_select"
on public.sensor_data
for select
to authenticated
using (
  (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  or exists (
    select 1
    from public.device_permissions dp
    where dp.sensor_index = sensor_data.sensor_index
      and dp.user_id = auth.uid()
  )
);
```

No frontend changes are required for this — [src/App.jsx](src/App.jsx) already derives its sensor selector and "awaiting telemetry" state from whatever rows Supabase returns, so it naturally reflects whatever the RLS policy allows.

**Note:** this only covers reads. If your ESP32 devices insert rows into `sensor_data` using the anon key, enabling RLS here will also block those inserts unless you add a matching `insert` policy (or have the devices write via the service role key / a server-side function, which bypasses RLS).

## Anomaly Detection & AI Summaries

[src/anomalyDetection.js](src/anomalyDetection.js) runs three plain-statistics checks on each sensor's readings in the selected date range, entirely client-side and free:

- **Z-score** — the latest reading is an outlier vs. that sensor's own recent mean/stddev.
- **Trend** — a sustained rise or fall (linear regression slope) over recent readings, e.g. a slowly failing compressor.
- **Flatline** — an unchanging value for many consecutive readings, e.g. a stuck or disconnected sensor.

When any anomalies are found, the dashboard shows them in an "Anomalies Detected" panel with a **Summarize with AI** button. That button calls the `/api/anomaly-summary` endpoint in [worker/index.js](worker/index.js), which runs on Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct-fast`) to turn the already-detected flags into a plain-English note for a technician — the model never sees raw sensor data and never decides what counts as an anomaly, it only explains flags the statistics already raised. The endpoint verifies the caller's Supabase session token before calling the model, so it can't be used by unauthenticated requests.

To enable it, your Cloudflare account needs [Workers AI](https://developers.cloudflare.com/workers-ai/) access (available on the free tier with usage limits).

## Deployment

This app deploys as a single [Cloudflare Worker](https://developers.cloudflare.com/workers/) that serves the built static assets and the `/api/anomaly-summary` endpoint (see [wrangler.jsonc](wrangler.jsonc)):

```bash
npm run deploy
```

Before deploying, set the Worker's `SUPABASE_URL` and `SUPABASE_ANON_KEY` vars (same values as `.env`) either directly in `wrangler.jsonc`, or via the Cloudflare dashboard / `wrangler deploy --var` so they aren't hardcoded in the committed config. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` still need to be set wherever `npm run build` runs, since Vite bakes them into the client bundle at build time.

## Project Structure

```
iot-dashboard/
├── public/             # Static assets (favicon, icons)
├── worker/
│   └── index.js        # Cloudflare Worker: serves built assets + /api/anomaly-summary (Workers AI)
├── src/
│   ├── App.jsx         # Main dashboard UI, auth, and data-fetching logic
│   ├── anomalyDetection.js # Plain-statistics anomaly checks (z-score, trend, flatline)
│   ├── LandingPage.jsx # Public marketing page with a simulated live demo
│   ├── AdminPanel.jsx  # Admin-only device access management
│   ├── ThemeToggle.jsx # Light/dark mode toggle button
│   ├── App.css
│   ├── index.css       # Tailwind entry point
│   └── main.jsx        # React entry point
├── index.html
├── wrangler.jsonc
└── vite.config.js
```
