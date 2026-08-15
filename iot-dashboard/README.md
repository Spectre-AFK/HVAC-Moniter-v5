# HVAC Telemetry Hub

A React + Vite dashboard for monitoring live temperature data streamed from ESP32 edge devices, backed by Supabase for authentication and storage.

## Features

- **Authenticated access** — email/password sign-in via Supabase Auth; the dashboard is hidden until a session exists.
- **Live temperature readout** — current reading (converted from °C to °F) with a color-coded status (cold/normal/hot).
- **Multi-sensor support** — switch between individual sensors detected in the incoming data.
- **Rolling statistics** — max, average, and min temperature over the last 100 readings per sensor.
- **Historical trend chart** — area chart (via Recharts) of recent readings over time.
- **Auto-refresh** — polls Supabase every 10 seconds, with a manual "force sync" button.

## Tech Stack

- [React 19](https://react.dev/) + [Vite](https://vitejs.dev/)
- [Supabase](https://supabase.com/) (`@supabase/supabase-js`) for auth and data
- [Recharts](https://recharts.org/) for charting
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [lucide-react](https://lucide.dev/) for icons
- [Oxlint](https://oxc.rs/) for linting

## Getting Started

### Prerequisites

- Node.js (LTS recommended)
- A Supabase project with:
  - Auth enabled (email/password)
  - A `sensor_data` table with at least: `sensor_index`, `temperature_c`, `timestamp`

### Install & Run

```bash
npm install
cp .env.example .env   # then fill in your Supabase project values
npm run dev
```

The app will be available at the local URL printed by Vite (typically `http://localhost:5173`).

### Other Scripts

| Command           | Description                    |
| ----------------- | ------------------------------- |
| `npm run dev`     | Start the Vite dev server        |
| `npm run build`   | Build for production             |
| `npm run preview` | Preview the production build     |
| `npm run lint`    | Run Oxlint                       |

## Configuration

Supabase connection details are read from environment variables (see [src/App.jsx](src/App.jsx)):

| Variable                    | Description                          |
| --------------------------- | ------------------------------------- |
| `VITE_SUPABASE_URL`         | Your Supabase project URL             |
| `VITE_SUPABASE_ANON_KEY`    | Your Supabase anonymous/publishable key |

## Project Structure

```
iot-dashboard/
├── public/           # Static assets (favicon, icons)
├── src/
│   ├── App.jsx       # Main dashboard UI, auth, and data-fetching logic
│   ├── App.css
│   ├── index.css     # Tailwind entry point
│   └── main.jsx      # React entry point
├── index.html
└── vite.config.js
```
