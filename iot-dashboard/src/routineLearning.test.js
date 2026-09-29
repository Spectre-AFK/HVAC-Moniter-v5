import { describe, it, expect } from 'vitest';
import { buildRoutineProfile, detectRoutineDeviations } from './routineLearning';

// Builds an ISO timestamp for `daysAgo` days before `now`, at the given local hour:minute.
function eventAt(now, daysAgo, hour, minute) {
  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return { occurred_at: d.toISOString() };
}

// Finds the most recent past date (inclusive of today) that falls on `weekday` (0=Sun..6=Sat).
function daysAgoForWeekday(now, weekday) {
  const diff = (now.getDay() - weekday + 7) % 7;
  return diff;
}

describe('buildRoutineProfile', () => {
  it('ignores weekdays with too few samples', () => {
    const now = new Date();
    const events = [eventAt(now, 7, 17, 45), eventAt(now, 14, 17, 50)];
    expect(buildRoutineProfile(events)).toEqual({});
  });

  it('learns a weekday median once enough samples exist', () => {
    const now = new Date();
    const weekday = now.getDay();
    const base = daysAgoForWeekday(now, weekday) + 7; // start a full week back to avoid "today"
    const events = [
      eventAt(now, base, 17, 40),
      eventAt(now, base + 7, 17, 45),
      eventAt(now, base + 14, 17, 50),
      eventAt(now, base + 21, 17, 45),
    ];
    const profile = buildRoutineProfile(events);
    expect(profile[weekday]).toBeTruthy();
    expect(profile[weekday].sampleCount).toBe(4);
    expect(profile[weekday].medianMinutes).toBeCloseTo(17 * 60 + 45, 0);
  });
});

describe('detectRoutineDeviations', () => {
  it('returns no flags when there is no learned profile for today', () => {
    const now = new Date();
    expect(detectRoutineDeviations([], 'Desk Sensor', now)).toEqual([]);
  });

  it('flags routine-established when today matches the learned pattern', () => {
    const now = new Date('2026-09-29T17:46:00'); // a Tuesday
    const weekday = now.getDay();
    const base = daysAgoForWeekday(now, weekday) + 7;
    const history = [
      eventAt(now, base, 17, 40),
      eventAt(now, base + 7, 17, 45),
      eventAt(now, base + 14, 17, 50),
    ];
    const todayEvent = eventAt(now, 0, 17, 44);
    const flags = detectRoutineDeviations([...history, todayEvent], 'Desk Sensor', now);
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe('routine-established');
  });

  it('flags routine-deviation when today is far off the learned pattern', () => {
    const now = new Date('2026-09-29T20:00:00'); // a Tuesday
    const weekday = now.getDay();
    const base = daysAgoForWeekday(now, weekday) + 7;
    const history = [
      eventAt(now, base, 17, 40),
      eventAt(now, base + 7, 17, 45),
      eventAt(now, base + 14, 17, 50),
    ];
    const todayEvent = eventAt(now, 0, 19, 55); // ~2 hours later than usual
    const flags = detectRoutineDeviations([...history, todayEvent], 'Desk Sensor', now);
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe('routine-deviation');
    expect(flags[0].message).toMatch(/later than usual/);
  });

  it('flags routine-missing once well past the usual time with no event today', () => {
    const now = new Date('2026-09-29T20:00:00'); // a Tuesday, ~2h15m after the usual 17:45
    const weekday = now.getDay();
    const base = daysAgoForWeekday(now, weekday) + 7;
    const history = [
      eventAt(now, base, 17, 40),
      eventAt(now, base + 7, 17, 45),
      eventAt(now, base + 14, 17, 50),
      eventAt(now, base + 21, 17, 45),
    ];
    const flags = detectRoutineDeviations(history, 'Desk Sensor', now);
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe('routine-missing');
  });
});
