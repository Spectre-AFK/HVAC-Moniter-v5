import { describe, expect, it } from 'vitest';
import { DEMO_SENSORS, buildScenarios, captionAt, cardState, chartRows, linearFit, thresholdEmails } from './demoScenarios';

const scenarios = buildScenarios(new Date(2026, 10, 8));
const byKey = Object.fromEntries(scenarios.map((s) => [s.key, s]));

describe('landing demo scenarios', () => {
  it('keeps every reading in range on a normal day and sends no email', () => {
    const normal = byKey.normal;
    for (const point of normal.points) {
      for (const sensor of Object.values(DEMO_SENSORS)) {
        expect(point.values[sensor.id]).toBeGreaterThanOrEqual(sensor.safeMin);
        expect(point.values[sensor.id]).toBeLessThanOrEqual(sensor.safeMax);
      }
    }
    expect(normal.emails).toEqual([]);
  });

  it('tells the cooler story in order: door opens, alert, door closes, all-clear', () => {
    const cooler = byKey.cooler;
    expect(cooler.points[cooler.prefill - 1].values.cooler).toBeLessThan(45);
    expect(cooler.emails.map((e) => e.kind)).toEqual(['alert', 'cleared']);
    const order = cooler.markers.map((m) => m.index);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const [alert, cleared] = cooler.emails;
    expect(cooler.points[alert.index].values.cooler).toBeGreaterThan(45);
    expect(alert.subject).toBe('Alert: Walk-in Cooler is above threshold');
    expect(cleared.subject).toBe('Alert cleared: Walk-in Cooler');
    expect(cardState(cooler, 'cooler', alert.index).level).toBe('alert');
    expect(cardState(cooler, 'cooler', cleared.index).level).toBe('ok');
    expect(captionAt(cooler, alert.index)).toContain('alert email');
  });

  it('flags drift without ever crossing the threshold', () => {
    const drift = byKey.drift;
    expect(drift.points).toHaveLength(14);
    expect(Math.max(...drift.points.map((p) => p.values.rooftop))).toBeLessThan(85);
    expect(thresholdEmails(drift.points, DEMO_SENSORS.rooftop)).toEqual([]);
    expect(cardState(drift, 'rooftop', 2).level).toBe('ok');
    expect(cardState(drift, 'rooftop', 13).level).toBe('warn');
    expect(drift.points.at(-1).label).toBe(new Date(2026, 10, 8).toLocaleDateString([], { month: 'short', day: 'numeric' }));
  });

  it('hides readings not yet played but keeps the full time axis', () => {
    const cooler = byKey.cooler;
    const rows = chartRows(cooler, 5);
    expect(rows).toHaveLength(cooler.points.length);
    expect(rows[5].cooler).not.toBeNull();
    expect(rows[6].cooler).toBeNull();
    expect(rows.at(-1).label).toBe(cooler.points.at(-1).label);
  });

  it('fits a straight line', () => {
    const { slope, intercept } = linearFit([1, 3, 5, 7]);
    expect(slope).toBeCloseTo(2);
    expect(intercept).toBeCloseTo(1);
  });
});
