import { matchFields, type MatchOptions, type MatchResult } from '@smartfill/core';
import { detectFields, type DetectedField } from './detector';
import { fillField, type FillRecord } from './filler';

export { detectFields, type DetectedField } from './detector';
export { fillField, undoFill, type FillRecord, type HighlightKind } from './filler';

export interface Analysis {
  fields: DetectedField[];
  results: MatchResult[];
}

/** Detect → match. Pure with respect to the page (nothing is written). */
export function analyzeDocument(doc: Document, options: MatchOptions): Analysis {
  const fields = detectFields(doc);
  return { fields, results: matchFields(fields, options) };
}

/** Fill every field whose decision is in `decisions` (default: only `auto`). */
export function applyResults(
  analysis: Analysis,
  decisions: ReadonlySet<MatchResult['decision']> = new Set(['auto']),
  only?: ReadonlySet<string>,
): FillRecord[] {
  const byId = new Map(analysis.fields.map((f) => [f.fieldId, f]));
  const records: FillRecord[] = [];
  for (const r of analysis.results) {
    if (!decisions.has(r.decision) || r.value === undefined) continue;
    if (only && !only.has(r.fieldId)) continue;
    const f = byId.get(r.fieldId);
    if (!f?.element.isConnected) continue;
    records.push(fillField(f.element, r.value, r.decision === 'auto' ? 'auto' : 'review'));
  }
  return records;
}
