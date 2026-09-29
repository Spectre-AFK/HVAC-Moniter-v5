import React, { useEffect, useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea
} from 'recharts';
import {
  Thermometer, Activity, BellRing, Radio, Phone, Mail, ArrowRight, AlertTriangle, Users,
  TrendingUp, Repeat, Clock, Cpu, MailCheck, ShieldCheck
} from 'lucide-react';
import ThemeToggle from './ThemeToggle';

// Simulated sensors for the marketing demo — no real data, no login required.
// Each scenario swaps in different sensor readings so visitors can see what the dashboard
// looks like both on a normal day and when something actually needs attention.
// Per-sensor safe range used to color-code cards and the chart threshold line below —
// deliberately per sensor (not one universal hot/cold split) so a cooler warming into the
// 50s still reads as "out of range" even though 58°F alone isn't objectively hot.
const SCENARIOS = [
  {
    key: 'normal',
    label: 'A Normal Day',
    sensors: [
      { id: 0, name: 'Rooftop Unit 1', base: 74, amplitude: 5, safeMin: 65, safeMax: 85, color: '#f59e0b' },
      { id: 1, name: 'Server Closet', base: 68, amplitude: 2.5, safeMin: 60, safeMax: 75, color: '#3b82f6' },
      { id: 2, name: 'Walk-in Cooler', base: 38, amplitude: 3, safeMin: 33, safeMax: 45, color: '#10b981' },
    ],
    alert: null,
  },
  {
    key: 'cooler',
    label: 'Walk-in Cooler Too Warm',
    sensors: [
      { id: 0, name: 'Rooftop Unit 1', base: 74, amplitude: 5, safeMin: 65, safeMax: 85, color: '#f59e0b' },
      { id: 1, name: 'Server Closet', base: 68, amplitude: 2.5, safeMin: 60, safeMax: 75, color: '#3b82f6' },
      { id: 2, name: 'Walk-in Cooler', base: 58, amplitude: 4, safeMin: 33, safeMax: 45, color: '#10b981' },
    ],
    alert: {
      title: 'Example: 1 Sensor Needs Attention',
      affectedSensorId: 2,
      message: '"Walk-in Cooler" has been trending warmer over the last hour — often a sign a door was left open. ' +
        'You\'d get an email the moment it crosses your safe range.',
    },
  },
  {
    key: 'drift',
    label: 'Long-Term Drift Analysis',
    sensors: [
      { id: 0, name: 'Rooftop Unit 1', base: 74, amplitude: 3, drift: 0.15, driftCap: 10, safeMin: 65, safeMax: 85, color: '#f59e0b' },
      { id: 1, name: 'Server Closet', base: 68, amplitude: 2.5, safeMin: 60, safeMax: 75, color: '#3b82f6' },
      { id: 2, name: 'Walk-in Cooler', base: 38, amplitude: 3, safeMin: 33, safeMax: 45, color: '#10b981' },
    ],
    alert: {
      title: 'Example: 1 Sensor Needs Attention',
      affectedSensorId: 0,
      message: '"Rooftop Unit 1" hasn\'t crossed any threshold yet, but its average has been quietly climbing for ' +
        'days — the kind of slow drift a daily glance would miss. Long-term trend analysis catches it early, ' +
        'often weeks before it turns into a hard failure.',
    },
  },
];

const HISTORY_LENGTH = 20;

// Status is relative to each sensor's own safe range, not one universal hot/cold split —
// a cooler that's crept up to 58°F is just as "out of range" as a rooftop unit at 95°F.
const getStatusColor = (tempF, sensor) => {
  if (tempF > sensor.safeMax) return 'text-red-500 dark:text-red-400';
  if (tempF < sensor.safeMin) return 'text-blue-500 dark:text-blue-400';
  return 'text-emerald-500 dark:text-emerald-400';
};

const getStatusBg = (tempF, sensor) => {
  if (tempF > sensor.safeMax) return 'bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-900';
  if (tempF < sensor.safeMin) return 'bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-900';
  return 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-900';
};

const isOutOfRange = (tempF, sensor) => tempF > sensor.safeMax || tempF < sensor.safeMin;

