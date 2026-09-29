// Lightweight "routine learning" — median/MAD time-of-day per weekday from HVAC events already
// detected by cycleDetection.js and logged to Supabase by worker/index.js's cron. Still plain
// statistics, not a model: this learns "what time does this usually happen" per weekday from
// history, then flags today's occurrence (or a still-missing one) as a deviation from that.

// A weekday's pattern is only "learned" once it has this many past occurrences — otherwise
// there isn't enough history to call anything a routine yet.
const MIN_SAMPLES_PER_WEEKDAY = 4;
// Minimum deviation (in minutes) worth flagging, even if the learned spread (MAD) is tiny.
const DEVIATION_MIN_MINUTES = 30;
// How long past the usual time to wait before flagging a still-missing occurrence, on top of
// whatever the learned spread already implies.
const MISSING_EVENT_GRACE_MINUTES = 60;

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function formatMinutesOfDay(minutes) {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(wrapped / 60);
  const displayHour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  return `${displayHour}:${String(Math.round(wrapped % 60)).padStart(2, '0')} ${period}`;
}

/**
 * @param {{ occurred_at: string }[]} events - past events for one sensor, of one event_type, any order.
 * @returns {Record<number, { medianMinutes: number, madMinutes: number, sampleCount: number }>}
 *   Keyed by JS Date#getDay() (0 = Sunday). Only includes weekdays with enough samples.
 */
export function buildRoutineProfile(events) {
  const minutesByWeekday = new Map();
  for (const event of events) {
    const date = new Date(event.occurred_at);
    const weekday = date.getDay();
    if (!minutesByWeekday.has(weekday)) minutesByWeekday.set(weekday, []);
    minutesByWeekday.get(weekday).push(minutesSinceMidnight(date));
  }

  const profile = {};
  for (const [weekday, minutesList] of minutesByWeekday) {
    if (minutesList.length < MIN_SAMPLES_PER_WEEKDAY) continue;
    const medianMinutes = median(minutesList);
    const madMinutes = median(minutesList.map((m) => Math.abs(m - medianMinutes)));
    profile[weekday] = { medianMinutes, madMinutes, sampleCount: minutesList.length };
  }
  return profile;
}

/**
 * Compares today's already-logged events against the learned weekday profile, and flags
 * either a large deviation from the usual time, the routine being on track, or an occurrence
 * that's still missing once enough time has passed that one would normally have happened.
 *
 * @param {{ occurred_at: string }[]} events - past events for one sensor, of one event_type.
 * @param {string} label - sensor label used in the message.
 * @param {Date} [now] - injectable for testing; defaults to the current time.
 * @returns {Array<{ type: 'routine-established'|'routine-deviation'|'routine-missing', severity: 'low'|'medium', message: string }>}
 */
export function detectRoutineDeviations(events, label, now = new Date()) {
  const profile = buildRoutineProfile(events);
  const weekday = now.getDay();
  const today = profile[weekday];
  if (!today) return [];

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const todaysEvents = events.filter((e) => new Date(e.occurred_at) >= startOfToday);
  const deviationThreshold = Math.max(DEVIATION_MIN_MINUTES, today.madMinutes * 2);
  const weekdayName = WEEKDAY_NAMES[weekday];

  if (todaysEvents.length > 0) {
    const latestToday = todaysEvents.reduce((a, b) => (new Date(a.occurred_at) > new Date(b.occurred_at) ? a : b));
    const actualMinutes = minutesSinceMidnight(new Date(latestToday.occurred_at));
    const deviationMinutes = actualMinutes - today.medianMinutes;

    if (Math.abs(deviationMinutes) >= deviationThreshold) {
      return [
        {
          type: 'routine-deviation',
          severity: 'medium',
          message: `${label} usually gets a setback around ${formatMinutesOfDay(today.medianMinutes)} on ${weekdayName}s (from ${today.sampleCount} past occurrences) — today's happened ${Math.abs(Math.round(deviationMinutes))} min ${deviationMinutes > 0 ? 'later' : 'earlier'} than usual.`,
        },
      ];
    }

    return [
      {
        type: 'routine-established',
        severity: 'low',
        message: `${label} is on its usual ${weekdayName} routine — a setback around ${formatMinutesOfDay(today.medianMinutes)}, based on ${today.sampleCount} past occurrences.`,
      },
    ];
  }

  const minutesNow = minutesSinceMidnight(now);
  if (minutesNow >= today.medianMinutes + Math.max(MISSING_EVENT_GRACE_MINUTES, deviationThreshold)) {
    return [
      {
        type: 'routine-missing',
        severity: 'medium',
        message: `${label} usually gets a setback around ${formatMinutesOfDay(today.medianMinutes)} on ${weekdayName}s (from ${today.sampleCount} past occurrences), but none has been detected yet today.`,
      },
    ];
  }

  return [];
}
