import React, { useState, useEffect, useMemo } from 'react';
// Import Supabase directly from esm.sh to avoid dependency resolution errors in this environment
import { createClient } from '@supabase/supabase-js';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import { 
  Thermometer, Server, Activity, Clock, ShieldAlert, LogOut, Settings, Hash, RefreshCcw, Phone, Mail 
} from 'lucide-react';
import AdminPanel from './AdminPanel';
import logo from './assets/logo.png';

const COMPANY_NAME = 'Accurate Air Conditioning';
const COMPANY_PHONE = '(520) 230-5453';
const COMPANY_PHONE_HREF = 'tel:+15202305453';
const COMPANY_EMAIL = 'contact@aaronjauregui.com';

// --- Configuration ---
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables. Copy .env.example to .env and fill in your Supabase project values.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Helper Functions ---
const convertCtoF = (celsius) => (parseFloat(celsius) * 9/5) + 32;

const formatTime = (isoString) => {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const getStatusColor = (tempF) => {
  if (tempF > 85) return 'text-red-500';
  if (tempF < 65) return 'text-blue-500';
  return 'text-amber-500';
};

const getStatusBg = (tempF) => {
  if (tempF > 85) return 'bg-red-50 border-red-200';
  if (tempF < 65) return 'bg-blue-50 border-blue-200';
  return 'bg-amber-50 border-amber-200';
};

// Formats a Date as a local "yyyy-MM-ddTHH:mm" string for <input type="datetime-local">
const toDateTimeLocal = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// One distinct color per sensor_index (matches MAX_SENSORS on the ESP32) so the combined
// chart and per-sensor cards stay visually consistent with each other.
const SENSOR_COLORS = ['#f59e0b', '#3b82f6', '#10b981', '#a855f7', '#ef4444'];
const sensorColor = (idx) => SENSOR_COLORS[idx % SENSOR_COLORS.length];

function CompanyLogo({ className = 'w-9 h-9' }) {
  return <img src={logo} alt={`${COMPANY_NAME} logo`} className={`${className} object-contain shrink-0`} />;
}

// --- Main Application Component ---
export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sensorData, setSensorData] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [view, setView] = useState('dashboard');
  const [startDate, setStartDate] = useState(() => toDateTimeLocal(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [endDate, setEndDate] = useState('');
  const isLive = endDate === '';

  // Admins are marked via Supabase app_metadata, which users cannot edit themselves.
  const isAdmin = session?.user?.app_metadata?.role === 'admin';

  // Authentication Setup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchData = async () => {
    if (!session) return;
    setIsSyncing(true);
    
    try {
      let query = supabase
        .from('sensor_data')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(2000);

      if (startDate) query = query.gte('timestamp', new Date(startDate).toISOString());
      if (endDate) query = query.lte('timestamp', new Date(endDate).toISOString());

      const { data, error } = await query;

      if (error) throw error;
      setSensorData(data || []);
    } catch (error) {
      console.error('Error fetching data:', error.message);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Only poll for fresh data when the end of the range is "live" (no fixed end date)
    if (!isLive) return;
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [session, startDate, endDate]);

  // Ticks independently of data fetches so "time since last reading" stays accurate between polls
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!isLive) return;
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(tick);
  }, [isLive]);

  // Builds per-sensor stats plus a single time-aligned chart series covering every sensor,
  // so the whole rig can be viewed together instead of switching between sensors one at a time.
  const dashboard = useMemo(() => {
    if (!sensorData.length) return null;

    const uniqueSensors = [...new Set(sensorData.map(d => d.sensor_index))].sort((a, b) => a - b);

    const perSensor = uniqueSensors.map((sensorIndex) => {
      const readings = sensorData.filter(d => d.sensor_index === sensorIndex);
      const latest = readings[0];
      const latestTempF = convertCtoF(latest.temperature_c);

      const temps = readings.map(d => convertCtoF(d.temperature_c));
      const max = Math.max(...temps);
      const min = Math.min(...temps);
      const avg = temps.reduce((a, b) => a + b, 0) / temps.length;

      // Kept for staleness detection: each device may publish at a different rate
      const recentTimestamps = readings.slice(0, 7).map(d => d.timestamp);

      return { sensorIndex, latest, latestTempF, max, min, avg, recentTimestamps };
    });

    // Readings from the same publish event share an identical timestamp, so grouping by
    // timestamp lines every sensor's value up in a single row for the combined chart.
    const byTimestamp = new Map();
    for (const d of sensorData) {
      if (!byTimestamp.has(d.timestamp)) {
        byTimestamp.set(d.timestamp, { timestamp: d.timestamp, time: formatTime(d.timestamp) });
      }
      byTimestamp.get(d.timestamp)[`sensor${d.sensor_index}`] = Number(convertCtoF(d.temperature_c).toFixed(1));
    }
    const chartData = [...byTimestamp.values()].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return { uniqueSensors, perSensor, chartData };
  }, [sensorData]);

  // Infers each sensor's own publish interval from the gaps between its recent readings,
  // rather than assuming a fixed rate shared by every device.
  const stalenessBySensor = useMemo(() => {
    const map = {};
    if (!dashboard || !isLive) return map;

    for (const sensor of dashboard.perSensor) {
      const timestamps = sensor.recentTimestamps.map(t => new Date(t).getTime());
      const deltas = [];
      for (let i = 0; i < timestamps.length - 1; i++) {
        deltas.push(timestamps[i] - timestamps[i + 1]);
      }
      deltas.sort((a, b) => a - b);
      const expectedIntervalMs = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;

      // Allow some slack over the device's usual interval, with a floor so brief jitter isn't flagged
      const staleThresholdMs = Math.max((expectedIntervalMs ?? 60000) * 2.5, 60000);
      const msSinceLastReading = now - timestamps[0];

      map[sensor.sensorIndex] = { isStale: msSinceLastReading > staleThresholdMs, msSinceLastReading };
    }
    return map;
  }, [dashboard, isLive, now]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError(error.message);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center">Loading...</div>;
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-200">
          <CompanyLogo className="w-16 h-16 mb-6 mx-auto" />
          <h1 className="text-2xl font-bold text-center text-slate-900 mb-2">{COMPANY_NAME}</h1>
          <p className="text-center text-slate-500 mb-8">Sign in to view live HVAC telemetry.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input 
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all"
                required
              />
            </div>
            {authError && (
              <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                {authError}
              </div>
            )}
            <button 
              type="submit" 
              className="w-full bg-slate-900 text-white font-semibold py-2.5 rounded-lg hover:bg-slate-800 transition-colors"
            >
              Sign In
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 selection:bg-amber-500 selection:text-white">
      {/* Top Navigation */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-24 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <CompanyLogo className="w-16 h-16" />
            <div className="leading-tight">
              <span className="font-bold text-2xl text-slate-900 tracking-tight block">{COMPANY_NAME}</span>
              <span className="text-sm text-slate-500">HVAC Telemetry Dashboard</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-sm text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">
              <Server className="w-4 h-4" />
              Supabase Connected
            </div>
            {isAdmin && (
              <button
                onClick={() => setView(view === 'admin' ? 'dashboard' : 'admin')}
                className={`p-2 rounded-lg transition-colors ${
                  view === 'admin'
                    ? 'bg-slate-900 text-amber-400'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                }`}
                title="Admin: Device Access"
              >
                <Settings className="w-5 h-5" />
              </button>
            )}
            <button 
              onClick={handleLogout}
              className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {view === 'admin' && isAdmin ? (
          <AdminPanel supabase={supabase} />
        ) : (
        <>
        {/* Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-1.5">
              <label className="flex flex-col text-xs text-slate-400">
                Start
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="text-sm font-medium text-slate-700 outline-none bg-transparent"
                />
              </label>
              <label className="flex flex-col text-xs text-slate-400">
                End
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={isLive}
                  className="text-sm font-medium text-slate-700 outline-none bg-transparent disabled:text-slate-300"
                />
              </label>
              <button
                onClick={() => setEndDate(isLive ? toDateTimeLocal(new Date()) : '')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                  isLive
                    ? 'bg-slate-900 text-amber-400'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                }`}
                title="Toggle live end date"
              >
                LIVE
              </button>
            </div>
            <button 
              onClick={fetchData}
              className={`p-2 bg-white border border-slate-200 rounded-lg shadow-sm text-slate-600 hover:text-slate-900 transition-all ${isSyncing ? 'animate-spin' : ''}`}
              title="Force Sync"
            >
              <RefreshCcw className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sensor Overview Grid */}
        {dashboard ? (
          <div className="space-y-6">

            {/* One card per sensor so every reading is visible at a glance */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
              {dashboard.perSensor.map((sensor) => {
                const isStale = stalenessBySensor[sensor.sensorIndex]?.isStale;
                return (
                  <div
                    key={sensor.sensorIndex}
                    className={`rounded-2xl p-6 border shadow-sm transition-colors duration-500 ${getStatusBg(sensor.latestTempF)}`}
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: sensorColor(sensor.sensorIndex) }}
                        />
                        <Thermometer className={`w-5 h-5 ${getStatusColor(sensor.latestTempF)}`} />
                        <span className="font-semibold text-slate-900">Sensor {sensor.sensorIndex}</span>
                      </div>
                      <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium backdrop-blur-sm ${
                        isStale
                          ? 'bg-red-50/80 border-red-200 text-red-600'
                          : 'bg-white/60 border-slate-200/50 text-slate-600'
                      }`}>
                        <span className={`w-2 h-2 rounded-full ${isStale ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`}></span>
                        {isStale ? 'STALE' : 'LIVE'}
                      </div>
                    </div>

                    <div className="flex items-baseline gap-2">
                      <span className={`text-5xl font-extrabold tracking-tighter ${getStatusColor(sensor.latestTempF)}`}>
                        {sensor.latestTempF.toFixed(1)}°
                      </span>
                      <span className="text-xl font-bold text-slate-400">F</span>
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                      <Clock className="w-3.5 h-3.5" />
                      Last updated: {formatTime(sensor.latest.timestamp)}
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-[11px] text-slate-400">Min</div>
                        <div className="font-mono text-sm font-medium text-slate-900">{sensor.min.toFixed(1)}°</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400">Avg</div>
                        <div className="font-mono text-sm font-medium text-slate-900">{sensor.avg.toFixed(1)}°</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400">Max</div>
                        <div className="font-mono text-sm font-medium text-slate-900">{sensor.max.toFixed(1)}°</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Combined Chart Section */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-semibold text-slate-900">Historical Trend — All Sensors</h3>
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <span>
                    {new Date(startDate).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {' → '}
                    {isLive ? 'Live' : new Date(endDate).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <Hash className="w-4 h-4" />
                </div>
              </div>
              <div className="h-96 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dashboard.chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis 
                      dataKey="time" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 12 }}
                      minTickGap={50}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 12 }}
                      domain={['dataMin - 2', 'dataMax + 2']}
                      tickFormatter={(val) => `${val}°`}
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px rgba(15, 23, 42, 0.1)' }}
                      labelStyle={{ color: '#64748b', marginBottom: '4px' }}
                    />
                    <Legend
                      formatter={(value) => value.replace('sensor', 'Sensor ')}
                      wrapperStyle={{ fontSize: 12 }}
                    />
                    {dashboard.uniqueSensors.map((sensorIndex) => (
                      <Line
                        key={sensorIndex}
                        type="monotone"
                        dataKey={`sensor${sensorIndex}`}
                        name={`sensor${sensorIndex}`}
                        stroke={sensorColor(sensorIndex)}
                        strokeWidth={2.5}
                        dot={false}
                        connectNulls
                        animationDuration={500}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

          </div>
        ) : (
          <div className="bg-white rounded-2xl p-12 border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
              <Activity className="w-8 h-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900">Awaiting Telemetry</h3>
            <p className="text-slate-500 max-w-sm mt-2">
              The system is connected to Supabase but no sensor readings have been received yet.
            </p>
          </div>
        )}
        </>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-500">
          <span>© {new Date().getFullYear()} {COMPANY_NAME}. All rights reserved.</span>
          <div className="flex items-center gap-5">
            <a href={COMPANY_PHONE_HREF} className="flex items-center gap-1.5 hover:text-slate-900 transition-colors">
              <Phone className="w-4 h-4" />
              {COMPANY_PHONE}
            </a>
            <a href={`mailto:${COMPANY_EMAIL}`} className="flex items-center gap-1.5 hover:text-slate-900 transition-colors">
              <Mail className="w-4 h-4" />
              {COMPANY_EMAIL}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}