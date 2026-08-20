// Plain-statistics anomaly detection for sensor temperature readings.
// Intentionally no ML/AI here — just z-score, linear trend, and flatline checks,
// so results are deterministic and free to compute on every render.

const MIN_READINGS_FOR_STATS = 6;
const Z_SCORE_THRESHOLD = 3;
const TREND_MIN_POINTS = 6;
const TREND_MAX_POINTS = 24;
const TREND_SLOPE_THRESHOLD_F_PER_HOUR = 0.75;
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

/**
 * @param {{ sensorIndex: number, readingsDesc: { timestamp: string, tempF: number }[] }[]} perSensor
 *   readingsDesc must be newest-first, matching the Supabase query order.
 * @returns {Array<{ sensorIndex: number, type: 'zscore'|'trend'|'flatline', severity: 'medium'|'high', message: string }>}
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

    if (readingsDesc.length >= TREND_MIN_POINTS) {
      const recentAsc = readingsDesc.slice(0, Math.min(readingsDesc.length, TREND_MAX_POINTS)).slice().reverse();
      const slope = linearTrendSlope(recentAsc);
      if (Math.abs(slope) >= TREND_SLOPE_THRESHOLD_F_PER_HOUR) {
        flags.push({
          sensorIndex,
          type: 'trend',
          severity: Math.abs(slope) >= TREND_SLOPE_THRESHOLD_F_PER_HOUR * 2 ? 'high' : 'medium',
          message: `Sensor ${sensorIndex} is trending ${slope > 0 ? 'up' : 'down'} at ~${Math.abs(slope).toFixed(2)}°F/hour over its last ${recentAsc.length} readings.`,
        });
      }
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
