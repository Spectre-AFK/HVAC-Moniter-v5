import { describe, it, expect } from 'vitest';
import { detectHvacPatterns } from './cycleDetection';

const TEN_MIN_MS = 10 * 60 * 1000;

// Builds readingsDesc (newest-first) from an oldest-to-newest array of temperatures, spaced
// stepMs apart ending at `now` — same helper shape as anomalyDetection.test.js.
function readings(tempsAsc, { stepMs = TEN_MIN_MS, now = Date.now() } = {}) {
  const ascWithTimestamps = tempsAsc.map((tempF, i) => ({
    timestamp: new Date(now - (tempsAsc.length - 1 - i) * stepMs).toISOString(),
    tempF,
  }));
  return ascWithTimestamps.slice().reverse();
}

// Repeats a [down, up] sawtooth cycle of the given amplitude `count` times, each half taking
// `halfCycleSteps` readings, e.g. buildCycles(2, 3, 80) -> a temp series cycling +/-2F every ~3 readings.
function buildCycles(amplitude, halfCycleSteps, count, baseline = 80) {
  const tempsAsc = [];
  let current = baseline;
  for (let c = 0; c < count; c++) {
    for (let i = 0; i < halfCycleSteps; i++) {
      current -= amplitude / halfCycleSteps;
      tempsAsc.push(current);
    }
    for (let i = 0; i < halfCycleSteps; i++) {
      current += amplitude / halfCycleSteps;
      tempsAsc.push(current);
    }
  }
  return tempsAsc;
}

describe('detectHvacPatterns — edge cases', () => {
  it('returns no flags for an empty sensor list', () => {
    expect(detectHvacPatterns([])).toEqual([]);
  });

  it('returns no flags when there are too few readings', () => {
    const flags = detectHvacPatterns([
      { key: 's1', label: 'Sensor 1', readingsDesc: readings(buildCycles(2, 2, 3)) },
    ]);
    expect(flags).toEqual([]);
  });

  it('returns no flags for a flat, non-cycling series', () => {
    const flags = detectHvacPatterns([
      { key: 's1', label: 'Sensor 1', readingsDesc: readings(new Array(40).fill(75)) },
    ]);
    expect(flags).toEqual([]);
  });
});

describe('detectHvacPatterns — normal cycling', () => {
  it('reports cycle-info (not short-cycle) for a normal-length duty cycle', () => {
    // 6 readings per half-cycle at 10 min/reading = 60 min on, 60 min off = 120 min full cycle.
    const tempsAsc = buildCycles(2, 6, 8);
    const flags = detectHvacPatterns([{ key: 's1', label: 'Sensor 1', readingsDesc: readings(tempsAsc) }]);

    const cycleInfo = flags.find((f) => f.type === 'cycle-info');
    expect(cycleInfo).toBeTruthy();
    expect(flags.find((f) => f.type === 'short-cycle')).toBeFalsy();
  });
});

describe('detectHvacPatterns — short-cycling', () => {
  it('flags short-cycle when the full on/off cycle is very short', () => {
    // 1 reading per half-cycle at 3 min/reading = 3 min on, 3 min off = 6 min full cycle,
    // well under the 12-minute-average threshold once several cycles are averaged.
    const tempsAsc = buildCycles(2, 1, 10);
    const flags = detectHvacPatterns([
      { key: 's1', label: 'Sensor 1', readingsDesc: readings(tempsAsc, { stepMs: 3 * 60 * 1000 }) },
    ]);

    const shortCycle = flags.find((f) => f.type === 'short-cycle');
    expect(shortCycle).toBeTruthy();
    expect(shortCycle.message).toMatch(/short-cycling/);
  });
});

describe('detectHvacPatterns — setback event', () => {
  it('flags a large sustained drop as a setback distinct from routine cycling', () => {
    // A handful of normal small cycles (~2F swings), then one much larger sustained drop.
    const routineCycles = buildCycles(2, 6, 5, 80);
    const lastTemp = routineCycles[routineCycles.length - 1];
    const bigDrop = Array.from({ length: 12 }, (_, i) => lastTemp - (i + 1) * 0.8); // ~10F drop over 12 readings
    const moreRoutineCycles = buildCycles(2, 6, 3, bigDrop[bigDrop.length - 1] + 2);

    const tempsAsc = [...routineCycles, ...bigDrop, ...moreRoutineCycles];
    const flags = detectHvacPatterns([{ key: 's1', label: 'Sensor 1', readingsDesc: readings(tempsAsc) }]);

    const setback = flags.find((f) => f.type === 'setback');
    expect(setback).toBeTruthy();
    expect(setback.message).toMatch(/manual setpoint change/);
  });
});
