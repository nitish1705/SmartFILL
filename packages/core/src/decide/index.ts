import type { Thresholds } from '@smartfill/schemas';
import type { Decision } from '../types';

export function decideBand(confidence: number, t: Thresholds): Exclude<Decision, 'blocked'> {
  if (confidence >= t.auto) return 'auto';
  if (confidence >= t.review) return 'review';
  if (confidence >= t.ask) return 'ask';
  return 'skip';
}

const ORDER: Decision[] = ['auto', 'review', 'ask', 'skip', 'blocked'];

/** Return the more cautious of two decisions. */
export function moreCautious(a: Decision, b: Decision): Decision {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}
