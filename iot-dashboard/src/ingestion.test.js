import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseReadingRows } from '../../shared/readingPayload.js';
import { insertReadings, describeBrokerUrl } from '../../mqtt-bridge/ingestion.js';

const timestamp = 1_790_900_000;
const payload = { device_id: 'test-device', timestamp, temperatures: [20, null, 21] };
const flow = JSON.parse(readFileSync(new URL('../../node-red/flows.json', import.meta.url), 'utf8'));
function runFormat(value) {
  const errors = [];
  const result = vm.runInNewContext(`(function(){${flow.find(n => n.name === 'Format for Supabase').func}})()`, {
    Buffer, msg: { payload: value },
    env: { get: (key) => key === 'SUPABASE_URL' ? 'https://example.invalid' : 'test-key' },
    node: { error: (message) => errors.push(message) },
  });
  return { result, errors };
}

describe('ingestion contract', () => {
  it('keeps credentials and query tokens out of broker descriptions', () => {
    expect(describeBrokerUrl('wss://user:private-password@broker.example:8883/private-path?token=private-token'))
      .toBe('wss://broker.example:8883');
  });
  it('preserves probe positions and skips disconnected probes in both paths', () => {
    const rows = parseReadingRows(JSON.stringify(payload));
    expect(rows.map(r => r.sensor_index)).toEqual([0, 2]);
    expect(JSON.parse(JSON.stringify(runFormat(payload).result.payload))).toEqual(rows);
  });
  it.each([null, [], { ...payload, timestamp: 1e20 }, { ...payload, timestamp: 0 },
    { ...payload, device_id: '' }, { ...payload, temperatures: ['20'] },
    { ...payload, temperatures: [200] }, { ...payload, temperatures: [] }])('rejects malformed payloads in both ingestion paths: %j', (value) => {
    expect(() => parseReadingRows(JSON.stringify(value))).toThrow();
    const { result, errors } = runFormat(value);
    expect(result).toBeNull();
    expect(errors).toHaveLength(1);
  });
  it('rejects oversized messages and future clocks', () => {
    expect(() => parseReadingRows(' '.repeat(16_385))).toThrow('16 KiB');
    expect(() => parseReadingRows(JSON.stringify({ ...payload, timestamp: Date.now() / 1000 + 301 }))).toThrow('synchronized clock');
  });
  it('rejects HTTP failures instead of returning success', async () => {
    await expect(insertReadings([], { SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-key' },
      vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })))).rejects.toThrow('503');
  });
  it('accepts a successful database write', async () => {
    await expect(insertReadings([], { SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-key' },
      vi.fn().mockResolvedValue(new Response(null, { status: 201 })))).resolves.toBeUndefined();
  });
  it.each([undefined, 'ECONNREFUSED', 199, 300, 401, 500])('shows a failed flow write for status %s', (statusCode) => {
    const status = vi.fn();
    const error = vi.fn();
    vm.runInNewContext(`(function(){${flow.find(n => n.name === 'Handle Supabase Response').func}})()`, {
      msg: { statusCode, payload: 'failed' }, node: { status, error },
    });
    expect(status.mock.calls[0][0].fill).toBe('red');
    expect(error).toHaveBeenCalledOnce();
  });
});
