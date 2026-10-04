import { browser } from 'wxt/browser';
import {
  fieldSignature, getKeyDef, resolveFieldValues,
  type EmbeddingCandidate, type FieldInfo, type LlmRequest, type MatchResult,
} from '@smartfill/core';
import {
  analyzeDocumentAsync, applyResults, fillDetected, undoFill, watchForNewFields,
  type Analysis, type DetectedField, type FillRecord,
} from '@smartfill/dom';
import { openOverlay, type OverlayHandle } from '@/lib/overlay';
import { getSettings } from '@/lib/storage';
import type { PageData } from '@/lib/store';
import type { Counts, Response, Row } from '@/lib/messages';

/**
 * Injected on demand through activeTab when the user opens SmartFill.
 * Hard rule: this script writes field values only. It never submits forms, clicks buttons, or presses Enter.
 * It also never reads storage: personal data arrives from the background, scoped to what a page needs.
 */
declare global {
  interface Window {
    __smartfillLoaded?: boolean;
  }
}

let analysis: Analysis | null = null;
let undoStack: FillRecord[] = [];
let data: PageData = { values: {}, authors: [], mappings: [] };
let overlay: OverlayHandle | null = null;
let stopWatching: (() => void) | null = null;

class LockedPage extends Error {}

const rowLabel = (f: DetectedField) => {
  const c = f.context;
  return (c.label ?? c.ariaLabel ?? c.placeholder ?? c.nearbyText ?? c.name ?? c.id ?? 'Unlabelled field').slice(0, 80);
};

function summarize(a: Analysis): Extract<Response, { ok: true }> {
  const counts: Counts = { detected: a.fields.length, safe: 0, review: 0, ask: 0, unavailable: 0, blocked: 0 };
  const rows: Row[] = a.results.map((r: MatchResult, i) => {
    if (r.decision === 'auto') counts.safe++;
    else if (r.decision === 'review') counts.review++;
    else if (r.decision === 'ask') counts.ask++;
    else if (r.decision === 'blocked') counts.blocked++;
    else if (r.key) counts.unavailable++;
    return {
      fieldId: r.fieldId,
      label: rowLabel(a.fields[i]!),
      key: r.key,
      keyLabel: r.key ? getKeyDef(r.key)?.label : undefined,
      confidence: r.confidence,
      decision: r.decision,
      layer: r.layer,
      reason: r.reason,
      preview: r.preview,
    };
  });
  return { ok: true, rows, counts, submissionTitle: data.submissionTitle, authors: data.authors.length };
}

/** Ask the background (offscreen model) to rank the fields rules could not settle. Failure → rules only. */
async function rank(fields: FieldInfo[]): Promise<EmbeddingCandidate[][]> {
  // strip DOM references: only plain field descriptions leave the page script
  const plain = fields.map((f) => JSON.parse(JSON.stringify({ ...f, element: undefined, elements: undefined })) as FieldInfo);
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

async function loadPageData(): Promise<void> {
  const res = (await browser.runtime.sendMessage({ type: 'smartfill:data', origin: location.origin })) as
    | ({ ok: true } & PageData)
    | { ok: false; locked?: boolean; error: string }
    | undefined;
  if (!res?.ok) {
    if (res && 'locked' in res && res.locked) throw new LockedPage();
    throw new Error(res && 'error' in res ? res.error : 'no data');
  }
  data = res;
}

/** Profile values per field (author blocks map to their own author). */
const valuesOf = (a: Analysis) => resolveFieldValues(a.fields, { values: data.values, authors: data.authors });

let scanning: Promise<Analysis> | null = null;

async function scan(): Promise<Analysis> {
  // coalesce overlapping scans (watcher + popup) so results never interleave
  scanning ??= (async () => {
    const [, settings] = await Promise.all([loadPageData(), getSettings()]);
    const learned = new Map(data.mappings.map((m) => [m.sig, m.key]));
    const aiOn = settings.llm.enabled && settings.llm.provider !== 'off';
    analysis = await analyzeDocumentAsync(
      document,
      { values: data.values, authors: data.authors, thresholds: settings.thresholds },
      { rank, llm: aiOn ? llm : undefined, site: (f) => learned.get(fieldSignature(f)) },
    );
    return analysis;
  })().finally(() => {
    scanning = null;
  });
  return scanning;
}

function remember(field: DetectedField, key: string, source: 'user_correction' | 'user_confirmed') {
  void browser.runtime.sendMessage({
    type: 'smartfill:learn', origin: location.origin, sig: fieldSignature(field), key, label: rowLabel(field), source,
  });
}

/** After the first interaction, watch for fields that appear later (e.g. "Add author"). */
function startWatching() {
  if (stopWatching) return;
  stopWatching = watchForNewFields(document, async () => {
    try {
      const prev = new Set(analysis?.fields.map((f) => f.element));
      const fresh = await scan();
      const added = fresh.fields.filter((f) => !prev.has(f.element)).length;
      if (added > 0) {
        void browser.runtime.sendMessage({ type: 'smartfill:badge', count: added });
        overlay?.update(fresh, valuesOf(fresh));
      }
    } catch {
      /* locked or unavailable: stay quiet */
    }
  });
}

async function fillItems(items: { field: DetectedField; value: string; kind: 'auto' | 'review' }[]): Promise<number> {
  let n = 0;
  for (const i of items) {
    const rec = await fillDetected(i.field, i.value, i.kind);
    if (rec) {
      undoStack.push(rec);
      n++;
    }
  }
  return n;
}

async function onMessage(type: string): Promise<Response | { pong: true }> {
  try {
    switch (type) {
      case 'smartfill:ping':
        return { pong: true };
      case 'smartfill:scan': {
        const a = await scan();
        startWatching();
        return summarize(a);
      }
      case 'smartfill:fill': {
        // Re-scan first so we never write into stale elements or over text the user typed meanwhile.
        const records = await applyResults(await scan());
        undoStack = [...undoStack, ...records];
        startWatching();
        return { ...summarize(await scan()), filled: records.length };
      }
      case 'smartfill:review': {
        const a = await scan();
        startWatching();
        overlay = openOverlay({
          analysis: a,
          fieldValues: valuesOf(a),
          onFill: fillItems,
          onUndo: async () => {
            const n = undoFill(undoStack);
            undoStack = [];
            return n;
          },
          onCorrection: (f, key) => remember(f, key, 'user_correction'),
          onConfirm: (f, key) => remember(f, key, 'user_confirmed'),
          onClose: () => {
            overlay = null;
          },
        });
        return summarize(a);
      }
      case 'smartfill:undo': {
        const n = undoFill(undoStack);
        undoStack = [];
        return { ...summarize(await scan()), undone: n };
      }
      default:
        return { ok: false, error: 'unknown command' };
    }
  } catch (e) {
    if (e instanceof LockedPage) return { ok: false, error: 'SmartFill is locked. Unlock it from the popup.', locked: true };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const COMMANDS = new Set(['smartfill:ping', 'smartfill:scan', 'smartfill:fill', 'smartfill:review', 'smartfill:undo']);

export default defineUnlistedScript(() => {
  if (window.__smartfillLoaded) return;
  window.__smartfillLoaded = true;
  browser.runtime.onMessage.addListener((msg: unknown) => {
    const type = (msg as { type?: string } | undefined)?.type;
    return type && COMMANDS.has(type) ? onMessage(type) : undefined;
  });
});
