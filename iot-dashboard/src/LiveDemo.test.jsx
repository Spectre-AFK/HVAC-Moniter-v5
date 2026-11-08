// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LiveDemo from './LiveDemo';

vi.mock('./DemoChart', () => ({ default: () => <div>Demo chart</div> }));

let container;
let root;
let observerCallback;

function setup(reducedMotion) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = (query) => ({ matches: reducedMotion && query.includes('reduce'), addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback) { observerCallback = callback; }
    observe() {}
    disconnect() {}
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
}
const click = async (text) => {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === text || b.getAttribute('aria-label') === text);
  await act(async () => button.click());
};

beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('landing page live demo', () => {
  it('shows the full cooler story with both emails when motion is reduced', async () => {
    setup(true);
    await act(async () => root.render(<LiveDemo isDark />));
    await click('Walk-in Cooler Too Warm');
    expect(container.textContent).toContain('Alert: Walk-in Cooler is above threshold');
    expect(container.textContent).toContain('Alert cleared: Walk-in Cooler');
    expect(container.querySelector('[aria-label="Replay example"]')).not.toBeNull();
  });

  it('replays only while visible and sends the alert email partway through', async () => {
    setup(false);
    await act(async () => root.render(<LiveDemo isDark={false} />));
    await click('Walk-in Cooler Too Warm');
    expect(container.textContent).toContain('Nothing yet');
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(container.textContent).toContain('Nothing yet'); // Not on screen yet, so not playing.
    await act(async () => observerCallback([{ isIntersecting: true }]));
    for (let i = 0; i < 80; i += 1) await act(async () => vi.advanceTimersByTime(500));
    expect(container.textContent).toContain('Alert: Walk-in Cooler is above threshold');
    expect(container.querySelector('[aria-live="polite"]').textContent).not.toBe('');
  });
});
