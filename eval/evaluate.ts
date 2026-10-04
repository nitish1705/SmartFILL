import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { analyzeDocument } from '@smartfill/dom';

const FIXTURES = join(__dirname, '..', 'fixtures', 'forms');
const profile: Record<string, string> = JSON.parse(readFileSync(join(__dirname, 'profile.json'), 'utf8'));

export interface Metrics {
  forms: number;
  fields: number;
  matchable: number;
  fills: number;
  correct: number;
  incorrect: number;
  unmatchable: number;
  unmatchableFilled: number;
  precision: number;
  recall: number;
  /** incorrect fills / total fields (primary metric) */
  falseAutofillRate: number;
  unknownSafetyRate: number;
  coverage: number;
  /** recall if "review" results were also filled */
  recallWithReview: number;
  problems: string[];
  rows: { form: string; ref: string; expected: string | null; got: string | null; decision: string; ok: boolean }[];
}

export function evaluate(): Metrics {
  const m: Metrics = {
    forms: 0, fields: 0, matchable: 0, fills: 0, correct: 0, incorrect: 0, unmatchable: 0, unmatchableFilled: 0,
    precision: 0, recall: 0, falseAutofillRate: 0, unknownSafetyRate: 1, coverage: 0, recallWithReview: 0,
    problems: [], rows: [],
  };
  let correctWithReview = 0;

  for (const file of readdirSync(FIXTURES).filter((f) => f.endsWith('.html')).sort()) {
    const truth: Record<string, string | null> = JSON.parse(
      readFileSync(join(FIXTURES, file.replace('.html', '.json')), 'utf8'),
    );
    const doc = new JSDOM(readFileSync(join(FIXTURES, file), 'utf8')).window.document;
    const { fields, results } = analyzeDocument(doc, { values: profile });
    m.forms++;
    const seen = new Set<string>();

    fields.forEach((f, i) => {
      const r = results[i]!;
      const ref = f.context.name ?? f.context.id ?? f.fieldId;
      seen.add(ref);
      if (!(ref in truth)) {
        m.problems.push(`${file}: detected field "${ref}" has no ground truth`);
        return;
      }
      const expected = truth[ref] ?? null;
      const matchable = expected !== null && expected in profile;
      m.fields++;
      const filled = r.decision === 'auto';
      const ok = filled ? r.key === expected : true;
      if (matchable) {
        m.matchable++;
        if (filled && r.key === expected) m.correct++;
        if ((filled || r.decision === 'review') && r.key === expected) correctWithReview++;
      } else {
        m.unmatchable++;
        if (filled) m.unmatchableFilled++;
      }
      if (filled) {
        m.fills++;
        if (r.key !== expected || !matchable) m.incorrect++;
      }
      m.rows.push({ form: file, ref, expected, got: r.key, decision: r.decision, ok });
    });
    for (const ref of Object.keys(truth)) {
      if (!seen.has(ref)) m.problems.push(`${file}: ground-truth field "${ref}" was not detected`);
    }
  }

  m.precision = m.fills ? (m.fills - m.incorrect) / m.fills : 1;
  m.recall = m.matchable ? m.correct / m.matchable : 1;
  m.recallWithReview = m.matchable ? correctWithReview / m.matchable : 1;
  m.falseAutofillRate = m.fields ? m.incorrect / m.fields : 0;
  m.unknownSafetyRate = m.unmatchable ? 1 - m.unmatchableFilled / m.unmatchable : 1;
  m.coverage = m.fields ? m.fills / m.fields : 0;
  return m;
}
