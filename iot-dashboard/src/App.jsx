import React, { useState, useEffect, useMemo } from 'react';
// Import Supabase directly from esm.sh to avoid dependency resolution errors in this environment
import { createClient } from '@supabase/supabase-js';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area 
} from 'recharts';
import { 
  Thermometer, Server, Activity, Clock, ShieldAlert, LogOut, Settings, Hash, RefreshCcw 
} from 'lucide-react';

// --- Configuration ---
const SUPABASE_URL = "https://swbcwtrijguodjaxyitm.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_iVV7-ht6QWT2cqYg_MxWfg_cdPRWd2Y"; 
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

// --- Main Application Component ---
export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sensorData, setSensorData] = useState([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedSensor, setSelectedSensor] = useState(0);

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
      const { data, error } = await supabase
        .from('sensor_data')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(100);

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
    // Poll every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [session]);

  const analytics = useMemo(() => {
    if (!sensorData.length) return null;

    // Filter data for the selected sensor
    const filteredData = sensorData.filter(d => d.sensor_index === selectedSensor);
    if (!filteredData.length) return null;

    const latest = filteredData[0];
    const latestTempF = convertCtoF(latest.temperature_c);
    
    // Calculate averages and extremes
    const temps = filteredData.map(d => convertCtoF(d.temperature_c));
    const max = Math.max(...temps);
    const min = Math.min(...temps);
    const avg = temps.reduce((a, b) => a + b, 0) / temps.length;

    // Prepare chart data (chronological order)
    const chartData = [...filteredData].reverse().map(d => ({
      time: formatTime(d.timestamp),
      temp: convertCtoF(d.temperature_c).toFixed(1)
    }));

    // Find unique sensors for the selector
    const uniqueSensors = [...new Set(sensorData.map(d => d.sensor_index))].sort();

    return { latest, latestTempF, max, min, avg, chartData, uniqueSensors };
  }, [sensorData, selectedSensor]);

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
          <div className="flex items-center justify-center w-16 h-16 bg-slate-900 rounded-xl mb-6 mx-auto">
            <Activity className="w-8 h-8 text-amber-400" />
          </div>
          <h1 className="text-2xl font-bold text-center text-slate-900 mb-2">System Access</h1>
          <p className="text-center text-slate-500 mb-8">Authenticate to view live telemetry.</p>
          
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-slate-900 rounded-lg flex items-center justify-center">
              <Activity className="w-5 h-5 text-amber-400" />
            </div>
            <span className="font-bold text-lg text-slate-900 tracking-tight">Telemetry Hub</span>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-sm text-slate-500 bg-slate-100 px-3 py-1.5 rounded-full">
              <Server className="w-4 h-4" />
              Supabase Connected
            </div>
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
        
        {/* Header & Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Environment Monitor</h1>
            <p className="text-sm text-slate-500 mt-1">Real-time data from ESP32 edge devices.</p>
          </div>
          
          <div className="flex items-center gap-3">
            {analytics?.uniqueSensors && (
              <div className="flex items-center bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
                {analytics.uniqueSensors.map(sensorIdx => (
                  <button
                    key={sensorIdx}
                    onClick={() => setSelectedSensor(sensorIdx)}
                    className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
                      selectedSensor === sensorIdx 
                        ? 'bg-slate-900 text-amber-400 shadow' 
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                    }`}
                  >
                    Sensor {sensorIdx}
                  </button>
                ))}
              </div>
            )}
            <button 
              onClick={fetchData}
              className={`p-2 bg-white border border-slate-200 rounded-lg shadow-sm text-slate-600 hover:text-slate-900 transition-all ${isSyncing ? 'animate-spin' : ''}`}
              title="Force Sync"
            >
              <RefreshCcw className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Analytics Grid */}
        {analytics ? (
          <div className="space-y-6">
            
            {}
            {/* Top Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              
              {/* Primary Live Readout */}
              <div className={`col-span-1 md:col-span-2 rounded-2xl p-6 border shadow-sm transition-colors duration-500 ${getStatusBg(analytics.latestTempF)}`}>
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-2">
                    <Thermometer className={`w-6 h-6 ${getStatusColor(analytics.latestTempF)}`} />
                    <span className="font-semibold text-slate-900">Current Temperature</span>
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/60 rounded-full border border-slate-200/50 text-xs font-medium text-slate-600 backdrop-blur-sm">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    LIVE
                  </div>
                </div>
                
                <div className="flex items-baseline gap-2">
                  <span className={`text-6xl font-extrabold tracking-tighter ${getStatusColor(analytics.latestTempF)}`}>
                    {analytics.latestTempF.toFixed(1)}°
                  </span>
                  <span className="text-2xl font-bold text-slate-400">F</span>
                </div>
                
                <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                  <Clock className="w-4 h-4" />
                  Last updated: {formatTime(analytics.latest.timestamp)}
                </div>
              </div>

              {/* Stats Card */}
              <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900 mb-4">Rolling Statistics</h3>
                  <div className="space-y-4">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500">Maximum</span>
                      <span className="font-mono font-medium text-slate-900">{analytics.max.toFixed(1)}°F</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500">Average</span>
                      <span className="font-mono font-medium text-slate-900">{analytics.avg.toFixed(1)}°F</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-slate-500">Minimum</span>
                      <span className="font-mono font-medium text-slate-900">{analytics.min.toFixed(1)}°F</span>
                    </div>
                  </div>
                </div>
                
                <div className="mt-6 pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                  <span>Based on last 100 readings</span>
                  <Hash className="w-4 h-4" />
                </div>
              </div>
            </div>

            {}
            {/* Chart Section */}
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
              <h3 className="font-semibold text-slate-900 mb-6">Historical Trend</h3>
              <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={analytics.chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorTemp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
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
                      itemStyle={{ color: '#0f172a', fontWeight: 'bold' }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="temp" 
                      name="Temperature (°F)"
                      stroke="#f59e0b" 
                      strokeWidth={3}
                      fillOpacity={1} 
                      fill="url(#colorTemp)" 
                      animationDuration={500}
                    />
                  </AreaChart>
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
              The system is connected to Supabase but no data has been received for Sensor {selectedSensor} yet.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}