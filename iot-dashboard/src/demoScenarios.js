// Simulated scenarios for the landing-page demo. Each one is a short "replay" of a few hours
// (or days) of readings with a story: captions that change as events happen, a single insight
// per sensor card, and the same alert emails the real Worker would send. All data is
// deterministic so the demo plays the same way every time and can be tested.

export const DEMO_SENSORS = {
  rooftop: { id: 'rooftop', name: 'Rooftop Unit 1', safeMin: 65, safeMax: 85, color: '#f59e0b' },
  server: { id: 'server', name: 'Server Closet', safeMin: 60, safeMax: 75, color: '#3b82f6' },
  cooler: { id: 'cooler', name: 'Walk-in Cooler', safeMin: 33, safeMax: 45, color: '#10b981' },
};
const SENSOR_ORDER = ['rooftop', 'server', 'cooler'];
const STEP_MINUTES = 5; // The real dashboard's alert check also runs every five minutes.

const wave = (t, period, amplitude, phase = 0) => Math.sin((t / period) * 2 * Math.PI + phase) * amplitude;
const noise = (t, seed) => Math.sin(t * 12.9898 + seed * 78.233) * 0.25;
const round1 = (value) => Math.round(value * 10) / 10;

const normalReading = {
  rooftop: (t) => 75 + wave(t, 20, 3) + noise(t, 1),
  server: (t) => 69 + wave(t, 90, 0.8, 1) + noise(t, 2),
  cooler: (t) => 38 + wave(t, 30, 1.6, 2) + noise(t, 3),
};

export const clockLabel = (startHour, minute) =>
  new Date(2000, 0, 1, startHour, minute).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function minuteSeries(startHour, durationMinutes, readings) {
  const points = [];
  for (let t = 0; t <= durationMinutes; t += STEP_MINUTES) {
    const values = {};
    for (const id of SENSOR_ORDER) values[id] = round1(readings[id](t));
    points.push({ t, label: clockLabel(startHour, t), values });
  }
  return points;
}

const isOutOfRange = (sensor, value) => value > sensor.safeMax || value < sensor.safeMin;

// The same breach / back-to-normal emails the real alert check sends, one per transition.
export function thresholdEmails(points, sensor) {
  const emails = [];
  let triggered = false;
  points.forEach((point, index) => {
    const value = point.values[sensor.id];
    const outside = isOutOfRange(sensor, value);
    if (outside === triggered) return;
    triggered = outside;
    const direction = value > sensor.safeMax ? 'above' : 'below';
    const limit = direction === 'above' ? sensor.safeMax : sensor.safeMin;
    emails.push(outside
      ? { index, kind: 'alert', time: point.label, subject: `Alert: ${sensor.name} is ${direction} threshold`,
        text: `${sensor.name} is reading ${value.toFixed(1)}°F, ${direction} your ${limit}°F threshold.` }
      : { index, kind: 'cleared', time: point.label, subject: `Alert cleared: ${sensor.name}`,
        text: `${sensor.name} is back to ${value.toFixed(1)}°F, within your configured range.` });
  });
  return emails;
}

// Least-squares slope (per step) and intercept over the first `count` values.
export function linearFit(values) {
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, v) => sum + v, 0) / n;
  let num = 0;
  let den = 0;
  values.forEach((v, x) => {
    num += (x - meanX) * (v - meanY);
    den += (x - meanX) ** 2;
  });
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: meanY - slope * meanX };
}

const steady = (text) => ({ text, level: 'ok' });

function normalScenario() {
  const points = minuteSeries(12, 6 * 60, normalReading);
  return {
    key: 'normal',
    label: 'A Normal Day',
    unit: 'live',
    stepMs: 350,
    prefill: 24,
    points,
    chart: { sensors: SENSOR_ORDER, domain: [30, 90], ticks: [30, 45, 60, 75, 90], tickInterval: 11 },
    emails: [],
    captions: [
      { index: 0, text: 'Three sensors on an ordinary afternoon. Each one has its own safe range.' },
      { index: 36, text: 'Every reading stays inside its safe range, so no alerts are sent.' },
      { index: points.length - 1, text: '6 hours, 0 alerts. Nothing needed your attention, and that’s the goal.' },
    ],
    cardInsight: (id) => ({
      rooftop: steady('Cycling normally, about every 20 min.'),
      server: steady('Steady near 69°F all afternoon.'),
      cooler: steady('Holding 36–40°F, well inside its range.'),
    })[id],
  };
}

