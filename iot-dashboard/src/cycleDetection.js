// Rule-based HVAC on/off cycle detection — same "plain statistics, no ML" philosophy as
// anomalyDetection.js. A cooling call shows up as a falling run in the temperature series
// (peak -> trough); the compressor resting shows up as a rising run (trough -> peak). Walking
// those peaks/troughs lets us report duty cycle, flag short-cycling (a real hardware fault),
// and tell a routine cooling cycle apart from someone manually lowering the setpoint — no AI
// needed for any of this, just zig-zag extrema detection on data we already have.

const MIN_READINGS_FOR_CYCLES = 20;
// Only look at recent history for "current" cycling behavior, mirroring anomalyDetection.js's trend windows.
const CYCLE_WINDOW_MAX_POINTS = 200;
// How many of the most recent full cycles to average for duty-cycle/short-cycling stats.
const RECENT_CYCLES_FOR_STATS = 8;

// Swings smaller than this between a reading and the last extreme are treated as sensor
// jitter, not a real peak/trough, at typical ~10-minute publish intervals.
const EXTREMA_PROMINENCE_F = 0.3;

const MIN_CYCLES_FOR_STATS = 3;
// Real compressors rarely cycle faster than this; anything shorter and more often points to a
// hardware problem (weak capacitor, low refrigerant, oversized unit) than normal operation.
const SHORT_CYCLE_MINUTES_THRESHOLD = 12;

// A setback event (someone lowering the setpoint) is a fall much bigger than the sensor's own
// recent cooling-cycle amplitude — not just one more routine cooling call.
const MIN_FALLING_SEGMENTS_FOR_BASELINE = 4;
const SETBACK_MIN_DROP_F = 3;
const SETBACK_AMPLITUDE_MULTIPLE = 2.5;

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function minutesBetween(aTimestamp, bTimestamp) {
  return Math.abs(new Date(bTimestamp).getTime() - new Date(aTimestamp).getTime()) / 60_000;
}

function formatClockTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Zig-zag extrema detector: walks the series and emits a peak/trough each time direction
// reverses by at least `prominenceF`, ignoring smaller wiggles in between. Input must be
// oldest-to-newest.
function findExtrema(readingsAsc, prominenceF) {
  const extrema = [];
  let anchor = 0; // index of the current run's most extreme point so far
  let direction = 0; // 1 rising, -1 falling, 0 undetermined

  for (let i = 1; i < readingsAsc.length; i++) {
    const deltaFromAnchor = readingsAsc[i].tempF - readingsAsc[anchor].tempF;

    if (direction === 0) {
      if (Math.abs(deltaFromAnchor) >= prominenceF) {
        direction = deltaFromAnchor > 0 ? 1 : -1;
        anchor = i;
      }
      continue;
    }

    const extendsRun = direction === 1
      ? readingsAsc[i].tempF >= readingsAsc[anchor].tempF
      : readingsAsc[i].tempF <= readingsAsc[anchor].tempF;

    if (extendsRun) {
      anchor = i;
    } else if (Math.abs(readingsAsc[i].tempF - readingsAsc[anchor].tempF) >= prominenceF) {
      extrema.push({ ...readingsAsc[anchor], type: direction === 1 ? 'peak' : 'trough' });
      anchor = i;
      direction = -direction;
    }
  }

  return extrema;
}

/**
 * @param {{ key: string, label: string, readingsDesc: { timestamp: string, tempF: number }[] }[]} perSensor
 *   Same shape as anomalyDetection.js's detectAnomalies — readingsDesc must be newest-first.
 * @returns {Array<{ key: string, type: 'cycle-info'|'short-cycle'|'setback', severity: 'low'|'medium'|'high', message: string }>}
 */
