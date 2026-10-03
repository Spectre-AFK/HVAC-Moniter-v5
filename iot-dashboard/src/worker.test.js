import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index.js';
import { evaluateRule, escapeHtml } from '../worker/alerts.js';

const userId = '00000000-0000-4000-8000-000000000001';
const env = { SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'test-public', SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  RESEND_API_KEY: 'test-provider', ALERT_FROM_EMAIL: 'alerts@example.invalid', AI: { run: vi.fn() } };
const flag = { key: 'test_0', type: 'zscore', severity: 'medium', message: 'A reading was 4 standard deviations from the mean.' };
const request = (path, body, method = 'POST') => new Request(`https://app.invalid${path}`, {
  method, headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(Response.json({ id: userId }));
  vi.stubGlobal('fetch', fetchMock);
  env.AI.run.mockReset().mockResolvedValue({ response: 'A neutral summary.' });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Worker API contracts', () => {
  it.each([null, [], {}, { flags: [null] }, { flags: [{ ...flag, message: 'x'.repeat(1001) }] }])('rejects malformed body %j without an unhandled exception', async (body) => {
    expect((await worker.fetch(request('/api/anomaly-summary', body), env)).status).toBe(400);
    expect(env.AI.run).not.toHaveBeenCalled();
  });
  it('enforces the request byte limit', async () => {
    expect((await worker.fetch(request('/api/anomaly-summary', { padding: 'x'.repeat(65_537) }), env)).status).toBe(413);
  });
  it('returns a populated summary and non-cacheable response', async () => {
    const response = await worker.fetch(request('/api/anomaly-summary', { flags: [flag] }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ summary: 'A neutral summary.' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('does not treat an empty AI result as success', async () => {
    env.AI.run.mockResolvedValue({});
    expect((await worker.fetch(request('/api/anomaly-summary', { flags: [flag] }), env)).status).toBe(502);
  });
  it('denies missing authentication and non-admin user searches', async () => {
    expect((await worker.fetch(new Request('https://app.invalid/api/health'), env)).status).toBe(401);
    expect((await worker.fetch(request('/api/admin/users?query=example', undefined, 'GET'), env)).status).toBe(403);
  });
  it('distinguishes authentication outage from rejected credentials', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    expect((await worker.fetch(request('/api/health', undefined, 'GET'), env)).status).toBe(502);
  });
  it('returns API-specific 404/405 instead of the SPA', async () => {
    expect((await worker.fetch(request('/api/unknown', undefined, 'GET'), env)).status).toBe(404);
    const response = await worker.fetch(request('/api/anomaly-summary', undefined, 'GET'), env);
    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
  });
  it('searches beyond the first user page', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.endsWith('/auth/v1/user')) return Response.json({ id: userId, app_metadata: { role: 'admin' } });
      return Response.json({ users: url.endsWith('page=1')
        ? Array.from({ length: 200 }, (_, i) => ({ id: `user-${i}`, email: `person${i}@other.invalid` }))
        : [{ id: userId, email: 'match@example.invalid' }] });
    });
    const response = await worker.fetch(request('/api/admin/users?query=match', undefined, 'GET'), env);
    expect((await response.json()).users).toEqual([{ id: userId, email: 'match@example.invalid' }]);
  });
  it('limits a user to ten AI requests per isolate window', async () => {
    fetchMock.mockImplementation(async () => Response.json({ id: 'rate-limit-test-user' }));
    for (let i = 0; i < 10; i++) {
      expect((await worker.fetch(request('/api/anomaly-summary', { flags: [flag] }), env)).status).toBe(200);
    }
    expect((await worker.fetch(request('/api/anomaly-summary', { flags: [flag] }), env)).status).toBe(429);
    expect(env.AI.run).toHaveBeenCalledTimes(10);
  });
});

describe('alert transitions', () => {
  const now = Date.parse('2026-10-02T06:00:00Z');
  const rule = { id: 'rule-1', user_id: userId, device_id: 'test', sensor_index: 0, high_f: 85, low_f: 65, is_triggered: false };
  function services({ minutesOld = 0, tempC = 35, granted = true, emailStatus = 200 } = {}) {
    fetchMock.mockImplementation(async (url, options) => {
      if (url.includes('/auth/v1/admin/users/')) return Response.json({ id: userId, email: 'test@example.invalid' });
      if (url.includes('/device_permissions?')) return Response.json(granted ? [{ id: 'grant' }] : []);
      if (url.includes('/sensor_data?')) return Response.json([{ temperature_c: tempC, timestamp: new Date(now - minutesOld * 60_000).toISOString() }]);
      if (url.includes('/sensor_names?')) return Response.json([{ name: '<b>Untrusted & name</b>' }]);
      if (url === 'https://api.resend.com/emails') return new Response('{}', { status: emailStatus });
      if (options?.method === 'PATCH') return new Response(null, { status: 204 });
      throw new Error(`Unexpected mock request: ${url}`);
    });
  }
  it('sends a breach and updates state only after provider acceptance', async () => {
    services();
    await evaluateRule(rule, env, now);
    const emailCall = fetchMock.mock.calls.find(([url]) => url === 'https://api.resend.com/emails');
    expect(JSON.parse(emailCall[1].body).html).toContain('&lt;b&gt;Untrusted &amp; name&lt;/b&gt;');
    expect(emailCall[1].headers['Idempotency-Key']).toBeTruthy();
    expect(fetchMock.mock.calls.at(-1)[1].method).toBe('PATCH');
  });
  it('does not change state after failed email delivery', async () => {
    services({ emailStatus: 400 });
    await expect(evaluateRule(rule, env, now)).rejects.toThrow('Email provider rejected');
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'PATCH')).toBe(false);
  });
  it.each([false, true])('does not breach or clear with stale data (triggered=%s)', async (is_triggered) => {
    services({ minutesOld: 31 });
    await evaluateRule({ ...rule, is_triggered }, env, now);
    expect(fetchMock.mock.calls.some(([url]) => url === 'https://api.resend.com/emails')).toBe(false);
    expect(console.warn).toHaveBeenCalled();
  });
  it.each([[30, true], [30 + 1 / 60_000, false], [-5, true], [-5 - 1 / 60_000, false]])(
    'enforces exact freshness boundaries at %s minutes old', async (minutesOld, sends) => {
      services({ minutesOld });
      await evaluateRule(rule, env, now);
      expect(fetchMock.mock.calls.some(([url]) => url === 'https://api.resend.com/emails')).toBe(sends);
    });
  it('does not notify an owner after access is revoked', async () => {
    services({ granted: false });
    await evaluateRule(rule, env, now);
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/sensor_data?'))).toBe(false);
  });
  it('sends a recovery transition for a fresh normal reading', async () => {
    services({ tempC: 22 });
    await evaluateRule({ ...rule, is_triggered: true }, env, now);
    expect(JSON.parse(fetchMock.mock.calls.at(-1)[1].body).is_triggered).toBe(false);
  });
  it('does not repeatedly email while still breached', async () => {
    services();
    await evaluateRule({ ...rule, is_triggered: true }, env, now);
    expect(fetchMock.mock.calls.some(([url]) => url === 'https://api.resend.com/emails')).toBe(false);
  });
  it('escapes all HTML-special characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});
