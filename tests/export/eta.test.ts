import { describe, expect, it } from 'vitest';
import { estimateRemainingMs, formatRemaining } from '../../src/lib/export/eta';

describe('estimateRemainingMs', () => {
  it('extrapolates from the average rate', () => {
    expect(estimateRemainingMs(0.25, 10_000)).toBe(30_000);
    expect(estimateRemainingMs(0.5, 4_000)).toBe(4_000);
    expect(estimateRemainingMs(1, 9_000)).toBe(0);
  });

  it('waits until there is enough progress and time', () => {
    expect(estimateRemainingMs(0.01, 10_000)).toBeUndefined();
    expect(estimateRemainingMs(0.3, 500)).toBeUndefined();
    expect(estimateRemainingMs(NaN, 10_000)).toBeUndefined();
  });
});

describe('formatRemaining', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatRemaining(7_200)).toBe('8 s');
    expect(formatRemaining(65_000)).toBe('1 min 05 s');
    expect(formatRemaining(59_500)).toBe('1 min 00 s');
    expect(formatRemaining(3_725_000)).toBe('1 h 02 min');
    expect(formatRemaining(-5)).toBe('0 s');
  });
});
