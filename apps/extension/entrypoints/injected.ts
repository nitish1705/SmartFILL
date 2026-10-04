import { browser } from 'wxt/browser';
import { getKeyDef, type MatchResult } from '@smartfill/core';
import { analyzeDocumentAsync, applyResults, fillField, undoFill, type Analysis, type FillRecord } from '@smartfill/dom';
import type { EmbeddingCandidate, FieldInfo, LlmRequest } from '@smartfill/core';
import { openOverlay } from '@/lib/overlay';
import { getProfile, getSettings } from '@/lib/storage';
import type { Counts, Response, Row } from '@/lib/messages';

/**
 * Injected on demand through activeTab when the user opens SmartFill.
 * Hard rule: this script writes field values only. It never clicks, submits, or presses keys.
 */
declare global {
  interface Window {
    __smartfillLoaded?: boolean;
  }
}

let analysis: Analysis | null = null;
let undoStack: FillRecord[] = [];

function rowLabel(a: Analysis, r: MatchResult): string {
  const c = a.fields.find((f) => f.fieldId === r.fieldId)!.context;
  return (c.label ?? c.ariaLabel ?? c.placeholder ?? c.nearbyText ?? c.name ?? c.id ?? 'Unlabelled field').slice(0, 80);
}

function summarize(a: Analysis): Response {
  const counts: Counts = { detected: a.fields.length, safe: 0, review: 0, ask: 0, unavailable: 0, blocked: 0 };
  const rows: Row[] = a.results.map((r) => {
    if (r.decision === 'auto') counts.safe++;
    else if (r.decision === 'review') counts.review++;
    else if (r.decision === 'ask') counts.ask++;
    else if (r.decision === 'blocked') counts.blocked++;
    else if (r.key) counts.unavailable++;
    return {
      fieldId: r.fieldId,
      label: rowLabel(a, r),
      key: r.key,
      keyLabel: r.key ? getKeyDef(r.key)?.label : undefined,
      confidence: r.confidence,
      decision: r.decision,
      layer: r.layer,
      reason: r.reason,
      preview: r.preview,
    };
  });
  return { ok: true, rows, counts };
}

/** Ask the background (offscreen model) to rank the fields rules could not settle. Failure → rules only. */
async function rank(fields: FieldInfo[]): Promise<EmbeddingCandidate[][]> {
  // strip DOM references: only plain field descriptions leave the page script
  const plain = fields.map((f) => JSON.parse(JSON.stringify({ ...f, element: undefined })) as FieldInfo);
  const res = (await browser.runtime.sendMessage({ type: 'smartfill:rank', fields: plain })) as
    | { ok: true; ranked: EmbeddingCandidate[][] }
    | { ok: false; error: string }
    | undefined;
  if (!res?.ok) throw new Error(res?.ok === false ? res.error : 'embedding unavailable');
  return res.ranked;
}

async function llm(request: LlmRequest): Promise<unknown> {
  const res = (await browser.runtime.sendMessage({ type: 'smartfill:llm', request })) as
    | { ok: true; raw: unknown }
    | { ok: false; error: string }
    | undefined;
  if (!res?.ok) throw new Error(res?.ok === false ? res.error : 'LLM unavailable');
  return res.raw;
}

let values: Record<string, string> = {};

async function scan(): Promise<Analysis> {
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  values = profile.values;
  const aiOn = settings.llm.enabled && settings.llm.provider !== 'off';
  analysis = await analyzeDocumentAsync(document, { values, thresholds: settings.thresholds }, { rank, llm: aiOn ? llm : undefined });
  return analysis;
}

async function onMessage(type: string): Promise<Response | { pong: true }> {
  switch (type) {
    case 'smartfill:ping':
      return { pong: true };
    case 'smartfill:scan':
      return summarize(await scan());
    case 'smartfill:fill': {
      // Re-scan first so we never write into stale elements or over text the user typed meanwhile.
      const records = applyResults(await scan());
      undoStack = [...undoStack, ...records];
      return { ...(summarize(await scan()) as Extract<Response, { ok: true }>), filled: records.length };
    }
    case 'smartfill:review': {
      const a = await scan();
      openOverlay({
        analysis: a,
        values,
        onFill: async (items) => {
          const records = items.map((i) => fillField(i.field.element, i.value, i.kind));
          undoStack = [...undoStack, ...records];
          return records.length;
        },
        onUndo: async () => {
          const n = undoFill(undoStack);
          undoStack = [];
          return n;
        },
      });
      return summarize(a);
    }
    case 'smartfill:undo': {
      const n = undoFill(undoStack);
      undoStack = [];
      return { ...(summarize(await scan()) as Extract<Response, { ok: true }>), undone: n };
    }
    default:
      return { ok: false, error: 'unknown command' };
  }
}

export default defineUnlistedScript(() => {
  if (window.__smartfillLoaded) return;
  window.__smartfillLoaded = true;
  browser.runtime.onMessage.addListener((msg: unknown) => {
    const type = (msg as { type?: string } | undefined)?.type;
    if (!type?.startsWith('smartfill:')) return undefined;
    return onMessage(type);
  });
});