const DOOR_OPEN = 70; // 2:10 PM
const DOOR_CLOSED = 135; // 3:15 PM
const WARMING_PER_MINUTE = 0.24;

function coolerScenario() {
  const peakRise = (DOOR_CLOSED - DOOR_OPEN) * WARMING_PER_MINUTE;
  const points = minuteSeries(13, 5 * 60, {
    ...normalReading,
    cooler: (t) => {
      if (t < DOOR_OPEN) return normalReading.cooler(t);
      if (t <= DOOR_CLOSED) return 38 + (t - DOOR_OPEN) * WARMING_PER_MINUTE + noise(t, 3);
      const settling = Math.min(1, (t - DOOR_CLOSED) / 120);
      return 38 + peakRise * Math.exp(-(t - DOOR_CLOSED) / 35) + wave(t, 30, 1.6, 2) * settling + noise(t, 3);
    },
  });
  const cooler = DEMO_SENSORS.cooler;
  const emails = thresholdEmails(points, cooler);
  const alert = emails.find((e) => e.kind === 'alert');
  const cleared = emails.find((e) => e.kind === 'cleared');
  const openIndex = DOOR_OPEN / STEP_MINUTES;
  const closedIndex = DOOR_CLOSED / STEP_MINUTES;
  return {
    key: 'cooler',
    label: 'Walk-in Cooler Too Warm',
    unit: 'live',
    stepMs: 350,
    prefill: 12,
    focus: 'cooler',
    points,
    chart: { sensors: ['cooler'], domain: [30, 60], ticks: [30, 35, 40, 45, 50, 55, 60], tickInterval: 11,
      threshold: { value: cooler.safeMax, label: `Safe max ${cooler.safeMax}°F` } },
    markers: [
      { index: openIndex, label: 'Door opened', kind: 'event' },
      { index: alert.index, label: 'Alert email', kind: 'alert' },
      { index: closedIndex, label: 'Door closed', kind: 'event' },
      { index: cleared.index, label: 'All-clear email', kind: 'cleared' },
    ],
    emails,
    captions: [
      { index: 0, text: 'Watch the Walk-in Cooler. It’s holding about 38°F, inside its 33–45°F safe range.' },
      { index: openIndex, text: `${points[openIndex].label}: the cooler door is propped open during a delivery.` },
      { index: alert.index, text: `${alert.time}: the cooler passes 45°F. The next 5-minute check sends an alert email.` },
      { index: closedIndex, text: `${points[closedIndex].label}: someone closes the door, and the cooler starts pulling back down.` },
      { index: cleared.index, text: `${cleared.time}: back under 45°F. A “back to normal” email confirms it’s over.` },
    ],
    cardInsight: (id, index) => {
      if (id === 'rooftop') return steady('Cycling normally, about every 20 min.');
      if (id === 'server') return steady('Steady near 69°F.');
      if (index >= cleared.index) return { text: 'Recovered. Back inside its safe range.', level: 'ok' };
      if (index >= alert.index) return { text: 'Above its 45°F safe max. Alert email sent.', level: 'alert' };
      if (index > openIndex) return { text: 'Warming about 1°F every 5 minutes.', level: 'warn' };
      return steady('Holding about 38°F.');
    },
  };
}

const DRIFT_DAYS = 14;
const DRIFT_PER_DAY = 0.5;
const TREND_FLAG_INDEX = 9;

