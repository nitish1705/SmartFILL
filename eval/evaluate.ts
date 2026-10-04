import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import type { Embedder, LlmRequest, MatchResult } from '@smartfill/core';
import { analyzeDocument, analyzeDocumentAsync, detectFields, type Analysis } from '@smartfill/dom';

const SETS = {
  /** Development set: used while building rules and calibrating embeddings. */
  dev: join(__dirname, '..', 'fixtures', 'forms'),
  /** Held-out test set: written after the rules were frozen; never used for tuning. */
  test: join(__dirname, '..', 'fixtures', 'test'),
} as const;
export type FixtureSet = keyof typeof SETS;
export const profile: Record<string, string> = JSON.parse(readFileSync(join(__dirname, 'profile.json'), 'utf8'));

export interface EvalOptions {
  set?: FixtureSet;
  /** LLM service; `ctx.lookup(fieldId)` maps a request field id back to `${form}|${ref}` (for oracles). */
  llm?: (request: LlmRequest, ctx: { lookup: (fieldId: string) => string }) => Promise<unknown>;
  /** Enable the embedding layer with this embedder. */
  embedder?: Embedder;
  /** Learned site mappings for the second-visit simulation: `${form}|${ref}` → key. */
  learned?: Map<string, string>;
  thresholds?: { auto: number; review: number; ask: number };
}

export interface Row {
  form: string;
  ref: string;
  expected: string | null;
  got: string | null;
  decision: string;
  layer: string;
  confidence: number;
  matchable: boolean;
  ok: boolean;
}

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
  /** precision over auto + review fills (what the review overlay writes once confirmed) */
  precisionWithReview: number;
  /** wall-clock ms per form (median) */
  medianMs: number;
  problems: string[];
  rows: Row[];
}

export function loadFixtures(set: FixtureSet = 'dev'): { file: string; html: string; truth: Record<string, string | null> }[] {
  const FIXTURES = SETS[set];
  return readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((file) => ({
      file,
      html: readFileSync(join(FIXTURES, file), 'utf8'),
      truth: JSON.parse(readFileSync(join(FIXTURES, file.replace('.html', '.json')), 'utf8')),
    }));
}

export const refOf = (c: { name?: string; id?: string }, fallback: string) => c.name ?? c.id ?? fallback;

export async function evaluate(opts: EvalOptions = {}): Promise<Metrics> {
  const m: Metrics = {
    forms: 0, fields: 0, matchable: 0, fills: 0, correct: 0, incorrect: 0, unmatchable: 0, unmatchableFilled: 0,
    precision: 0, recall: 0, falseAutofillRate: 0, unknownSafetyRate: 1, coverage: 0, recallWithReview: 0, precisionWithReview: 1,
    medianMs: 0, problems: [], rows: [],
  };
  let correctWithReview = 0;
  let fillsWithReview = 0;
  const times: number[] = [];

  for (const { file, html, truth } of loadFixtures(opts.set)) {
    const doc = new JSDOM(html).window.document;
    const t0 = performance.now();
    let analysis: Analysis;
    let analysisFields: Analysis['fields'] = [];
    const matchOpts = { values: profile, thresholds: opts.thresholds };
    if (opts.embedder || opts.learned || opts.llm) {
      const detected = detectFields(doc);
      analysisFields = detected;
      analysis = await analyzeDocumentAsync(doc, matchOpts, {
        embed: opts.embedder,
        llm: opts.llm
          ? (req) => opts.llm!(req, { lookup: (id) => { const f = analysisFields.find((x) => x.fieldId === id)!; return `${file}|${refOf(f.context, f.fieldId)}`; } })
          : undefined,
        site: opts.learned
          ? (f) => opts.learned!.get(`${file}|${refOf(f.context, f.fieldId)}`)
          : undefined,
      });
    } else {
      analysis = analyzeDocument(doc, matchOpts);
    }
    times.push(performance.now() - t0);
    m.forms++;
    const seen = new Set<string>();

    analysis.fields.forEach((f, i) => {
      const r: MatchResult = analysis.results[i]!;
      const ref = refOf(f.context, f.fieldId);
      seen.add(ref);
      if (!(ref in truth)) {
        m.problems.push(`${file}: detected field "${ref}" has no ground truth`);
        return;
      }
      const expected = truth[ref] ?? null;
      const matchable = expected !== null && expected in profile;
      m.fields++;
      const filled = r.decision === 'auto';
      if (r.decision === 'auto' || r.decision === 'review') fillsWithReview += r.value !== undefined ? 1 : 0;
      if (matchable) {
        m.matchable++;
        if (filled && r.key === expected) m.correct++;
        if ((filled || r.decision === 'review') && r.key === expected && r.value !== undefined) correctWithReview++;
      } else {
        m.unmatchable++;
        if (filled) m.unmatchableFilled++;
      }
      if (filled) {
        m.fills++;
        if (r.key !== expected || !matchable) m.incorrect++;
      }
      m.rows.push({
        form: file, ref, expected, got: r.key, decision: r.decision, layer: r.layer, confidence: r.confidence,
        matchable, ok: filled ? r.key === expected && matchable : true,
      });
    });
    for (const ref of Object.keys(truth)) {
      if (!seen.has(ref)) m.problems.push(`${file}: ground-truth field "${ref}" was not detected`);
    }
  }

  m.precision = m.fills ? (m.fills - m.incorrect) / m.fills : 1;
  m.recall = m.matchable ? m.correct / m.matchable : 1;
  m.recallWithReview = m.matchable ? correctWithReview / m.matchable : 1;
  m.precisionWithReview = fillsWithReview ? correctWithReview / fillsWithReview : 1;
  m.falseAutofillRate = m.fields ? m.incorrect / m.fields : 0;
  m.unknownSafetyRate = m.unmatchable ? 1 - m.unmatchableFilled / m.unmatchable : 1;
  m.coverage = m.fields ? m.fills / m.fields : 0;
  times.sort((a, b) => a - b);
  m.medianMs = times[Math.floor(times.length / 2)] ?? 0;
  return m;
}

/** Risk–coverage curve: vary the auto threshold over recorded confidences (decisions ≥ ask only). */
export function riskCoverage(rows: Row[], steps = 20): { threshold: number; coverage: number; far: number }[] {
  const candidates = rows.filter((r) => r.got !== null && ['auto', 'review', 'ask'].includes(r.decision));
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const t = 0.5 + (0.5 * i) / steps;
    const filled = candidates.filter((r) => r.confidence >= t);
    const wrong = filled.filter((r) => !(r.got === r.expected && r.matchable)).length;
    out.push({ threshold: Math.round(t * 1000) / 1000, coverage: filled.length / (rows.length || 1), far: wrong / (rows.length || 1) });
  }
  return out;
}

/** What a user still has to do by hand: matchable fields not auto-filled correctly, plus any wrong auto-fill. */
export function correctionsNeeded(m: Metrics): number {
  return m.rows.filter((r) => (r.matchable && !(r.decision === 'auto' && r.got === r.expected)) || (r.decision === 'auto' && !r.ok)).length;
}

/** Second-visit simulation: the user corrects every field the first visit got wrong or left open; those become site rules. */
export function learnFromCorrections(m: Metrics): Map<string, string> {
  const learned = new Map<string, string>();
  for (const r of m.rows) {
    if (r.matchable && r.expected && !(r.decision === 'auto' && r.got === r.expected)) learned.set(`${r.form}|${r.ref}`, r.expected);
  }
  return learned;
}
