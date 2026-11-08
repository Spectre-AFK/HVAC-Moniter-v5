import { detectAnomalies } from './anomalyDetection';
import { detectHvacPatterns } from './cycleDetection';
import { convertCtoF, sensorKey, sensorLabel } from './sensors';

export function buildDashboard(rows, names) {
  if (rows.length === 0) return null;
  const grouped = new Map();
  const byTimestamp = new Map();
  for (const row of rows) {
    const key = sensorKey(row.device_id, row.sensor_index);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
    if (!byTimestamp.has(row.timestamp)) {
      byTimestamp.set(row.timestamp, {
        timestamp: row.timestamp,
        time: new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      });
    }
    byTimestamp.get(row.timestamp)[key] = Number(convertCtoF(row.temperature_c).toFixed(1));
  }
  const uniqueSensorKeys = [...grouped.keys()].sort();
  const perSensor = uniqueSensorKeys.map((key, colorIndex) => {
    const readings = grouped.get(key);
    const latest = readings[0];
    const temps = readings.map(row => convertCtoF(row.temperature_c));
    return {
      key, colorIndex, latest, deviceId: latest.device_id, sensorIndex: latest.sensor_index,
      latestTempF: temps[0], max: Math.max(...temps), min: Math.min(...temps),
      avg: temps.reduce((sum, value) => sum + value, 0) / temps.length,
      recentTimestamps: readings.slice(0, 7).map(row => row.timestamp),
    };
  });
  const perSensorReadings = perSensor.map(sensor => ({
    key: sensor.key, label: sensorLabel(names, sensor.deviceId, sensor.sensorIndex),
    readingsDesc: grouped.get(sensor.key).map(row => ({ timestamp: row.timestamp, tempF: convertCtoF(row.temperature_c) })),
  }));
  return {
    uniqueSensorKeys, perSensor,
    chartData: [...byTimestamp.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)),
    anomalies: detectAnomalies(perSensorReadings), hvacPatterns: detectHvacPatterns(perSensorReadings),
  };
}

export function sensorStaleness(dashboard, isLive, now) {
  if (!dashboard || !isLive) return {};
  return Object.fromEntries(dashboard.perSensor.map(sensor => {
    const timestamps = sensor.recentTimestamps.map(Date.parse);
    const deltas = timestamps.slice(1).map((timestamp, i) => timestamps[i] - timestamp)
      .filter(delta => delta > 0).sort((a, b) => a - b);
    const expectedInterval = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;
    const threshold = expectedInterval === null ? 30 * 60_000 : Math.max(expectedInterval * 2.5, 60_000);
    const msSinceLastReading = now - timestamps[0];
    return [sensor.key, { isStale: msSinceLastReading > threshold, msSinceLastReading }];
  }));
}

const SEVERITY_RANK = { high: 3, medium: 2, low: 1 };
// Among equally severe flags, problems outrank informational notes, and the
// "not enough samples" caveat is the least useful thing to show.
const TYPE_RANK = {
  zscore: 10, flatline: 9, 'short-cycle': 9, 'trend-short': 8, 'trend-long': 8,
  'routine-missing': 7, 'routine-deviation': 7, setback: 5, 'cycle-info': 4,
  'routine-established': 3, 'routine-ambiguous': 2, 'cycle-insufficient': 1,
};

// Chooses the single most important insight to show on a sensor card.
export function pickTopInsight(flags) {
  let best = null;
  let bestScore = -Infinity;
  for (const flag of flags) {
    const score = (SEVERITY_RANK[flag.severity] ?? 0) * 100 + (TYPE_RANK[flag.type] ?? 0);
    if (score > bestScore) {
      best = flag;
      bestScore = score;
    }
  }
  return best;
}
