export const MAX_HISTORY_READINGS = 10_000;
const PAGE_SIZE = 500;

export async function fetchPagedRows(makeQuery, { signal, maxRows = MAX_HISTORY_READINGS } = {}) {
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new RangeError('The history row limit must be a positive integer.');
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Database query timed out after 30 seconds. Please retry.')), 30_000);
  const rows = [];
  try {
    while (rows.length < maxRows) {
      controller.signal.throwIfAborted();
      const { data, error } = await makeQuery()
        .range(rows.length, Math.min(rows.length + PAGE_SIZE, maxRows) - 1).abortSignal(controller.signal);
      controller.signal.throwIfAborted();
      if (error) throw error;
      if (!Array.isArray(data)) throw new TypeError('The database returned an invalid row list.');
      if (data.length === 0) break;
      if (data.length > Math.min(PAGE_SIZE, maxRows - rows.length)) {
        throw new TypeError('The database returned more rows than requested.');
      }
      rows.push(...data);
    }
    return { rows, limitReached: rows.length === maxRows };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export async function loadSensorHistory(supabase, { startDate, endDate, signal, now = new Date() }) {
  const start = startDate ? new Date(startDate) : null;
  const end = endDate ? new Date(endDate) : now;
  if ((start && !Number.isFinite(start.getTime())) || !Number.isFinite(end.getTime()) ||
      (start && start > end)) {
    throw new TypeError('Choose a valid date range with the start before the end.');
  }
  const result = await fetchPagedRows(() => {
    let query = supabase.from('sensor_data')
      .select('device_id,sensor_index,temperature_c,timestamp')
      .order('timestamp', { ascending: false })
      .order('device_id')
      .order('sensor_index')
      .lte('timestamp', end.toISOString());
    if (start) query = query.gte('timestamp', start.toISOString());
    return query;
  }, { signal });
  for (const row of result.rows) {
    if (typeof row.device_id !== 'string' || !Number.isInteger(row.sensor_index) ||
        row.sensor_index < 0 || row.temperature_c === null ||
        !Number.isFinite(Number(row.temperature_c)) || !Number.isFinite(Date.parse(row.timestamp))) {
      throw new TypeError('Sensor history contains an invalid reading. Check the ingestion logs.');
    }
    convertCtoF(row.temperature_c);
  }
  return result;
}
import { convertCtoF } from './sensors';
