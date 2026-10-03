// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authCallback: null,
  rows: {},
  sensorResponse: null,
  client: {
    from: vi.fn(),
    auth: {
      getSession: vi.fn(), onAuthStateChange: vi.fn(),
      signInWithPassword: vi.fn(), signOut: vi.fn(),
    },
  },
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mocks.client }));
vi.mock('./TrendChart', () => ({ default: () => <div>Historical chart</div> }));
let App;
let container;
let root;
const user = (id, admin = false) => ({ user: { id, app_metadata: admin ? { role: 'admin' } : {} }, access_token: 'test-token' });
const reading = (temperature_c = 20) => ({
  device_id: 'test-device', sensor_index: 0, temperature_c, timestamp: new Date().toISOString(),
});
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
async function waitForElement(selector) {
  let element;
  await vi.waitFor(async () => {
    await settle();
    element = container.querySelector(selector);
    expect(element).not.toBeNull();
  }, { timeout: 5000, interval: 20 });
  return element;
}

beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.invalid');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-public');
  App = (await import('./App')).default;
});
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  });
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  mocks.rows = { sensor_data: [], sensor_names: [], hvac_events: [] };
  mocks.sensorResponse = null;
  mocks.client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mocks.client.auth.signOut.mockResolvedValue({ error: null });
  mocks.client.auth.onAuthStateChange.mockImplementation((callback) => {
    mocks.authCallback = callback;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  mocks.client.from.mockImplementation((table) => {
    const query = {
      start: 0, end: 499,
      select() { return this; }, order() { return this; }, gte() { return this; }, lte() { return this; }, eq() { return this; },
      range(start, end) { this.start = start; this.end = end; return this; },
      abortSignal() { return this; },
      then(resolve, reject) {
        const result = table === 'sensor_data' && mocks.sensorResponse
          ? mocks.sensorResponse(this.start, this.end) : Promise.resolve({ data: (mocks.rows[table] ?? []).slice(this.start, this.end + 1), error: null });
        return result.then(resolve, reject);
      },
    };
    return query;
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function render() {
  await act(async () => root.render(<App />));
  await settle();
}
async function signIn(id = 'user-a', admin = false) {
  await act(async () => mocks.authCallback('SIGNED_IN', user(id, admin)));
  await settle();
}

describe('dashboard lifecycle and accessible states', () => {
  it('labels threshold and enable controls per sensor', async () => {
    mocks.rows.sensor_data = [reading()];
    await render();
    await signIn();
    await act(async () => container.querySelector('[aria-label="Sensor Alerts"]').click());
    await waitForElement('input[aria-label^="Low threshold"]');
    expect(container.querySelector('input[aria-label^="Low threshold"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label^="High threshold"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label^="Enable alerts"]')).not.toBeNull();
  });
  it('keeps saved rules for absent sensors visible and removable', async () => {
    mocks.rows.sensor_data = [reading()];
    mocks.rows.alert_rules = [{ id: 'saved-rule', device_id: 'offline-device', sensor_index: 2, high_f: 85, low_f: null, enabled: true }];
    await render();
    await signIn();
    await act(async () => container.querySelector('[aria-label="Sensor Alerts"]').click());
    await waitForElement('button[aria-label^="Remove alert for Sensor 2"]');
    expect(container.textContent).toContain('Saved alerts outside the selected readings');
  });
  it('selects an admin autocomplete result using ArrowDown and Enter', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ users: [{ id: '00000000-0000-4000-8000-000000000001', email: 'test@example.invalid' }], truncated: false })));
    mocks.rows.sensor_data = [reading()];
    await render();
    await signIn('admin-user', true);
    await act(async () => container.querySelector('[aria-label="Admin: Device Access"]').click());
    const input = await waitForElement('[role="combobox"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, 'test');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    expect(container.querySelector('[role="option"]')).not.toBeNull();
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(input.value).toBe('test@example.invalid');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });
  it('associates login fields with labels and password-manager hints', async () => {
    await render();
    const signInButton = [...container.querySelectorAll('button')].find(button => button.textContent === 'Sign In');
    await act(async () => signInButton.click());
    const email = container.querySelector('#login-email');
    const password = container.querySelector('#login-password');
    expect(email.labels[0].textContent).toBe('Email');
    expect(email.autocomplete).toBe('username');
    expect(password.labels[0].textContent).toBe('Password');
    expect(password.autocomplete).toBe('current-password');
  });
  it('surfaces a query failure instead of claiming the connection is healthy', async () => {
    await render();
    mocks.sensorResponse = async () => ({ data: null, error: new Error('Database unavailable') });
    await signIn();
    expect(container.querySelector('[role="alert"]').textContent).toContain('Database unavailable');
    expect(container.textContent).toContain('Telemetry Unavailable');
    expect(container.textContent).not.toContain('Supabase Connected');
  });
  it('displays the exact cap warning after loading 10,000 readings', async () => {
    mocks.rows.sensor_data = Array.from({ length: 10_001 }, () => reading());
    await render();
    await signIn();
    expect(container.textContent).toContain('Maximum of 10,000 readings reached.');
    expect(container.textContent).toContain('statistics may show only part');
  });
  it('ignores an old-user query that resolves after the next user signs in', async () => {
    await render();
    let resolveOld;
    const old = new Promise(resolve => { resolveOld = resolve; });
    mocks.sensorResponse = () => old;
    await signIn('user-a');
    mocks.sensorResponse = null;
    mocks.rows.sensor_data = [reading(30)];
    await signIn('user-b');
    await act(async () => resolveOld({ data: [reading(10)], error: null }));
    await settle();
    expect(container.textContent).toContain('86.0');
    expect(container.textContent).not.toContain('50.0');
  });
  it('labels fixed-end telemetry HISTORY rather than LIVE', async () => {
    mocks.rows.sensor_data = [reading()];
    await render();
    await signIn();
    const liveButton = [...container.querySelectorAll('button')].find(button => button.title === 'Toggle live end date');
    await act(async () => liveButton.click());
    await settle();
    expect(container.textContent).toContain('HISTORY');
  });
});