const FEATURES = [
  {
    icon: Activity,
    title: 'Live & Historical Data',
    description: 'Track every sensor as readings stream in live, then pick any date range to review past performance and spot recurring issues.',
  },
  {
    icon: BellRing,
    title: 'Smart Threshold Alerts',
    description: 'Set a safe high/low range per sensor and get an email the instant it\'s crossed — then another the moment it\'s back to normal.',
  },
  {
    icon: TrendingUp,
    title: 'Drift & Flatline Detection',
    description: 'Statistical checks catch slow multi-day drift and sensors that quietly stop reporting — not just hard threshold breaches.',
  },
  {
    icon: Repeat,
    title: 'Short-Cycle Detection',
    description: 'Watches every compressor on/off cycle and flags short-cycling early, often the first sign of a failing capacitor or low refrigerant.',
  },
  {
    icon: Clock,
    title: 'Routine Learning',
    description: 'Learns each sensor\'s usual daily schedule and flags a setback or cycle that\'s late or missing entirely — not just bad temperatures.',
  },
  {
    icon: Users,
    title: 'Built For Your Team',
    description: 'Rename sensors to match how your team already talks about them, and choose exactly who can see which ones.',
  },
];

const HOW_IT_WORKS = [
  {
    icon: Cpu,
    title: 'Sensors report in',
    description: 'Your ESP32 devices publish readings every few minutes, streamed straight into your dashboard.',
  },
  {
    icon: ShieldCheck,
    title: 'Four checks run automatically',
    description: 'Thresholds, statistical anomalies, short-cycling, and routine learning all watch every reading — no setup required.',
  },
  {
    icon: MailCheck,
    title: 'You get an email',
    description: 'The moment something needs attention, and a follow-up the moment it\'s resolved.',
  },
];

