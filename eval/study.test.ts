import { describe, expect, it } from 'vitest';
import { paired, susScore } from './study';

describe('SUS scoring', () => {
  it('matches the standard formula', () => {
    expect(susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
    expect(susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0);
    expect(susScore([3, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toBe(50);
    expect(susScore([4, 2, 4, 2, 4, 2, 4, 2, 4, 2])).toBe(75);
  });
  it('rejects malformed answers', () => {
    expect(() => susScore([1, 2, 3])).toThrow();
    expect(() => susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 6])).toThrow();
  });
});

describe('paired comparison', () => {
  it('computes mean difference, time saved and a 95% CI', () => {
    const manual = [120, 100, 140, 110, 130];
    const smartfill = [50, 45, 60, 55, 50];
    const r = paired(manual, smartfill);
    expect(r.n).toBe(5);
    expect(r.meanDiff).toBeCloseTo(68, 5);
    expect(r.timeSaved).toBeCloseTo(1 - 52 / 120, 5);
    expect(r.ci95[0]).toBeGreaterThan(0); // clearly faster
    expect(r.ci95[0]).toBeLessThan(r.meanDiff);
    expect(r.ci95[1]).toBeGreaterThan(r.meanDiff);
  });
  it('needs matched pairs', () => {
    expect(() => paired([1], [1])).toThrow();
    expect(() => paired([1, 2], [1])).toThrow();
  });
});
