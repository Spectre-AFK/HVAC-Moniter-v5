import { describe, expect, it } from 'vitest';
import { validateThresholds } from './alertThresholds';

describe('threshold validation shared by UI and Worker', () => {
  it.each([['85.5', '65.5', { high: 85.5, low: 65.5 }], ['', 65, { high: null, low: 65 }],
    [85, null, { high: 85, low: null }]])('accepts valid high=%s low=%s', (high, low, expected) => {
    expect(validateThresholds(high, low)).toEqual(expected);
  });
  it.each([['', ''], [null, null], ['Infinity', 65], [NaN, 65], [undefined, 65], [80, 85], [85, 85]])('rejects high=%s low=%s explicitly', (high, low) => {
    expect(() => validateThresholds(high, low)).toThrow();
  });
});
