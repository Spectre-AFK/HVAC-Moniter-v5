import { useEffect, useState, useSyncExternalStore } from 'react';

const motionQuery = '(prefers-reduced-motion: reduce)';
const subscribeMotion = (callback) => {
  const query = window.matchMedia(motionQuery);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
};
const getMotionPreference = () => window.matchMedia(motionQuery).matches;

// Reveals `text` one character at a time, with slight timing jitter so it reads like
// natural typing rather than a uniform, robotic (and easy-to-miss) tick.
export function useTypewriter(text, baseSpeedMs = 28) {
  const [progress, setProgress] = useState({ source: '', displayed: '' });
  const reducedMotion = useSyncExternalStore(subscribeMotion, getMotionPreference, () => false);

  useEffect(() => {
    if (!text || reducedMotion) return undefined;

    let i = 0;
    let timeoutId;

    const tick = () => {
      i += 1;
      setProgress({ source: text, displayed: text.slice(0, i) });
      if (i < text.length) {
        const jitter = Math.random() * 20 - 10;
        timeoutId = setTimeout(tick, Math.max(10, baseSpeedMs + jitter));
      }
    };
    timeoutId = setTimeout(tick, baseSpeedMs);

    return () => clearTimeout(timeoutId);
  }, [text, baseSpeedMs, reducedMotion]);

  return reducedMotion ? text : progress.source === text ? progress.displayed : '';
}
