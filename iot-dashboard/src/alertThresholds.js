export function validateThresholds(highValue, lowValue) {
  const high = highValue === '' || highValue === null ? null : Number(highValue);
  const low = lowValue === '' || lowValue === null ? null : Number(lowValue);
  if (high === null && low === null) throw new TypeError('Set at least one threshold (high or low).');
  if ((high !== null && !Number.isFinite(high)) || (low !== null && !Number.isFinite(low))) {
    throw new TypeError('Thresholds must be finite numbers.');
  }
  if (high !== null && low !== null && low >= high) {
    throw new TypeError('The low threshold must be less than the high threshold.');
  }
  return { high, low };
}
