import { describe, expect, it, vi } from 'vitest';
import { fetchPagedRows, loadSensorHistory } from './history';

function queryFactory(rows, { effectivePageSize = 500, failAt = Infinity } = {}) {
  return () => ({
    range(start, end) {
      this.start = start;
      this.end = end;
      return this;
    },
    abortSignal() { return this; },
    then(resolve) {
      return Promise.resolve(resolve(this.start >= failAt
        ? { error: new Error('Database unavailable') }
        : { data: rows.slice(this.start, Math.min(this.end + 1, this.start + effectivePageSize)) }));
    },
  });
}

describe('paginated history', () => {
  it('loads more than the default Supabase page limit', async () => {
    const rows = Array.from({ length: 2301 }, (_, id) => ({ id }));
    expect(await fetchPagedRows(queryFactory(rows))).toEqual({ rows, limitReached: false });
  });
  it('honors smaller server page limits without dropping rows', async () => {
    const rows = Array.from({ length: 703 }, (_, id) => ({ id }));
    expect((await fetchPagedRows(queryFactory(rows, { effectivePageSize: 100 }))).rows).toEqual(rows);
  });
  it.each([10_000, 10_001, 15_000])('stops at exactly 10,000 and warns for %i rows', async (count) => {
    const result = await fetchPagedRows(queryFactory(Array.from({ length: count }, (_, id) => ({ id }))));
    expect(result.rows).toHaveLength(10_000);
    expect(result.limitReached).toBe(true);
  });
  it('does not turn a later-page failure into partial success', async () => {
    await expect(fetchPagedRows(queryFactory(Array(1000).fill({}), { failAt: 500 }))).rejects.toThrow('Database unavailable');
  });
  it('does not start an aborted query', async () => {
    const controller = new AbortController();
    controller.abort();
    const makeQuery = vi.fn();
    await expect(fetchPagedRows(makeQuery, { signal: controller.signal })).rejects.toThrow();
    expect(makeQuery).not.toHaveBeenCalled();
  });
  it('times out a stalled query with an explicit error', async () => {
    vi.useFakeTimers();
    try {
      const makeQuery = () => ({
        range() { return this; },
        abortSignal(signal) {
          return new Promise(resolve => signal.addEventListener('abort', () => resolve({ error: signal.reason }), { once: true }));
        },
      });
      const result = expect(fetchPagedRows(makeQuery)).rejects.toThrow('timed out after 30 seconds');
      await vi.advanceTimersByTimeAsync(30_000);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([['invalid', ''], ['2026-10-01T12:00', '2026-09-01T12:00']])('rejects invalid date ranges', async (startDate, endDate) => {
    await expect(loadSensorHistory({}, { startDate, endDate })).rejects.toThrow('valid date range');
  });
});
