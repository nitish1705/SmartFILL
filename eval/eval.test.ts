import { describe, expect, it } from 'vitest';
import { evaluate } from './evaluate';

describe('fixture evaluation (Phase 1 exit criteria)', () => {
  const m = evaluate();

  it('fixtures and ground truth line up', () => {
    expect(m.problems).toEqual([]);
  });

  it('never fills a wrong value', () => {
    expect(m.incorrect).toBe(0);
    expect(m.falseAutofillRate).toBe(0);
  });

  it('leaves every unmatchable field blank', () => {
    expect(m.unknownSafetyRate).toBe(1);
  });

  it('recall on matchable fields is at least 65%', () => {
    expect(m.recall).toBeGreaterThanOrEqual(0.65);
  });
});
