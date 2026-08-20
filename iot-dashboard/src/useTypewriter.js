import { useEffect, useState } from 'react';

// Reveals `text` one character at a time, with slight timing jitter so it reads like
// natural typing rather than a uniform, robotic (and easy-to-miss) tick.
export function useTypewriter(text, baseSpeedMs = 28) {
  const [displayed, setDisplayed] = useState('');

  useEffect(() => {
    setDisplayed('');
    if (!text) return undefined;

    let i = 0;
    let timeoutId;

    const tick = () => {
      i += 1;
      setDisplayed(text.slice(0, i));
      if (i < text.length) {
        const jitter = Math.random() * 20 - 10;
        timeoutId = setTimeout(tick, Math.max(10, baseSpeedMs + jitter));
      }
    };
    timeoutId = setTimeout(tick, baseSpeedMs);

    return () => clearTimeout(timeoutId);
  }, [text, baseSpeedMs]);

  return displayed;
}
