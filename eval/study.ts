/**
 * Analysis for the within-subject user study (docs/user-study.md).
 *   npx tsx eval/study.ts docs/study-templates/sus.csv docs/study-templates/timings.csv
 */
import { readFileSync } from 'node:fs';

/** System Usability Scale: ten 1–5 answers, odd items positive, even items negative → 0–100. */
export function susScore(answers: number[]): number {
  if (answers.length !== 10 || answers.some((a) => !Number.isInteger(a) || a < 1 || a > 5)) {
    throw new Error('SUS needs exactly ten integer answers between 1 and 5');
  }
  const sum = answers.reduce((acc, a, i) => acc + (i % 2 === 0 ? a - 1 : 5 - a), 0);
  return sum * 2.5;
}

export const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
export const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

/** Two-sided 95% critical values of Student's t for df = 1..30 (then the normal value). */
const T95 = [12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];
export const tCritical95 = (df: number) => (df < 1 ? NaN : (T95[df - 1] ?? 1.96));

export interface PairedResult {
  n: number;
  meanManual: number;
  meanSmartFill: number;
  meanDiff: number;
  ci95: [number, number];
  t: number;
  /** relative time saved, 1 − smartfill/manual */
  timeSaved: number;
}

/** Paired comparison; `manual[i]` and `smartfill[i]` belong to the same participant. */
export function paired(manual: number[], smartfill: number[]): PairedResult {
  if (manual.length !== smartfill.length || manual.length < 2) throw new Error('need ≥2 matched pairs');
  const diffs = manual.map((m, i) => m - smartfill[i]!);
  const n = diffs.length;
  const md = mean(diffs);
  const se = sd(diffs) / Math.sqrt(n);
  const half = tCritical95(n - 1) * se;
  return {
    n,
    meanManual: mean(manual),
    meanSmartFill: mean(smartfill),
    meanDiff: md,
    ci95: [md - half, md + half],
    t: se === 0 ? Infinity : md / se,
    timeSaved: 1 - mean(smartfill) / mean(manual),
  };
}

function parseCsv(path: string): Record<string, string>[] {
  const [head, ...rows] = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const cols = head!.split(',').map((c) => c.trim());
  return rows.filter(Boolean).map((r) => Object.fromEntries(r.split(',').map((v, i) => [cols[i]!, v.trim()])));
}

if (require.main === module) {
  const [susPath, timingsPath] = process.argv.slice(2);
  if (!susPath || !timingsPath) {
    console.error('usage: tsx eval/study.ts <sus.csv> <timings.csv>');
    process.exit(2);
  }
  const scores = parseCsv(susPath).map((r) => susScore(Array.from({ length: 10 }, (_, i) => Number(r[`q${i + 1}`]))));
  console.log(`SUS: n=${scores.length} mean=${mean(scores).toFixed(1)} sd=${scores.length > 1 ? sd(scores).toFixed(1) : 'n/a'}  (68 = average usability)`);

  const timings = parseCsv(timingsPath);
  for (const form of [...new Set(timings.map((t) => t.form))]) {
    const rows = timings.filter((t) => t.form === form);
    const people = [...new Set(rows.map((t) => t.participant))];
    const pick = (cond: string) => people.map((p) => Number(rows.find((r) => r.participant === p && r.condition === cond)?.seconds));
    const manual = pick('manual');
    const sf = pick('smartfill');
    if ([...manual, ...sf].some(Number.isNaN)) {
      console.log(`${form}: incomplete pairs, skipped`);
      continue;
    }
    const r = paired(manual, sf);
    console.log(`${form}: n=${r.n} manual=${r.meanManual.toFixed(0)}s smartfill=${r.meanSmartFill.toFixed(0)}s saved=${(r.timeSaved * 100).toFixed(0)}% diff=${r.meanDiff.toFixed(1)}s 95%CI [${r.ci95[0].toFixed(1)}, ${r.ci95[1].toFixed(1)}] t=${r.t.toFixed(2)}`);
  }
}
