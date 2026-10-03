import React, { lazy, Suspense, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';
import { 
  Thermometer, Server, Activity, Clock, ShieldAlert, LogOut, Settings, Hash, RefreshCcw, Phone, Mail, 
  TrendingUp, TrendingDown, AlertTriangle, Sparkles, Pencil, BellRing 
} from 'lucide-react';
import LandingPage from './LandingPage';
import ThemeToggle from './ThemeToggle';
import logo from './assets/logo.png';
import { detectRoutineDeviations } from './routineLearning';
import { useTypewriter } from './useTypewriter';
import { fetchPagedRows, loadSensorHistory } from './history';
import { sensorKey as makeSensorKey, shortDeviceId, sensorColor,
  sensorNameLabel as getSensorNameLabel, sensorLabel as getSensorLabel } from './sensors';
import { buildDashboard, sensorStaleness } from './dashboard';

const AdminPanel = lazy(() => import('./AdminPanel'));
const AlertSettings = lazy(() => import('./AlertSettings'));
const TrendChart = lazy(() => import('./TrendChart'));

const COMPANY_NAME = 'Accurate Air Conditioning';
const COMPANY_PHONE = '(520) 230-5453';
const COMPANY_PHONE_HREF = 'tel:+15202305453';
const COMPANY_EMAIL = 'contact@aaronjauregui.com';

// Statistical anomaly detection stays on; the LLM summary is disabled for now (overkill for current needs).
const AI_SUMMARY_ENABLED = false;
const EMPTY_READINGS = [];

// --- Configuration ---
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const supabase = SUPABASE_URL && SUPABASE_ANON_KEY ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

// --- Helper Functions ---
const formatTime = (isoString) => {
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const getStatusColor = (tempF) => {
  if (tempF > 85) return 'text-red-500 dark:text-red-400';
  if (tempF < 65) return 'text-blue-500 dark:text-blue-400';
  return 'text-amber-500 dark:text-amber-400';
};

const getStatusBg = (tempF) => {
  if (tempF > 85) return 'bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-900';
  if (tempF < 65) return 'bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-900';
  return 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900';
};

// Formats a Date as a local "yyyy-MM-ddTHH:mm" string for <input type="datetime-local">
const toDateTimeLocal = (date) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// sensor_index alone isn't unique across devices (each ESP32 numbers its own sensors from 0),
// so every physical sensor must be identified by device_id + sensor_index together.

function CompanyLogo({ className = 'w-9 h-9' }) {
  return <img src={logo} alt={`${COMPANY_NAME} logo`} className={`${className} object-contain shrink-0`} />;
}

// --- Main Application Component ---
export default function App() {
  if (!supabase) {
    return <div role="alert" className="min-h-screen p-8 bg-slate-950 text-white">
      <h1 className="text-xl font-semibold">Dashboard configuration is missing</h1>
      <p>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY before building or starting the dashboard.</p>
    </div>;
  }
  return <ConfiguredApp />;
}

function ConfiguredApp() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authView, setAuthView] = useState('landing'); // 'landing' | 'login', shown only when signed out
  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') !== 'light');
  const [sensorHistory, setSensorHistory] = useState(null);
  const [dataError, setDataError] = useState('');
  const [namesError, setNamesError] = useState('');
  const [eventsError, setEventsError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [eventsLimitReached, setEventsLimitReached] = useState(false);
  const requestRef = useRef(null);
  const userRef = useRef(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [view, setView] = useState('dashboard');
  const [startDate, setStartDate] = useState(() => toDateTimeLocal(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [endDate, setEndDate] = useState('');
  const isLive = endDate === '';
  const userId = session?.user?.id;
  const rangeKey = `${startDate}|${endDate}`;
  const activeHistory = sensorHistory?.userId === userId && sensorHistory?.rangeKey === rangeKey ? sensorHistory : null;
  const sensorData = activeHistory?.rows ?? EMPTY_READINGS;
  const [aiSummary, setAiSummary] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const typedSummary = useTypewriter(aiSummary);

  // Admins are marked via Supabase app_metadata, which users cannot edit themselves.
  const isAdmin = session?.user?.app_metadata?.role === 'admin';

  // Friendly name for each physical sensor (device_id + sensor_index), editable by admins only.
  // Only the "Sensor N" part is editable — the device suffix stays fixed for identification.
  const [sensorNames, setSensorNames] = useState({});
  const [editingSensorKey, setEditingSensorKey] = useState(null);
  const [editingName, setEditingName] = useState('');

  // Logged HVAC setback events (see worker/index.js's cron + src/cycleDetection.js), used to
  // learn each sensor's usual routine (src/routineLearning.js) — independent of the chart's
  // selected date range since routine learning needs long history, not just what's on screen.
  const [hvacEvents, setHvacEvents] = useState([]);
  const sensorNameLabel = useCallback((key, sensorIndex) => getSensorNameLabel(sensorNames, key, sensorIndex), [sensorNames]);
  const sensorLabel = useCallback((_key, deviceId, sensorIndex) => getSensorLabel(sensorNames, deviceId, sensorIndex), [sensorNames]);

  // Authentication Setup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    let active = true;
    let authChanged = false;
    const applySession = (next) => {
      if (!active) return;
      const nextId = next?.user?.id ?? null;
      if (userRef.current !== nextId) {
        requestRef.current?.abort();
        userRef.current = nextId;
        setSensorHistory(null);
        setSensorNames({});
        setHvacEvents([]);
        setView('dashboard');
        setEditingSensorKey(null);
        setPassword('');
        setAiSummary('');
        setDataError('');
        setNamesError('');
        setEventsError('');
        setOperationError('');
        setEventsLimitReached(false);
      }
      setSession(next);
      setLoading(false);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      authChanged = true;
      applySession(next);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active || authChanged) return;
      if (error) throw error;
      applySession(data.session);
    }).catch((error) => {
      if (!active) return;
      console.error('Failed to restore session:', error.message);
      setAuthError('Could not restore your session. Please sign in again.');
      setAuthView('login');
      setLoading(false);
    });
    return () => {
      active = false;
      requestRef.current?.abort();
      subscription.unsubscribe();
    };
  }, []);

  const fetchData = useCallback(async () => {
    if (!userId) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setIsSyncing(true);
    setDataError('');
    try {
      const result = await loadSensorHistory(supabase, { startDate, endDate, signal: controller.signal });
      if (!controller.signal.aborted && userRef.current === userId) {
        setSensorHistory({ ...result, userId, rangeKey });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error('Error fetching data:', error.message);
      setDataError(`Could not load telemetry: ${error.message}`);
    } finally {
      if (requestRef.current === controller) setIsSyncing(false);
    }
  }, [userId, startDate, endDate, rangeKey]);

  const handleSummarizeAnomalies = async () => {
    if (!dashboard?.anomalies?.length) return;
    setIsSummarizing(true);
    setSummaryError('');
    try {
      const res = await fetch('/api/anomaly-summary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ flags: dashboard.anomalies }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = await res.json();
      setAiSummary(data.summary || '');
    } catch (error) {
      console.error('Error summarizing anomalies:', error.message);
      setSummaryError('Could not generate an AI summary right now.');
    } finally {
      setIsSummarizing(false);
    }
  };

  const fetchSensorNames = useCallback(async (signal) => {
    try {
      const { rows, limitReached } = await fetchPagedRows(() => supabase.from('sensor_names').select('*')
        .order('device_id').order('sensor_index'), { signal });
      if (limitReached) throw new Error('Sensor name limit reached. Narrow the deployment or raise the configured limit.');
      if (signal.aborted || userRef.current !== userId) return;
      const map = {};
      for (const row of rows) map[makeSensorKey(row.device_id, row.sensor_index)] = row.name;
      setSensorNames(map);
      setNamesError('');
    } catch (error) {
      if (signal.aborted || userRef.current !== userId) return;
      console.error('Error fetching sensor names:', error.message);
      setNamesError(`Could not load sensor names: ${error.message}`);
    }
  }, [userId]);

  // 90 days of history is plenty for weekday routine learning without the query growing unbounded.
  const fetchHvacEvents = useCallback(async (signal) => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    try {
      const result = await fetchPagedRows(() => supabase.from('hvac_events').select('*')
        .gte('occurred_at', ninetyDaysAgo).order('occurred_at', { ascending: false }).order('id'), { signal });
      if (signal.aborted || userRef.current !== userId) return;
      setHvacEvents(result.rows);
      setEventsLimitReached(result.limitReached);
      setEventsError('');
    } catch (error) {
      if (signal.aborted || userRef.current !== userId) return;
      console.error('Error fetching HVAC events:', error.message);
      setEventsError(`Could not load routine history: ${error.message}`);
    }
  }, [userId]);

  const saveSensorName = async (key, deviceId, sensorIndex) => {
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === sensorNames[key]) {
      setEditingSensorKey(null);
      return;
    }
    if (trimmed.length > 100) {
      setOperationError('Sensor names must be 100 characters or fewer.');
      return;
    }

    try {
      const { error } = await supabase.from('sensor_names')
        .upsert({ device_id: deviceId, sensor_index: sensorIndex, name: trimmed });
      if (error) throw error;
      if (userRef.current !== userId) return;
      setSensorNames((prev) => ({ ...prev, [key]: trimmed }));
      setEditingSensorKey(null);
      setOperationError('');
    } catch (error) {
      if (userRef.current !== userId) return;
      console.error('Error saving sensor name:', error.message);
      setOperationError(`Could not save sensor name: ${error.message}`);
    }
  };

  useEffect(() => {
    fetchData();
    // Only poll for fresh data when the end of the range is "live" (no fixed end date)
    const interval = isLive ? setInterval(fetchData, 60000) : null;
    return () => {
      clearInterval(interval);
      requestRef.current?.abort();
    };
  }, [fetchData, isLive]);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    fetchSensorNames(controller.signal);
    fetchHvacEvents(controller.signal);
    // New setback events only land every so often (worker cron), so this only needs to be
    // much less frequent than the live sensor-data poll above.
    const interval = setInterval(() => fetchHvacEvents(controller.signal), 5 * 60000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [userId, fetchSensorNames, fetchHvacEvents]);

  // A changed date range means different anomalies, so any prior AI summary no longer applies —
  // but routine auto-refresh polling shouldn't wipe a summary the user just generated.
  useEffect(() => {
    setAiSummary('');
    setSummaryError('');
  }, [startDate, endDate]);

  // Ticks independently of data fetches so "time since last reading" stays accurate between polls
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isLive) return;
    const tick = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(tick);
  }, [isLive]);

  // Builds per-sensor stats plus a single time-aligned chart series covering every sensor,
  // so the whole rig can be viewed together instead of switching between sensors one at a time.
  const dashboard = useMemo(() => buildDashboard(sensorData, sensorNames), [sensorData, sensorNames]);

  const nowMinute = Math.floor(now / 60000);
  const routineFlags = useMemo(() => {
    if (!dashboard || !isLive || eventsLimitReached) return [];
    return dashboard.perSensor.flatMap((s) => {
      const sensorSetbacks = hvacEvents.filter(
        (e) => e.device_id === s.deviceId && e.sensor_index === s.sensorIndex && e.event_type === 'setback'
      );
      return detectRoutineDeviations(sensorSetbacks, sensorLabel(s.key, s.deviceId, s.sensorIndex), new Date(nowMinute * 60000)).map((f) => ({
        ...f,
        key: s.key,
      }));
    });
  }, [dashboard, isLive, eventsLimitReached, hvacEvents, sensorLabel, nowMinute]);

  // Infers each sensor's own publish interval from the gaps between its recent readings,
  // rather than assuming a fixed rate shared by every device.
  const stalenessBySensor = useMemo(() => sensorStaleness(dashboard, isLive, now), [dashboard, isLive, now]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    setAuthBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (error) {
      console.error('Sign in failed:', error.message);
      setAuthError(error.message);
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      console.error('Sign out failed:', error.message);
      setOperationError(`Could not sign out: ${error.message}`);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-slate-50 dark:bg-slate-950 dark:text-slate-100 flex items-center justify-center">Loading...</div>;
  }

  if (!session) {
    if (authView === 'landing') {
      return (
        <LandingPage
          onSignIn={() => setAuthView('login')}
          companyName={COMPANY_NAME}
          companyPhone={COMPANY_PHONE}
          companyPhoneHref={COMPANY_PHONE_HREF}
          companyEmail={COMPANY_EMAIL}
          logo={logo}
          isDark={isDark}
          onToggleTheme={() => setIsDark((v) => !v)}
        />
      );
    }

    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-xl w-full max-w-md border border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setAuthView('landing')}
              className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
            >
              ← Back to home
            </button>
            <ThemeToggle isDark={isDark} onToggle={() => setIsDark((v) => !v)} />
          </div>
          <CompanyLogo className="w-16 h-16 mb-6 mx-auto" />
          <h1 className="text-2xl font-bold text-center text-slate-900 dark:text-slate-100 mb-2">{COMPANY_NAME}</h1>
          <p className="text-center text-slate-500 dark:text-slate-400 mb-8">Sign in to view live HVAC telemetry.</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Email</label>
              <input 
                id="login-email"
                autoComplete="username"
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all"
                required
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Password</label>
              <input 
                id="login-password"
                autoComplete="current-password"
                type="password" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-all"
                required
              />
            </div>
            {authError && (
              <div role="alert" className="p-3 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400 text-sm rounded-lg flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" />
                {authError}
              </div>
            )}
            <button 
              type="submit" 
              disabled={authBusy}
              className="w-full bg-slate-900 text-white font-semibold py-2.5 rounded-lg hover:bg-slate-800 dark:bg-amber-500 dark:text-slate-900 dark:hover:bg-amber-400 transition-colors"
            >
              {authBusy ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 font-sans text-slate-800 dark:text-slate-200 selection:bg-amber-500 selection:text-white">
      {/* Top Navigation */}
      <nav className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap gap-3 items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <CompanyLogo className="w-10 h-10 sm:w-16 sm:h-16" />
            <div className="leading-tight min-w-0">
              <span className="font-bold text-lg sm:text-2xl text-slate-900 dark:text-slate-100 tracking-tight block">{COMPANY_NAME}</span>
              <span className="text-sm text-slate-500 dark:text-slate-400">HVAC Telemetry Dashboard</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            <div className="hidden sm:flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full">
              <Server className="w-4 h-4" />
              {dataError ? 'Sync failed' : isSyncing ? 'Syncing...' : activeHistory ? 'Telemetry loaded' : 'Ready to sync'}
            </div>
            {isAdmin && (
              <button
                onClick={() => setView(view === 'admin' ? 'dashboard' : 'admin')}
                className={`p-2 rounded-lg transition-colors ${
                  view === 'admin'
                    ? 'bg-slate-900 text-amber-400 dark:bg-amber-500 dark:text-slate-900'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Admin: Device Access"
                aria-label="Admin: Device Access"
                aria-pressed={view === 'admin'}
              >
                <Settings className="w-5 h-5" />
              </button>
            )}
            <button
              onClick={() => setView(view === 'alerts' ? 'dashboard' : 'alerts')}
              className={`p-2 rounded-lg transition-colors ${
                view === 'alerts'
                  ? 'bg-slate-900 text-amber-400 dark:bg-amber-500 dark:text-slate-900'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title="Sensor Alerts"
              aria-label="Sensor Alerts"
              aria-pressed={view === 'alerts'}
            >
              <BellRing className="w-5 h-5" />
            </button>
            <ThemeToggle isDark={isDark} onToggle={() => setIsDark((v) => !v)} />
            <button 
              onClick={handleLogout}
              className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              title="Sign Out"
              aria-label="Sign Out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {[dataError, namesError, eventsError, operationError].filter(Boolean).map((message) => (
          <div key={message} role="alert" className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {message}
          </div>
        ))}
        {activeHistory?.limitReached && (
          <p role="status" className="mb-4 rounded-lg border border-amber-300 p-3 text-sm text-amber-800 dark:text-amber-300">
            Maximum of 10,000 readings reached. The chart and statistics may show only part of this date range, and some sensors may be missing. Narrow the range to see complete history.
          </p>
        )}
        {eventsLimitReached && (
          <p role="status" className="mb-4 text-sm text-amber-800 dark:text-amber-300">
            Maximum of 10,000 routine events reached. Routine learning is paused because its history may be incomplete.
          </p>
        )}
        <Suspense fallback={<p role="status">Loading panel...</p>}>
        {view === 'admin' && isAdmin ? (
          <AdminPanel
            supabase={supabase}
            accessToken={session.access_token}
            sensors={(dashboard?.perSensor ?? []).map((sensor) => ({
              key: sensor.key,
              deviceId: sensor.deviceId,
              sensorIndex: sensor.sensorIndex,
              label: sensorLabel(sensor.key, sensor.deviceId, sensor.sensorIndex),
            }))}
          />
        ) : view === 'alerts' ? (
          <AlertSettings
            supabase={supabase}
            userId={session.user.id}
            sensors={(dashboard?.perSensor ?? []).map((sensor) => ({
              key: sensor.key,
              deviceId: sensor.deviceId,
              sensorIndex: sensor.sensorIndex,
              label: sensorLabel(sensor.key, sensor.deviceId, sensor.sensorIndex),
            }))}
          />
        ) : (
        <>
        {/* Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-4 mb-8">
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm px-3 py-1.5 min-w-0">
              <label className="flex flex-col text-xs text-slate-400 dark:text-slate-500">
                Start
                <input
                  type="datetime-local"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="text-sm font-medium text-slate-700 dark:text-slate-200 outline-none bg-transparent"
                />
              </label>
              <label className="flex flex-col text-xs text-slate-400 dark:text-slate-500">
                End
                <input
                  type="datetime-local"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={isLive}
                  className="text-sm font-medium text-slate-700 dark:text-slate-200 outline-none bg-transparent disabled:text-slate-300 dark:disabled:text-slate-600"
                />
              </label>
              <button
                onClick={() => setEndDate(isLive ? toDateTimeLocal(new Date()) : '')}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                  isLive
                    ? 'bg-slate-900 text-amber-400 dark:bg-amber-500 dark:text-slate-900'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Toggle live end date"
                aria-pressed={isLive}
              >
                LIVE
              </button>
            </div>
            <button 
              onClick={() => fetchData()}
              disabled={isSyncing}
              className={`p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all ${isSyncing ? 'animate-spin' : ''}`}
              title="Force Sync"
              aria-label="Force Sync"
            >
              <RefreshCcw className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Sensor Overview Grid */}
        {dashboard ? (
          <div className="space-y-6">

            {/* AI summary is optional context on top of the per-sensor anomaly badges below */}
            {AI_SUMMARY_ENABLED && dashboard.anomalies.length > 0 && (
              <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-amber-200 dark:border-amber-900/60 shadow-sm">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                      {dashboard.anomalies.length} Anomal{dashboard.anomalies.length === 1 ? 'y' : 'ies'} Detected
                    </h3>
                  </div>
                  <button
                    onClick={handleSummarizeAnomalies}
                    disabled={isSummarizing}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-900 text-amber-400 dark:bg-amber-500 dark:text-slate-900 hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    {isSummarizing ? 'Summarizing…' : 'Summarize with AI'}
                  </button>
                </div>

                {summaryError && (
                  <p className="mt-4 text-sm text-red-600 dark:text-red-400">{summaryError}</p>
                )}
                {aiSummary && (
                  <div className="mt-4 p-4 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-900 text-sm text-slate-700 dark:text-slate-300 flex gap-2">
                    <Sparkles className="w-4 h-4 mt-0.5 text-indigo-500 shrink-0" />
                    <p>
                      {typedSummary}
                      {typedSummary.length < aiSummary.length && (
                        <span className="animate-pulse">▍</span>
                      )}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* One card per sensor so every reading is visible at a glance */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
              {dashboard.perSensor.map((sensor) => {
                const isStale = stalenessBySensor[sensor.key]?.isStale;
                const sensorAnomalies = dashboard.anomalies.filter((f) => f.key === sensor.key);
                const sensorPatterns = [...dashboard.hvacPatterns, ...routineFlags].filter((f) => f.key === sensor.key);
                return (
                  <div
                    key={sensor.key}
                    className={`rounded-2xl p-6 border shadow-sm transition-colors duration-500 ${getStatusBg(sensor.latestTempF)}`}
                  >
                    <div className="flex flex-wrap gap-2 justify-between items-start mb-4">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: sensorColor(sensor.colorIndex) }}
                        />
                        <Thermometer className={`w-5 h-5 ${getStatusColor(sensor.latestTempF)}`} />
                        <span className="font-semibold text-slate-900 dark:text-slate-100 flex flex-wrap items-center min-w-0 max-w-full">
                          <span className="group/device inline-flex items-center gap-1 min-w-0 max-w-full">
                            {editingSensorKey === sensor.key ? (
                              <input
                                autoFocus
                                type="text"
                                aria-label={`Name for sensor ${sensor.sensorIndex}`}
                                maxLength={100}
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                onBlur={() => saveSensorName(sensor.key, sensor.deviceId, sensor.sensorIndex)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') e.currentTarget.blur();
                                  if (e.key === 'Escape') setEditingSensorKey(null);
                                }}
                                className="w-28 px-1.5 py-0.5 text-sm font-normal rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 text-slate-700 dark:text-slate-200 outline-none focus:ring-1 focus:ring-amber-500"
                              />
                            ) : (
                              <>
                                <span className="min-w-0 break-all">{sensorNameLabel(sensor.key, sensor.sensorIndex)}</span>
                                {isAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingSensorKey(sensor.key);
                                      setEditingName(sensorNames[sensor.key] || '');
                                    }}
                                    title="Rename sensor"
                                    aria-label={`Rename ${sensorNameLabel(sensor.key, sensor.sensorIndex)}`}
                                    className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                )}
                              </>
                            )}
                          </span>
                          <span className="ml-1.5 font-normal text-xs text-slate-400 dark:text-slate-500">· Device {shortDeviceId(sensor.deviceId)}</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {sensorAnomalies.length > 0 && (
                          <div
                            className="flex items-center gap-1 px-2 py-1 rounded-full border text-xs font-medium bg-amber-50/80 border-amber-200 text-amber-700 dark:bg-amber-950/50 dark:border-amber-900 dark:text-amber-400"
                            title={`${sensorAnomalies.length} anomal${sensorAnomalies.length === 1 ? 'y' : 'ies'} detected`}
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                            {sensorAnomalies.length}
                          </div>
                        )}
                        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium backdrop-blur-sm ${
                          isStale
                            ? 'bg-red-50/80 border-red-200 text-red-600 dark:bg-red-950/50 dark:border-red-900 dark:text-red-400'
                            : 'bg-white/60 border-slate-200/50 text-slate-600 dark:bg-slate-800/60 dark:border-slate-700/50 dark:text-slate-300'
                        }`}>
                          <span className={`w-2 h-2 rounded-full ${isStale ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'}`}></span>
                          {!isLive ? 'HISTORY' : dataError ? 'SYNC ERROR' : isStale ? 'STALE' : 'LIVE'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-baseline gap-2">
                      <span className={`text-5xl font-extrabold tracking-tighter ${getStatusColor(sensor.latestTempF)}`}>
                        {sensor.latestTempF.toFixed(1)}°
                      </span>
                      <span className="text-xl font-bold text-slate-400 dark:text-slate-500">F</span>
                    </div>

                    <div className="mt-3 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <Clock className="w-3.5 h-3.5" />
                      Last updated: {formatTime(sensor.latest.timestamp)}
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div className="text-[11px] text-slate-400 dark:text-slate-500">Min</div>
                        <div className="font-mono text-sm font-medium text-slate-900 dark:text-slate-100">{sensor.min.toFixed(1)}°</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 dark:text-slate-500">Avg</div>
                        <div className="font-mono text-sm font-medium text-slate-900 dark:text-slate-100">{sensor.avg.toFixed(1)}°</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400 dark:text-slate-500">Max</div>
                        <div className="font-mono text-sm font-medium text-slate-900 dark:text-slate-100">{sensor.max.toFixed(1)}°</div>
                      </div>
                    </div>

                    {sensorAnomalies.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                        {sensorAnomalies.map((flag, i) => (
                          <div key={i} className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                            {flag.type.startsWith('trend') ? (
                              flag.message.includes(' up ') ? (
                                <TrendingUp className="w-3.5 h-3.5 mt-0.5 text-red-500 shrink-0" />
                              ) : (
                                <TrendingDown className="w-3.5 h-3.5 mt-0.5 text-blue-500 shrink-0" />
                              )
                            ) : (
                              <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${flag.severity === 'high' ? 'text-red-500' : 'text-amber-500'}`} />
                            )}
                            <span className="min-w-0 break-words">{flag.message}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {sensorPatterns.length > 0 && (
                      <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                        {sensorPatterns.map((flag, i) => (
                          <div key={i} className="flex items-start gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                            {flag.type === 'short-cycle' || flag.type === 'routine-deviation' || flag.type === 'routine-missing' ? (
                              <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${flag.severity === 'high' ? 'text-red-500' : 'text-amber-500'}`} />
                            ) : (
                              <Activity className="w-3.5 h-3.5 mt-0.5 text-sky-500 shrink-0" />
                            )}
                            <span className="min-w-0 break-words">{flag.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Combined Chart Section */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
              <div className="flex flex-wrap gap-3 items-center justify-between mb-6">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">Historical Trend — All Sensors</h3>
                <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
                  <span>
                    {new Date(startDate).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {' → '}
                    {isLive ? 'Live' : new Date(endDate).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <Hash className="w-4 h-4" />
                </div>
              </div>
              <div className="h-96 w-full">
                <Suspense fallback={<p role="status">Loading chart...</p>}>
                  <TrendChart dashboard={dashboard} names={sensorNames} isDark={isDark} />
                </Suspense>
              </div>
            </div>

          </div>
        ) : (
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-12 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mb-4">
              <Activity className="w-8 h-8 text-slate-400 dark:text-slate-500" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{isSyncing ? 'Loading Telemetry' : dataError ? 'Telemetry Unavailable' : 'No Readings in This Range'}</h3>
            <p className="text-slate-500 dark:text-slate-400 max-w-sm mt-2">
              {dataError ? 'Use Force Sync to retry. Previously loaded readings, if any, are not proof of a healthy connection.'
                : 'No accessible readings match the selected dates. Try a wider range or ask an administrator to check your sensor access.'}
            </p>
          </div>
        )}
        </>
        )}
        </Suspense>
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-slate-500 dark:text-slate-400">
          <span>© {new Date().getFullYear()} {COMPANY_NAME}. All rights reserved.</span>
          <div className="flex flex-wrap justify-center items-center gap-x-5 gap-y-3">
            <a href={COMPANY_PHONE_HREF} className="flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-white transition-colors">
              <Phone className="w-4 h-4" />
              {COMPANY_PHONE}
            </a>
            <a href={`mailto:${COMPANY_EMAIL}`} className="flex items-center gap-1.5 hover:text-slate-900 dark:hover:text-white transition-colors">
              <Mail className="w-4 h-4" />
              {COMPANY_EMAIL}
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}