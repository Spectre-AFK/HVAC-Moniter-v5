import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Inbox, Mail, Pause, Play, RotateCcw, TrendingUp } from 'lucide-react';
import { DEMO_SENSORS, buildScenarios, captionAt, cardState, chartRows } from './demoScenarios';

const DemoChart = lazy(() => import('./DemoChart'));

const LEVEL_STYLES = {
  ok: {
    card: 'bg-white border-slate-200 dark:bg-slate-900 dark:border-slate-800',
    value: 'text-emerald-600 dark:text-emerald-400',
    badge: 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/50 dark:border-emerald-900 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    icon: 'text-emerald-500',
    label: 'IN RANGE',
  },
  warn: {
    card: 'bg-amber-50 border-amber-300 dark:bg-amber-950/30 dark:border-amber-800',
    value: 'text-amber-600 dark:text-amber-400',
    badge: 'bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-300',
    dot: 'bg-amber-500',
    icon: 'text-amber-500',
    label: 'WATCH',
  },
  alert: {
    card: 'bg-red-50 border-red-300 ring-2 ring-red-400/50 dark:bg-red-950/40 dark:border-red-800 dark:ring-red-500/40',
    value: 'text-red-600 dark:text-red-400',
    badge: 'bg-red-100 border-red-300 text-red-700 dark:bg-red-950/60 dark:border-red-800 dark:text-red-300',
    dot: 'bg-red-500',
    icon: 'text-red-500',
    label: 'OUT OF RANGE',
  },
};

const CAPTION_PAUSE_MS = 2200;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

function DemoSensorCard({ sensor, state, isFocus, unit, time }) {
  const style = LEVEL_STYLES[state.level];
  const InsightIcon = state.level === 'alert' ? AlertTriangle : state.level === 'warn' ? TrendingUp : Activity;
  return (
    <div className={`rounded-2xl border shadow-sm p-4 sm:p-5 transition-colors ${style.card}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: sensor.color }} />
          <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">{sensor.name}</span>
        </div>
        <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-semibold shrink-0 ${style.badge}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
          {style.label}
        </span>
      </div>
      <div className="mt-2 sm:mt-3 flex items-baseline justify-between gap-3 sm:block">
        <div className="flex items-baseline gap-1">
          <span className={`text-3xl sm:text-4xl font-extrabold tracking-tight tabular-nums ${style.value}`}>{state.value.toFixed(1)}°</span>
          <span className="text-base font-bold text-slate-400 dark:text-slate-500">F</span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 sm:mt-1">
          Safe {sensor.safeMin}–{sensor.safeMax}°F
          <span className="hidden sm:inline"> · {unit === 'daily' ? `Daily avg, ${time}` : `Reading at ${time}`}</span>
        </p>
      </div>
      {/* Same one-insight-per-card layout as the real dashboard; on phones only the sensor in the story keeps it. */}
      <p className={`${isFocus ? 'flex' : 'hidden sm:flex'} mt-3 pt-3 border-t border-slate-200/70 dark:border-slate-700/60 items-start gap-1.5 text-xs text-slate-600 dark:text-slate-300`}>
        <InsightIcon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${style.icon}`} />
        <span>{state.insight.text}</span>
      </p>
    </div>
  );
}

