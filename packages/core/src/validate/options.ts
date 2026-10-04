import { distance } from 'fastest-levenshtein';
import type { SelectOption } from '../types';

const ALIAS_GROUPS: string[][] = [
  ['india', 'in', 'ind', 'bharat', 'republic of india'],
  ['united states', 'usa', 'us', 'u s', 'u s a', 'united states of america', 'america'],
  ['united kingdom', 'uk', 'gb', 'gbr', 'great britain', 'u k'],
  ['united arab emirates', 'uae', 'ae', 'are'],
  ['south korea', 'korea republic of', 'republic of korea', 'kr', 'kor', 'korea'],
  ['china', 'cn', 'chn', 'peoples republic of china', 'prc'],
  ['russia', 'ru', 'rus', 'russian federation'],
  ['germany', 'de', 'deu', 'deutschland'],
  ['male', 'm', 'man'],
  ['female', 'f', 'woman'],
  ['mr', 'mister'],
  ['ms', 'miss', 'mrs'],
  ['dr', 'doctor'],
  ['prof', 'professor'],
];

const norm = (s: string) =>
  s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\s+/g, ' ').trim();

/** Index of the option that best represents `value`, or -1. Placeholder options are never returned. */
export function matchOption(value: string, options: SelectOption[]): number {
  const v = norm(value);
  if (!v) return -1;
  const usable = options.map((o, i) => ({ i, text: norm(o.text), val: norm(o.value), empty: o.value === '' }));
  const pool = usable.filter((o) => !o.empty && o.text);

  // 1. exact text, 2. exact value attribute
  const byText = pool.find((o) => o.text === v);
  if (byText) return byText.i;
  const byValue = pool.find((o) => o.val === v);
  if (byValue) return byValue.i;

  // 3. alias table
  const group = ALIAS_GROUPS.find((g) => g.includes(v));
  if (group) {
    const hit = pool.find((o) => group.includes(o.text) || group.includes(o.val));
    if (hit) return hit.i;
  }

  // 4. fuzzy ≥ 0.9 similarity
  let best = { i: -1, sim: 0 };
  for (const o of pool) {
    const sim = 1 - distance(v, o.text) / Math.max(v.length, o.text.length);
    if (sim > best.sim) best = { i: o.i, sim };
  }
  return best.sim >= 0.9 ? best.i : -1;
}
