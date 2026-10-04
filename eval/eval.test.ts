import { beforeAll, describe, expect, it } from 'vitest';
import { evaluate, type Metrics } from './evaluate';

describe('fixture evaluation (Phase 1–2 exit criteria)', () => {
  let m: Metrics;
  beforeAll(async () => {
    m = await evaluate();
  });

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

  it('auto-filled values are 100% correct', () => {
    expect(m.precision).toBe(1);
  });

  it('precision incl. review band is at least 97%', () => {
    expect(m.precisionWithReview).toBeGreaterThanOrEqual(0.97);
  });

  it('recall incl. review band is at least 75%', () => {
    expect(m.recallWithReview).toBeGreaterThanOrEqual(0.75);
  });

  it('rules-only matching of a form takes under 300 ms', () => {
    expect(m.medianMs).toBeLessThan(300);
  });
});
