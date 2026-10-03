import { describe, it, expect } from 'vitest';
import { detectAnomalies } from './anomalyDetection';

const TEN_MIN_MS = 10 * 60 * 1000;

// Builds readingsDesc (newest-first, as detectAnomalies requires) from an oldest-to-newest
// array of temperatures, spaced `stepMs` apart ending at `now`.
function readings(tempsAsc, { stepMs = TEN_MIN_MS, now = Date.now() } = {}) {
  const ascWithTimestamps = tempsAsc.map((tempF, i) => ({
    timestamp: new Date(now - (tempsAsc.length - 1 - i) * stepMs).toISOString(),
    tempF,
  }));
  return ascWithTimestamps.slice().reverse();
}

function repeat(value, count) {
  return new Array(count).fill(value);
}

describe('detectAnomalies — edge cases', () => {
  it('returns no flags for an empty sensor list', () => {
    expect(detectAnomalies([])).toEqual([]);
  });

  it('returns no flags when a sensor has no readings', () => {
    const flags = detectAnomalies([{ key: 's1', label: 'Sensor 1', readingsDesc: [] }]);
    expect(flags).toEqual([]);
  });

  it('returns no flags for a single reading (below MIN_READINGS_FOR_STATS)', () => {
    const flags = detectAnomalies([
      { key: 's1', label: 'Sensor 1', readingsDesc: readings([70]) },
    ]);
    expect(flags).toEqual([]);
  });

  it('does not crash or flag with fewer than 10 readings even if constant (not enough for flatline)', () => {
    const flags = detectAnomalies([
      { key: 's1', label: 'Sensor 1', readingsDesc: readings(repeat(70, 9)) },
    ]);
    expect(flags).toEqual([]);
  });

  it('produces no flags for steady, unremarkable readings at exactly the stats threshold', () => {
    const flags = detectAnomalies([
      { key: 's1', label: 'Sensor 1', readingsDesc: readings([70, 70.1, 69.9, 70, 70.1, 69.9, 70, 70.1, 69.9, 70]) },
    ]);
    expect(flags).toEqual([]);
  });

  it('does not throw NaN-producing errors when all timestamps are identical (zero time span)', () => {
    const now = Date.now();
    const sameTimestampReadings = repeat(70, 20).map((tempF) => ({ timestamp: new Date(now).toISOString(), tempF }));
    const flags = detectAnomalies([{ key: 's1', label: 'Sensor 1', readingsDesc: sameTimestampReadings }]);
    for (const flag of flags) {
      expect(flag.message).not.toMatch(/NaN/);
    }
  });
});

describe('detectAnomalies — z-score outliers', () => {
  it('flags a single reading that is far outside the recent average', () => {
    const tempsAsc = [...repeat(70, 19), 85]; // 19 steady readings, then a sudden jump
    const flags = detectAnomalies([{ key: 's1', label: 'Sensor 1', readingsDesc: readings(tempsAsc) }]);
    const zscoreFlags = flags.filter((f) => f.type === 'zscore');
    expect(zscoreFlags).toHaveLength(1);
    expect(zscoreFlags[0].key).toBe('s1');
    expect(zscoreFlags[0].message).toMatch(/85\.0.?F/);
  });

  it('does not flag readings that stay within normal statistical variance', () => {
    const tempsAsc = [70, 70.5, 69.8, 70.2, 69.9, 70.3, 70.1, 69.7, 70.4, 70.0, 69.9, 70.2];
    const flags = detectAnomalies([{ key: 's1', label: 'Sensor 1', readingsDesc: readings(tempsAsc) }]);
    expect(flags.filter((f) => f.type === 'zscore')).toHaveLength(0);
  });
});

