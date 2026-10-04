import { browser } from 'wxt/browser';
import { getKeyDef, type MatchResult } from '@smartfill/core';
import { analyzeDocument, applyResults, undoFill, type Analysis, type FillRecord } from '@smartfill/dom';
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
      reason: r.reason,
      preview: r.preview,
    };
  });
  return { ok: true, rows, counts };
}

async function scan(): Promise<Analysis> {
  const [profile, settings] = await Promise.all([getProfile(), getSettings()]);
  analysis = analyzeDocument(document, { values: profile.values, thresholds: settings.thresholds });
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