function driftScenario(today) {
  const points = Array.from({ length: DRIFT_DAYS }, (_, day) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (DRIFT_DAYS - 1 - day));
    return {
      t: day,
      label: date.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      values: {
        rooftop: round1(74 + DRIFT_PER_DAY * day + noise(day, 4) * 1.6),
        server: round1(69 + noise(day, 5)),
        cooler: round1(38 + noise(day, 6)),
      },
    };
  });
  const rooftop = DEMO_SENSORS.rooftop;
  const fitThrough = (index) => linearFit(points.slice(0, index + 1).map((p) => p.values.rooftop));
  const flagged = fitThrough(TREND_FLAG_INDEX);
  const final = fitThrough(DRIFT_DAYS - 1);
  const lastValue = final.intercept + final.slope * (DRIFT_DAYS - 1);
  const daysToLimit = Math.max(1, Math.round((rooftop.safeMax - lastValue) / final.slope));
  // Future days with no readings, so the trend line can be drawn out to where it meets 85°F.
  const projection = Array.from({ length: daysToLimit + 1 }, (_, i) => ({
    label: new Date(today.getFullYear(), today.getMonth(), today.getDate() + i + 1)
      .toLocaleDateString([], { month: 'short', day: 'numeric' }),
  }));
  return {
    key: 'drift',
    label: 'Slow Drift Over 2 Weeks',
    unit: 'daily',
    stepMs: 1100,
    prefill: 3,
    focus: 'rooftop',
    points,
    trend: { sensor: 'rooftop', fromIndex: 5, fit: fitThrough },
    projection,
    chart: { sensors: ['rooftop'], domain: [65, 90], ticks: [65, 70, 75, 80, 85, 90], tickInterval: 2, dots: true,
      threshold: { value: rooftop.safeMax, label: `Safe max ${rooftop.safeMax}°F` } },
    markers: [{ index: TREND_FLAG_INDEX, label: 'Trend flagged', kind: 'alert' }],
    emails: [],
    captions: [
      { index: 0, text: 'Each point is Rooftop Unit 1’s average for one day. Its safe max is 85°F.' },
      { index: 5, text: 'Day 6: still well under 85°F, so a simple threshold alert stays quiet.' },
      { index: TREND_FLAG_INDEX, text: `Day 10: the trend check flags a steady climb of about +${flagged.slope.toFixed(1)}°F per day.` },
      { index: DRIFT_DAYS - 1, text: `Today: at this pace it reaches 85°F in about ${daysToLimit} days. Book a service visit now, not an emergency repair later.` },
    ],
    cardInsight: (id, index) => {
      if (id !== 'rooftop') return steady('Daily average steady.');
      if (index >= TREND_FLAG_INDEX) {
        return { text: `Daily average up ~${fitThrough(index).slope.toFixed(1)}°F/day for ${index + 1} days.`, level: 'warn' };
      }
      return steady('Within its safe range.');
    },
  };
}

export function buildScenarios(today = new Date()) {
  return [normalScenario(), coolerScenario(), driftScenario(today)];
}

export function captionAt(scenario, index) {
  let current = scenario.captions[0];
  for (const caption of scenario.captions) if (caption.index <= index) current = caption;
  return current.text;
}

// 'alert' when out of range, otherwise the card insight's level ('ok' or 'warn').
export function cardState(scenario, sensorId, index) {
  const value = scenario.points[index].values[sensorId];
  const insight = scenario.cardInsight(sensorId, index);
  const level = isOutOfRange(DEMO_SENSORS[sensorId], value) ? 'alert' : insight.level === 'alert' ? 'warn' : insight.level;
  return { value, insight, level };
}

// Chart rows covering the whole timeline; readings not yet "played" are null so the line
// grows from left to right while the axes stay fixed.
export function chartRows(scenario, index) {
  const fit = scenario.trend && index >= scenario.trend.fromIndex ? scenario.trend.fit(index) : null;
  const future = scenario.projection ?? [];
  return [...scenario.points, ...future].map((point, i) => {
    const row = { label: point.label };
    for (const id of scenario.chart.sensors) row[id] = i <= index && point.values ? point.values[id] : null;
    // The projection past today only appears once the replay reaches today.
    if (fit && (i < scenario.points.length || index === scenario.points.length - 1)) {
      row.trend = round1(fit.intercept + fit.slope * i);
    }
    return row;
  });
}