function EmailPreview({ email }) {
  const isAlert = email.kind === 'alert';
  return (
    <li className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-950">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800/70 text-xs text-slate-500 dark:text-slate-400">
        <span className="truncate">From alerts@checkmytemp.com</span>
        <span className="shrink-0">{email.time}</span>
      </div>
      <div className="p-3">
        <p className="font-semibold text-sm text-slate-900 dark:text-slate-100">{email.subject}</p>
        <p className={`mt-1 text-xs font-semibold ${isAlert ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
          {isAlert ? 'Threshold breached' : 'Back to normal'}
        </p>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{email.text}</p>
      </div>
    </li>
  );
}

export default function LiveDemo({ isDark }) {
  const scenarios = useMemo(() => buildScenarios(new Date()), []);
  const [reducedMotion] = useState(prefersReducedMotion);
  const [scenarioKey, setScenarioKey] = useState(scenarios[0].key);
  const scenario = scenarios.find((s) => s.key === scenarioKey) ?? scenarios[0];
  const lastIndex = scenario.points.length - 1;
  const startIndex = reducedMotion ? lastIndex : scenario.prefill - 1;
  const [position, setPosition] = useState(startIndex);
  const [playing, setPlaying] = useState(!reducedMotion);
  const [inView, setInView] = useState(false);
  const [chartRequested, setChartRequested] = useState(false);
  const sectionRef = useRef(null);
  const finished = position >= lastIndex;
  const isPlaying = playing && !finished;

  // Plays only while the demo is on screen, so visitors see the story from its start.
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setInView(entry.isIntersecting);
      if (entry.isIntersecting) setChartRequested(true);
    }, { rootMargin: '0px 0px -20% 0px' });
    observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  // Lingers on each new caption so there's time to read it before the replay moves on.
  const captionIndexes = useMemo(() => new Set(scenario.captions.map((c) => c.index)), [scenario]);
  useEffect(() => {
    if (!isPlaying || !inView) return undefined;
    const delay = scenario.stepMs + (captionIndexes.has(position) ? CAPTION_PAUSE_MS : 0);
    const timer = setTimeout(() => setPosition((p) => Math.min(p + 1, lastIndex)), delay);
    return () => clearTimeout(timer);
  }, [isPlaying, inView, position, lastIndex, scenario.stepMs, captionIndexes]);

  const selectScenario = (key) => {
    const next = scenarios.find((s) => s.key === key);
    setScenarioKey(key);
    setPosition(reducedMotion ? next.points.length - 1 : next.prefill - 1);
    setPlaying(!reducedMotion);
  };
  const replay = () => {
    setPosition(scenario.prefill - 1);
    setPlaying(true);
  };

  const rows = useMemo(() => chartRows(scenario, position), [scenario, position]);
  const caption = captionAt(scenario, position);
  const sentEmails = scenario.emails.filter((email) => email.index <= position).reverse();
  const visibleMarkers = (scenario.markers ?? []).filter((marker) => marker.index <= position);
  const current = scenario.points[position];
  const progress = (position / lastIndex) * 100;
  const timeSpan = scenario.unit === 'daily'
    ? `${scenario.points.length} days of daily averages`
    : `${Math.round((scenario.points.length - 1) * 5 / 60)} hours of readings`;

  return (
    <div ref={sectionRef} className="space-y-4 sm:space-y-6">
      <div role="group" aria-label="Demo examples" className="flex flex-wrap items-center justify-center gap-2">
        {scenarios.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => selectScenario(s.key)}
            aria-pressed={s.key === scenarioKey}
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

      {/* Story bar: what to watch right now, plus replay controls */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={finished ? replay : () => setPlaying((p) => !p)}
            aria-label={finished ? 'Replay example' : isPlaying ? 'Pause example' : 'Play example'}
            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center bg-slate-900 text-white dark:bg-amber-500 dark:text-slate-900 hover:opacity-90 transition-opacity"
          >
            {finished ? <RotateCcw className="w-4 h-4" /> : isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Replaying {timeSpan} · now showing <span className="tabular-nums">{current.label}</span>
            </p>
            <p aria-live="polite" className="mt-1 font-semibold text-slate-900 dark:text-slate-100">{caption}</p>
          </div>
        </div>
        <div className="mt-4 relative h-1.5 rounded-full bg-slate-200 dark:bg-slate-800" aria-hidden="true">
          <div className="absolute inset-y-0 left-0 rounded-full bg-amber-500 transition-[width] duration-300" style={{ width: `${progress}%` }} />
          {(scenario.markers ?? []).map((marker) => (
            <span
              key={marker.label}
              title={marker.label}
              className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-slate-900 ${
                marker.kind === 'alert' ? 'bg-red-500' : marker.kind === 'cleared' ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
              style={{ left: `${(marker.index / lastIndex) * 100}%` }}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-6">
        {Object.values(DEMO_SENSORS).map((sensor) => (
          <DemoSensorCard
            key={sensor.id}
            sensor={sensor}
            state={cardState(scenario, sensor.id, position)}
            isFocus={!scenario.focus || scenario.focus === sensor.id}
            unit={scenario.unit}
            time={current.label}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            {scenario.unit === 'daily' ? 'Daily Average Trend' : 'Temperature Trend'}
          </h3>
          <div className="h-64 sm:h-72 w-full mt-2">
            {chartRequested ? (
              <Suspense fallback={<div className="h-full rounded-xl bg-slate-100 dark:bg-slate-800/60 animate-pulse" />}>
                <DemoChart rows={rows} chart={scenario.chart} markers={visibleMarkers} focus={scenario.focus}
                  hasTrend={Boolean(scenario.trend) && position >= scenario.trend.fromIndex} isDark={isDark} />
              </Suspense>
            ) : (
              <div className="h-full rounded-xl bg-slate-100 dark:bg-slate-800/60" />
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
          <h3 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Inbox className="w-4 h-4 text-amber-500" />
            Your Inbox
          </h3>
          {sentEmails.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {sentEmails.map((email) => <EmailPreview key={email.index} email={email} />)}
            </ul>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-sm text-slate-500 dark:text-slate-400 flex gap-2">
              {scenario.unit === 'daily' ? (
                <>
                  <TrendingUp className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                  <span>No emails, since nothing crossed a threshold. The slow climb shows up as an insight on the sensor’s dashboard card instead.</span>
                </>
              ) : scenario.emails.length === 0 ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-500" />
                  <span>No emails. You only hear from us when a reading crosses a threshold you set.</span>
                </>
              ) : (
                <>
                  <Mail className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>Nothing yet. Alert emails will show up here as they’re sent.</span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
