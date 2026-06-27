import { describe, expect, it } from 'vitest';
import { boundedInteger } from './db.js';

describe('boundedInteger', () => {
  it('falls back for non-finite pagination values', () => {
    expect(boundedInteger(Number.NaN, 50, 1, 100)).toBe(50);
    expect(boundedInteger(Number.POSITIVE_INFINITY, 50, 1, 100)).toBe(50);
    expect(boundedInteger(Number.NEGATIVE_INFINITY, 0, 0)).toBe(0);
  });

  it('clamps and truncates finite pagination values', () => {
    expect(boundedInteger(-1, 50, 1, 100)).toBe(1);
    expect(boundedInteger(200, 50, 1, 100)).toBe(100);
    expect(boundedInteger(12.9, 50, 1, 100)).toBe(12);
    expect(boundedInteger(2.7, 0, 0)).toBe(2);
  });
});
