import { browser } from 'wxt/browser';
import type { FieldInfo } from '@smartfill/core';
import type { LlmRequest } from '@smartfill/core';
import { callLlm, originPattern, validateEndpoint } from '@/lib/llm';
import { getSettings } from '@/lib/storage';
import { LockedError, learn, loadData, pageData, saveData } from '@/lib/store';
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

/** Constrained-LLM fallback. The request holds only field descriptions + candidate keys. */
async function llm(request: LlmRequest) {
  const { llm: cfg } = await getSettings();
  const url = validateEndpoint(cfg.endpoint, cfg.provider);
  if (!(await browser.permissions.contains({ origins: [originPattern(url)] }))) {
    throw new Error('Permission for the AI endpoint has not been granted.');
  }
  // keep the last payload so the user can inspect exactly what left the device
  await browser.storage.local.set({ lastLlmPayload: { at: Date.now(), provider: cfg.provider, request } });
  return callLlm(cfg, request);
}

/** Page scripts never read storage; they get exactly what they need through here. */
async function dataFor(origin: string) {
  try {
    return { ok: true as const, ...pageData(await loadData(), origin) };
  } catch (e) {
    if (e instanceof LockedError) return { ok: false as const, locked: true, error: 'locked' };
    throw e;
  }
}

async function remember(m: { origin: string; sig: string; key: string; label?: string; source: 'user_correction' | 'user_confirmed' }) {
  if (!(await getSettings()).learning.enabled) return { ok: false as const };
  await saveData(learn(await loadData(), m));
  return { ok: true as const };
}

export default defineBackground(() => {
  // First run: open the welcome flow.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void browser.runtime.openOptionsPage();
  });

  browser.runtime.onMessage.addListener((msg: unknown, sender: { tab?: { id?: number } }) => {
    const m = msg as { type?: string; tabId?: number; fields?: FieldInfo[] } | undefined;
    if (!m?.type) return undefined;
    if (m.type === 'smartfill:data') {
      return dataFor((m as unknown as { origin: string }).origin).catch((e: unknown) => ({ ok: false, error: String(e) }));
    }
    if (m.type === 'smartfill:learn') {
      return remember(m as never).catch(() => ({ ok: false }));
    }
    if (m.type === 'smartfill:badge') {
      const tabId = sender.tab?.id;
      const count = (m as unknown as { count: number }).count;
      if (tabId !== undefined) {
        void browser.action.setBadgeText({ tabId, text: count > 0 ? `+${count}` : '' });
        void browser.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' });
      }
      return undefined;
    }
    if (m.type === 'smartfill:rank' && m.fields) {
      return rank(m.fields)
        .then((ranked) => ({ ok: true, ranked }))
        .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    }
    if (m.type === 'smartfill:llm') {
      return llm((m as unknown as { request: LlmRequest }).request)
        .then((raw) => ({ ok: true, raw }))
        .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
    }
    if (COMMANDS.has(m.type) && typeof m.tabId === 'number') return handle(m as CommandMessage);
    return undefined;
  });
});
