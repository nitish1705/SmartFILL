import { browser } from 'wxt/browser';
import type { FieldInfo } from '@smartfill/core';
import type { CommandMessage, Response } from '@/lib/messages';

const COMMANDS = new Set(['smartfill:scan', 'smartfill:fill', 'smartfill:undo', 'smartfill:review']);

/** Inject the page script on demand (activeTab); a ping tells us if it is already there. */
async function ensureInjected(tabId: number): Promise<void> {
  try {
    await browser.tabs.sendMessage(tabId, { type: 'smartfill:ping' });
  } catch {
    await browser.scripting.executeScript({ target: { tabId }, files: ['/injected.js'] });
  }
}

async function handle(msg: CommandMessage): Promise<Response> {
  try {
    await ensureInjected(msg.tabId);
    return (await browser.tabs.sendMessage(msg.tabId, { type: msg.type })) as Response;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Cannot access this page.' };
  }
}

// ── embeddings: the offscreen document hosts the model ─────────────────────────
let creating: Promise<void> | null = null;
async function ensureOffscreen(): Promise<void> {
  const contexts = await browser.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT' as never] });
  if (contexts.length > 0) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS' as chrome.offscreen.Reason],
      justification: 'Run the local embedding model that matches form fields to profile keys.',
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

async function rank(fields: FieldInfo[]) {
  await ensureOffscreen();
  const res = (await browser.runtime.sendMessage({ target: 'offscreen', type: 'rank', fields })) as
    | { ok: true; ranked: unknown }
    | { ok: false; error: string }
    | undefined;
  if (!res?.ok) throw new Error(res?.ok === false ? res.error : 'embedding unavailable');
  return res.ranked;
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: unknown) => {
    const m = msg as { type?: string; tabId?: number; fields?: FieldInfo[] } | undefined;
    if (!m?.type) return undefined;
    if (m.type === 'smartfill:rank' && m.fields) {
      return rank(m.fields)
        .then((ranked) => ({ ok: true, ranked }))
        .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    }
    if (COMMANDS.has(m.type) && typeof m.tabId === 'number') return handle(m as CommandMessage);
    return undefined;
  });
});