export function detectHvacPatterns(perSensor) {
  const flags = [];

  for (const { key, label, readingsDesc } of perSensor) {
    if (readingsDesc.length < MIN_READINGS_FOR_CYCLES) continue;

    const windowAsc = readingsDesc.slice(0, Math.min(readingsDesc.length, CYCLE_WINDOW_MAX_POINTS)).slice().reverse();
    const extrema = findExtrema(windowAsc, EXTREMA_PROMINENCE_F);
    if (extrema.length < 3) continue;

    // Falling run = peak -> trough (compressor cooling); rising run = trough -> peak (resting).
    const fallingSegments = [];
    for (let i = 0; i < extrema.length - 1; i++) {
      const a = extrema[i];
      const b = extrema[i + 1];
      if (a.type !== 'peak' || b.type !== 'trough') continue;
      fallingSegments.push({
        startTimestamp: a.timestamp,
        amplitude: a.tempF - b.tempF,
        minutes: minutesBetween(a.timestamp, b.timestamp),
      });
    }

    // Full peak->peak (or trough->trough) cycles, one non-overlapping entry per real cycle —
    // using the series' own first extremum type as the reference keeps consecutive triplets
    // from double-counting the same segment from both a peak-start and trough-start view.
    const referenceType = extrema[0].type;
    const fullCycles = [];
    for (let i = 0; i + 2 < extrema.length; i++) {
      const first = extrema[i];
      const mid = extrema[i + 1];
      const last = extrema[i + 2];
      if (first.type !== referenceType || last.type !== referenceType) continue;

      const firstToMidMinutes = minutesBetween(first.timestamp, mid.timestamp);
      const midToLastMinutes = minutesBetween(mid.timestamp, last.timestamp);
      const coolingMinutes = first.type === 'peak' ? firstToMidMinutes : midToLastMinutes;
      const restingMinutes = first.type === 'peak' ? midToLastMinutes : firstToMidMinutes;
      fullCycles.push({ totalMinutes: coolingMinutes + restingMinutes, coolingMinutes });
    }

    if (fullCycles.length >= MIN_CYCLES_FOR_STATS) {
      const recentCycles = fullCycles.slice(-RECENT_CYCLES_FOR_STATS);
      const avgTotalMinutes = mean(recentCycles.map((c) => c.totalMinutes));
      const avgCoolingMinutes = mean(recentCycles.map((c) => c.coolingMinutes));
      const dutyCyclePct = (avgCoolingMinutes / avgTotalMinutes) * 100;

      if (avgTotalMinutes <= SHORT_CYCLE_MINUTES_THRESHOLD) {
        flags.push({
          key,
          type: 'short-cycle',
          severity: avgTotalMinutes <= SHORT_CYCLE_MINUTES_THRESHOLD * 0.6 ? 'high' : 'medium',
          message: `${label} is short-cycling — averaging a full on/off cycle every ${avgTotalMinutes.toFixed(0)} min over its last ${recentCycles.length} cycles. Frequent short cycles can mean a failing capacitor, low refrigerant, or an oversized unit.`,
        });
      } else {
        flags.push({
          key,
          type: 'cycle-info',
          severity: 'low',
          message: `${label} is cycling on/off roughly every ${avgTotalMinutes.toFixed(0)} min (running ~${dutyCyclePct.toFixed(0)}% of that time) over its last ${recentCycles.length} cycles.`,
        });
      }
    }

    if (fallingSegments.length >= MIN_FALLING_SEGMENTS_FOR_BASELINE) {
      const typicalAmplitude = median(fallingSegments.map((s) => s.amplitude));
      const setbackCandidates = fallingSegments.filter(
        (s) => s.amplitude >= SETBACK_MIN_DROP_F && s.amplitude >= typicalAmplitude * SETBACK_AMPLITUDE_MULTIPLE
      );
      const latestSetback = setbackCandidates[setbackCandidates.length - 1];
      if (latestSetback) {
        flags.push({
          key,
          type: 'setback',
          severity: 'low',
          // Structured fields (beyond `message`) so callers like worker/index.js's HVAC event
          // logger can persist this event without re-parsing the human-readable message.
          occurredAt: latestSetback.startTimestamp,
          amplitudeF: latestSetback.amplitude,
          durationMinutes: latestSetback.minutes,
          typicalAmplitudeF: typicalAmplitude,
          message: `${label} dropped ${latestSetback.amplitude.toFixed(1)}°F over ${latestSetback.minutes.toFixed(0)} min starting around ${formatClockTime(latestSetback.startTimestamp)} — much more than its typical ~${typicalAmplitude.toFixed(1)}°F cooling cycle, consistent with a manual setpoint change.`,
        });
      }
    }
  }

  return flags;
}
