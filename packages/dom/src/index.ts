import { matchFields, matchFieldsAsync, type MatchOptions, type MatchResult, type MatchServices } from '@smartfill/core';
import { detectFields, type DetectedField } from './detector';
import { fillDetected, type FillRecord } from './filler';

export { detectFields, watchForNewFields, type DetectedField } from './detector';
export { fillField, fillDetected, undoFill, type FillRecord, type HighlightKind } from './filler';

export interface Analysis {
  fields: DetectedField[];
  results: MatchResult[];
}

/** Detect → match. Pure with respect to the page (nothing is written). */
export function analyzeDocument(doc: Document, options: MatchOptions): Analysis {
  const fields = detectFields(doc);
  return { fields, results: matchFields(fields, options) };
}

/** Detect → match with the full cascade (site memory, rules, embeddings). */
export async function analyzeDocumentAsync(
  doc: Document,
  options: MatchOptions,
  services: MatchServices,
): Promise<Analysis> {
  const fields = detectFields(doc);
  return { fields, results: await matchFieldsAsync(fields, options, services) };
}

/** Fill every field whose decision is in `decisions` (default: only `auto`). */
export async function applyResults(
  analysis: Analysis,
  decisions: ReadonlySet<MatchResult['decision']> = new Set(['auto']),
  only?: ReadonlySet<string>,
): Promise<FillRecord[]> {
  const byId = new Map(analysis.fields.map((f) => [f.fieldId, f]));
  const records: FillRecord[] = [];
  for (const r of analysis.results) {
    if (!decisions.has(r.decision) || r.value === undefined) continue;
    if (only && !only.has(r.fieldId)) continue;
    const f = byId.get(r.fieldId);
    if (!f?.element.isConnected) continue;
    const rec = await fillDetected(f, r.value, r.decision === 'auto' ? 'auto' : 'review');
    if (rec) records.push(rec);
  }
  return records;
}