function DemoSensorCard({ sensor, value }) {
  const outOfRange = isOutOfRange(value, sensor);
  return (
    <div className={`rounded-2xl p-6 border shadow-sm transition-colors ${getStatusBg(value, sensor)} ${outOfRange ? 'ring-2 ring-red-400/60 dark:ring-red-500/50' : ''}`}>
      <div className="flex justify-between items-start mb-4">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: sensor.color }} />
          <Thermometer className={`w-5 h-5 ${getStatusColor(value, sensor)}`} />
          <span className="font-semibold text-slate-900 dark:text-slate-100">{sensor.name}</span>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${
          outOfRange
            ? 'bg-red-100 border-red-300 text-red-700 dark:bg-red-950/60 dark:border-red-800 dark:text-red-300'
            : 'bg-white/60 border-slate-200/50 text-slate-600 dark:bg-slate-800/60 dark:border-slate-700/50 dark:text-slate-300'
        }`}>
          <span className={`w-2 h-2 rounded-full animate-pulse ${outOfRange ? 'bg-red-500' : 'bg-emerald-500'}`}></span>
          {outOfRange ? 'OUT OF RANGE' : 'LIVE'}
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`text-5xl font-extrabold tracking-tighter ${getStatusColor(value, sensor)}`}>
          {value.toFixed(1)}°
        </span>
        <span className="text-xl font-bold text-slate-400 dark:text-slate-500">F</span>
      </div>
      <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">Safe range: {sensor.safeMin}°–{sensor.safeMax}°F</p>
    </div>
  );
}

export default function LandingPage({ onSignIn, companyName, companyPhone, companyPhoneHref, companyEmail, logo, isDark, onToggleTheme }) {
  const [tick, setTick] = useState(0);
  const [history, setHistory] = useState([]);
  const [scenarioKey, setScenarioKey] = useState(SCENARIOS[0].key);
  const scenario = SCENARIOS.find((s) => s.key === scenarioKey) ?? SCENARIOS[0];
  const demoSensors = scenario.sensors;

  // Advances the simulated waveform so the demo dashboard visibly "breathes" like a live feed
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(interval);
  }, []);

  // Starts each scenario's chart fresh instead of jumping mid-line from the previous one
  useEffect(() => {
    setHistory([]);
  }, [scenarioKey]);

  const liveValues = useMemo(() => {
    const values = {};
    for (const sensor of demoSensors) {
      const wave = Math.sin((tick + sensor.id * 3) / 4) * sensor.amplitude;
      const jitter = (Math.random() - 0.5) * (sensor.jitter ?? 0.6);
      // Drift creeps upward with time but is capped so a long-open tab doesn't run away forever.
      const drift = sensor.drift ? Math.min(sensor.drift * tick, sensor.driftCap ?? Infinity) : 0;
      values[sensor.id] = sensor.base + wave + jitter + drift;
    }
    return values;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, scenarioKey]);

  // The sensor called out in the active scenario's alert, used to highlight its line and
  // draw its safe-range threshold on the chart so the breach is visible, not just implied.
  const alertSensor = scenario.alert
    ? demoSensors.find((s) => s.id === scenario.alert.affectedSensorId)
    : null;

  useEffect(() => {
    const point = { time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) };
    for (const sensor of demoSensors) {
      point[`sensor${sensor.id}`] = Number(liveValues[sensor.id]?.toFixed(1));
    }
    setHistory((prev) => [...prev, point].slice(-HISTORY_LENGTH));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const scrollToDemo = () => {
    document.getElementById('live-demo')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-800 dark:text-slate-200">
      {/* Nav */}
      <nav className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logo} alt={`${companyName} logo`} className="w-10 h-10 object-contain shrink-0" />
            <span className="font-bold text-lg text-slate-900 dark:text-slate-100 tracking-tight">{companyName}</span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle isDark={isDark} onToggle={onToggleTheme} />
            <button
              onClick={onSignIn}
              className="bg-slate-900 text-white font-semibold px-4 py-2 rounded-lg hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-900 dark:hover:bg-amber-400 transition-colors text-sm"
            >
              Sign In
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 text-center">
        <div className="pointer-events-none absolute inset-x-0 -top-24 flex justify-center -z-10">
          <div className="h-72 w-[36rem] rounded-full bg-amber-400/20 dark:bg-amber-500/10 blur-3xl" />
        </div>
        <div className="inline-flex items-center gap-2 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-400 dark:bg-amber-950/40 dark:border-amber-900 rounded-full px-3 py-1 mb-6">
          <Radio className="w-3.5 h-3.5" />
          Live HVAC Telemetry, Anywhere
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight max-w-3xl mx-auto">
          Know the problem, before it becomes a problem.
        </h1>
        <p className="mt-6 text-lg text-slate-500 dark:text-slate-400 max-w-2xl mx-auto">
          {companyName}'s HVAC monitoring dashboard streams live sensor data from rooftop units, server rooms, and
          coolers so you can catch failures early and keep customers comfortable.
        </p>
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={onSignIn}
            className="w-full sm:w-auto bg-slate-900 text-white font-semibold px-6 py-3 rounded-lg hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-900 dark:hover:bg-amber-400 transition-colors flex items-center justify-center gap-2"
          >
            Sign In to Your Dashboard
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={scrollToDemo}
            className="w-full sm:w-auto bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold px-6 py-3 rounded-lg border border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 transition-colors"
          >
            See Live Demo
          </button>
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-sm text-slate-500 dark:text-slate-400">
          <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-amber-500" /> 4 detection engines watching every reading</span>
          <span className="flex items-center gap-2"><Clock className="w-4 h-4 text-amber-500" /> Checked every 5 minutes, day and night</span>
          <span className="flex items-center gap-2"><MailCheck className="w-4 h-4 text-amber-500" /> Resolved alerts emailed too, so you know it's over</span>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <div key={title} className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center mb-4">
                <Icon className="w-5 h-5 text-slate-700 dark:text-slate-300" />
              </div>
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">{title}</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">{description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 sm:p-10 border border-slate-200 dark:border-slate-800 shadow-sm">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-slate-100 text-center mb-10">How it works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map(({ icon: Icon, title, description }, index) => (
              <div key={title} className="text-center">
                <div className="relative w-12 h-12 mx-auto bg-slate-900 dark:bg-amber-500 rounded-full flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-white dark:text-slate-900" />
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-500 dark:text-slate-400 flex items-center justify-center">
                    {index + 1}
                  </span>
                </div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-2">{title}</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs mx-auto">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Live Demo */}
      <section id="live-demo" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-full px-3 py-1 mb-4">
            Simulated data · No login required
          </div>
          <h2 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Try the dashboard yourself</h2>
          <p className="mt-3 text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
            This preview updates every few seconds with simulated readings so you can see exactly what your team
            will get after signing in.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            {SCENARIOS.map((s) => (
              <button
                key={s.key}
                onClick={() => setScenarioKey(s.key)}
                className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  s.key === scenarioKey
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-amber-500 dark:text-slate-900 dark:border-amber-500'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {demoSensors.map((sensor) => (
              <DemoSensorCard key={sensor.id} sensor={sensor} value={liveValues[sensor.id] ?? sensor.base} />
            ))}
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-6">Live Trend Preview</h3>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    {demoSensors.map((sensor) => (
                      <linearGradient key={sensor.id} id={`demo-gradient-${sensor.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={sensor.color} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={sensor.color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDark ? '#334155' : '#e2e8f0'} />
                  <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: isDark ? '#64748b' : '#94a3b8', fontSize: 12 }} minTickGap={40} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: isDark ? '#64748b' : '#94a3b8', fontSize: 12 }} tickFormatter={(val) => `${val}°`} />
                  <Tooltip
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px rgba(15, 23, 42, 0.1)', backgroundColor: isDark ? '#1e293b' : '#ffffff' }}
                    labelStyle={{ color: isDark ? '#94a3b8' : '#64748b', marginBottom: '4px' }}
                    itemStyle={{ color: isDark ? '#e2e8f0' : '#1e293b' }}
                  />
                  {alertSensor && (
                    <ReferenceArea y1={alertSensor.safeMax} y2={200} fill="#ef4444" fillOpacity={0.08} ifOverflow="extendDomain" />
                  )}
                  {alertSensor && (
                    <ReferenceLine
                      y={alertSensor.safeMax}
                      stroke="#ef4444"
                      strokeDasharray="6 4"
                      strokeWidth={1.5}
                      ifOverflow="extendDomain"
                      label={{ value: `${alertSensor.name} safe max ${alertSensor.safeMax}°F`, position: 'insideTopRight', fill: '#ef4444', fontSize: 11, fontWeight: 600 }}
                    />
                  )}
                  {demoSensors.map((sensor) => (
                    <Area
                      key={sensor.id}
                      type="monotone"
                      dataKey={`sensor${sensor.id}`}
                      name={sensor.name}
                      stroke={sensor.color}
                      strokeWidth={alertSensor?.id === sensor.id ? 3.5 : 2}
                      strokeOpacity={alertSensor && alertSensor.id !== sensor.id ? 0.35 : 1}
                      fillOpacity={alertSensor && alertSensor.id !== sensor.id ? 0.4 : 1}
                      fill={`url(#demo-gradient-${sensor.id})`}
                      dot={false}
                      connectNulls
                      animationDuration={400}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Illustrates how anomaly detection + email alerts look together, in plain language */}
          <div className={`rounded-2xl p-6 border shadow-sm ${scenario.alert ? 'bg-white dark:bg-slate-900 border-amber-200 dark:border-amber-900/60' : 'bg-white dark:bg-slate-900 border-emerald-200 dark:border-emerald-900/60'}`}>
            <div className="flex items-center gap-2">
              <AlertTriangle className={`w-5 h-5 ${scenario.alert ? 'text-amber-500' : 'text-emerald-500'}`} />
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                {scenario.alert ? scenario.alert.title : 'Example: All Sensors Normal'}
              </h3>
            </div>
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              {scenario.alert
                ? scenario.alert.message
                : 'Every sensor is reading within its safe range, so there\'s nothing to do here — that\'s the goal. ' +
                  'Try one of the other examples above to see what it looks like when something needs attention.'}
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
        <div className="bg-slate-900 rounded-2xl px-8 py-12 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-white">Ready to monitor your HVAC systems?</h2>
          <p className="mt-3 text-slate-300 max-w-lg mx-auto">
            Sign in with your {companyName} account to see live data from your own sensors.
          </p>
          <button
            onClick={onSignIn}
            className="mt-6 bg-amber-500 text-slate-900 font-semibold px-6 py-3 rounded-lg hover:bg-amber-400 transition-colors"
          >
            Sign In
          </button>
        </div>
      </section>

      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-500 dark:text-slate-400">
          <span>© {new Date().getFullYear()} {companyName}. All rights reserved.</span>
          <div className="flex items-center gap-5">
            <a href={companyPhoneHref} className="flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-white transition-colors">
              <Phone className="w-4 h-4" />
              {companyPhone}
            </a>
            <a href={`mailto:${companyEmail}`} className="flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-white transition-colors">
              <Mail className="w-4 h-4" />
              {companyEmail}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
