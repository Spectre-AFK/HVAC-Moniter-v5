// Plain-statistics anomaly detection for sensor temperature readings.
// Intentionally no ML/AI here — just z-score, linear trend, and flatline checks,
// so results are deterministic and free to compute on every render.

const MIN_READINGS_FOR_STATS = 6;
const Z_SCORE_THRESHOLD = 3;

// Recent, short-window trend — catches a change happening right now.
const SHORT_TREND_MIN_POINTS = 6;
const SHORT_TREND_MAX_POINTS = 24;
const SHORT_TREND_SLOPE_THRESHOLD_F_PER_HOUR = 0.75;

// Longer-window trend — catches slow multi-day drift a short window would smooth away.
// Threshold is much lower per-hour since it only needs to add up over many hours.
const LONG_TREND_MIN_POINTS = 100;
const LONG_TREND_MAX_POINTS = 1000;
const LONG_TREND_SLOPE_THRESHOLD_F_PER_HOUR = 0.08;

const FLATLINE_MIN_POINTS = 10;
const FLATLINE_STDDEV_THRESHOLD = 0.05;

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stddev(values, avg) {
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

// Least-squares slope of °F against elapsed hours; readings must be oldest-to-newest.
function linearTrendSlope(readingsAsc) {
  const t0 = new Date(readingsAsc[0].timestamp).getTime();
  const xs = readingsAsc.map((r) => (new Date(r.timestamp).getTime() - t0) / 3_600_000);
  const ys = readingsAsc.map((r) => r.tempF);
  const xMean = mean(xs);
  const yMean = mean(ys);

  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function formatSpan(hours) {
  return hours < 48 ? `${hours.toFixed(1)} hours` : `${(hours / 24).toFixed(1)} days`;
}

// Builds a trend flag from up to `maxPoints` of a sensor's most recent readings, or
// null if there isn't enough history yet or the slope doesn't clear the threshold.
function trendFlag(sensorIndex, readingsDesc, { type, minPoints, maxPoints, slopeThreshold }) {
  if (readingsDesc.length < minPoints) return null;

  const windowAsc = readingsDesc.slice(0, Math.min(readingsDesc.length, maxPoints)).slice().reverse();
  const slope = linearTrendSlope(windowAsc);
  if (Math.abs(slope) < slopeThreshold) return null;

  const spanHours = (new Date(windowAsc[windowAsc.length - 1].timestamp).getTime() - new Date(windowAsc[0].timestamp).getTime()) / 3_600_000;

  return {
    sensorIndex,
    type,
    severity: Math.abs(slope) >= slopeThreshold * 2 ? 'high' : 'medium',
    message: `Sensor ${sensorIndex} is trending ${slope > 0 ? 'up' : 'down'} at ~${Math.abs(slope).toFixed(2)}°F/hour over its last ${windowAsc.length} readings (${formatSpan(spanHours)}).`,
  };
}

/**
 * @param {{ sensorIndex: number, readingsDesc: { timestamp: string, tempF: number }[] }[]} perSensor
 *   readingsDesc must be newest-first, matching the Supabase query order.
 * @returns {Array<{ sensorIndex: number, type: 'zscore'|'trend-short'|'trend-long'|'flatline', severity: 'medium'|'high', message: string }>}
 */
export function detectAnomalies(perSensor) {
  const flags = [];

  for (const { sensorIndex, readingsDesc } of perSensor) {
    if (readingsDesc.length < MIN_READINGS_FOR_STATS) continue;

    const temps = readingsDesc.map((r) => r.tempF);
    const avg = mean(temps);
    const sd = stddev(temps, avg);
    const latest = readingsDesc[0];

    if (sd > 0) {
      const z = (latest.tempF - avg) / sd;
      if (Math.abs(z) >= Z_SCORE_THRESHOLD) {
        flags.push({
          sensorIndex,
          type: 'zscore',
          severity: Math.abs(z) >= Z_SCORE_THRESHOLD + 1 ? 'high' : 'medium',
          message: `Sensor ${sensorIndex}'s latest reading (${latest.tempF.toFixed(1)}°F) is ${Math.abs(z).toFixed(1)}σ from its recent average (${avg.toFixed(1)}°F).`,
        });
      }
    }

    if (readingsDesc.length >= SHORT_TREND_MIN_POINTS) {
      const shortTrend = trendFlag(sensorIndex, readingsDesc, {
        type: 'trend-short',
        minPoints: SHORT_TREND_MIN_POINTS,
        maxPoints: SHORT_TREND_MAX_POINTS,
        slopeThreshold: SHORT_TREND_SLOPE_THRESHOLD_F_PER_HOUR,
      });
      if (shortTrend) flags.push(shortTrend);
    }

    if (readingsDesc.length >= LONG_TREND_MIN_POINTS) {
      const longTrend = trendFlag(sensorIndex, readingsDesc, {
        type: 'trend-long',
        minPoints: LONG_TREND_MIN_POINTS,
        maxPoints: LONG_TREND_MAX_POINTS,
        slopeThreshold: LONG_TREND_SLOPE_THRESHOLD_F_PER_HOUR,
      });
      if (longTrend) flags.push(longTrend);
    }

    if (readingsDesc.length >= FLATLINE_MIN_POINTS) {
      const recent = temps.slice(0, FLATLINE_MIN_POINTS);
      const recentAvg = mean(recent);
      const recentSd = stddev(recent, recentAvg);
      if (recentSd <= FLATLINE_STDDEV_THRESHOLD) {
        flags.push({
          sensorIndex,
          type: 'flatline',
          severity: 'medium',
          message: `Sensor ${sensorIndex} has reported an unchanging value (${recentAvg.toFixed(1)}°F) for its last ${FLATLINE_MIN_POINTS} readings — possible sensor failure.`,
        });
      }
    }
  }

  return flags;
}
