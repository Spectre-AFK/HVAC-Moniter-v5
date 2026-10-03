import { describe, expect, it } from 'vitest';
import { buildDashboard, sensorStaleness } from './dashboard';
import { convertCtoF } from './sensors';

const now = Date.parse('2026-10-02T06:00:00Z');
const row = (device_id, sensor_index, temperature_c, minutesAgo = 0) => ({
  device_id, sensor_index, temperature_c, timestamp: new Date(now - minutesAgo * 60_000).toISOString(),
});
describe('dashboard data model', () => {
  it.each([null, undefined, '', true, 'invalid', Infinity])('rejects invalid temperature %s instead of converting it to a plausible reading', (value) => {
    expect(() => convertCtoF(value)).toThrow('finite Celsius');
  });
  it('separates repeated sensor indices on different devices and preserves alignment', () => {
    const dashboard = buildDashboard([row('a', 0, 20), row('b', 0, 30), row('a', 0, 10, 10)], {});
    expect(dashboard.uniqueSensorKeys).toEqual(['a_0', 'b_0']);
    expect(dashboard.perSensor[0]).toMatchObject({ latestTempF: 68, min: 50, max: 68, avg: 59 });
    expect(dashboard.chartData.at(-1)).toMatchObject({ a_0: 68, b_0: 86 });
    expect(dashboard.chartData[0].b_0).toBeUndefined();
  });
  it('allows a thirty-minute grace period before cadence can be learned', () => {
    const dashboard = buildDashboard([row('a', 0, 20)], {});
    expect(sensorStaleness(dashboard, true, now + 30 * 60_000).a_0.isStale).toBe(false);
    expect(sensorStaleness(dashboard, true, now + 30 * 60_000 + 1).a_0.isStale).toBe(true);
  });
  it('uses per-sensor cadence and ignores duplicate timestamps', () => {
    const dashboard = buildDashboard([row('a', 0, 20), row('a', 0, 20), row('a', 0, 20, 10)], {});
    expect(sensorStaleness(dashboard, true, now + 20 * 60_000).a_0.isStale).toBe(false);
    expect(sensorStaleness(dashboard, true, now + 25 * 60_000 + 1).a_0.isStale).toBe(true);
    expect(sensorStaleness(dashboard, false, now)).toEqual({});
  });
});