describe('detectAnomalies — trends', () => {
  it('detects a six-point short trend without requiring ten z-score samples', () => {
    const flags = detectAnomalies([{ key: 's1', label: 'Test', readingsDesc: readings([65, 66, 67, 68, 69, 70]) }]);
    expect(flags.some(f => f.type === 'trend-short')).toBe(true);
    expect(flags.some(f => f.type === 'zscore')).toBe(false);
  });
  it('flags a rising short-term trend', () => {
    // +0.3F every 10 minutes = 1.8F/hour, above the 1.5F/hour short-term threshold.
    const tempsAsc = Array.from({ length: 20 }, (_, i) => 65 + i * 0.3);
    const flags = detectAnomalies([{ key: 's1', label: 'Sensor 1', readingsDesc: readings(tempsAsc) }]);
    const trendFlags = flags.filter((f) => f.type === 'trend-short');
    expect(trendFlags).toHaveLength(1);
    expect(trendFlags[0].message).toMatch(/trending up/);
  });

  it('flags a falling short-term trend', () => {
    const tempsAsc = Array.from({ length: 20 }, (_, i) => 80 - i * 0.3);
    const flags = detectAnomalies([{ key: 's1', label: 'Sensor 1', readingsDesc: readings(tempsAsc) }]);
    const trendFlags = flags.filter((f) => f.type === 'trend-short');
    expect(trendFlags).toHaveLength(1);
    expect(trendFlags[0].message).toMatch(/trending down/);
  });

  it('flags a slow long-term drift that a short window would miss', () => {
    // +0.5F/hour steady drift over ~83 hours (500 readings, 10 min apart).
    const tempsAsc = Array.from({ length: 500 }, (_, i) => 65 + i * (0.5 / 6));
    const flags = detectAnomalies([{ key: 's1', label: 'Sensor 1', readingsDesc: readings(tempsAsc) }]);
    expect(flags.some((f) => f.type === 'trend-long')).toBe(true);
  });

  it('does not flag a long-term trend below MIN points for that check', () => {
    // Only 50 readings — below LONG_TREND_MIN_POINTS (100), so trend-long should never appear.
    const tempsAsc = Array.from({ length: 50 }, (_, i) => 65 + i * (0.5 / 6));
    const flags = detectAnomalies([{ key: 's1', label: 'Sensor 1', readingsDesc: readings(tempsAsc) }]);
    expect(flags.some((f) => f.type === 'trend-long')).toBe(false);
  });
});

describe('detectAnomalies — flatline', () => {
  it('flags a sensor stuck at an unchanging value', () => {
    const flags = detectAnomalies([{ key: 's1', label: 'Sensor 1', readingsDesc: readings(repeat(72, 20)) }]);
    expect(flags).toHaveLength(1);
    expect(flags[0].type).toBe('flatline');
    expect(flags[0].severity).toBe('medium');
  });

  it('does not flag a sensor with normal minor fluctuation as flatline', () => {
    const tempsAsc = [70, 70.5, 69.8, 70.2, 69.9, 70.3, 70.1, 69.7, 70.4, 70.0, 69.9, 70.2, 70.1, 69.8, 70.3];
    const flags = detectAnomalies([{ key: 's1', label: 'Sensor 1', readingsDesc: readings(tempsAsc) }]);
    expect(flags.filter((f) => f.type === 'flatline')).toHaveLength(0);
  });
});

describe('detectAnomalies — multiple sensors', () => {
  it('only flags the sensor(s) that are actually anomalous, keyed correctly', () => {
    const flatlineSensor = { key: 'devA-0', label: 'Sensor A', readingsDesc: readings(repeat(72, 20)) };
    const normalSensor = {
      key: 'devB-0',
      label: 'Sensor B',
      readingsDesc: readings([70, 70.5, 69.8, 70.2, 69.9, 70.3, 70.1, 69.7, 70.4, 70.0, 69.9, 70.2]),
    };
    const flags = detectAnomalies([flatlineSensor, normalSensor]);
    expect(flags.every((f) => f.key === 'devA-0')).toBe(true);
    expect(flags.length).toBeGreaterThan(0);
  });
});
