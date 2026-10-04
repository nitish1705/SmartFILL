import { browser } from 'wxt/browser';
import type { CommandMessage, Response } from '@/lib/messages';

const COMMANDS = new Set(['smartfill:scan', 'smartfill:fill', 'smartfill:undo']);

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

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg: unknown) => {
    const m = msg as Partial<CommandMessage> | undefined;
    if (!m?.type || !COMMANDS.has(m.type) || typeof m.tabId !== 'number') return undefined;
    return handle(m as CommandMessage);
  });
});
