import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, SettingsSchema, type Settings } from '@smartfill/schemas';

/** Non-personal preferences. Personal data lives in `store.ts` (optionally encrypted). */
export async function getSettings(): Promise<Settings> {
  const { settings } = await browser.storage.local.get('settings');
  const parsed = SettingsSchema.safeParse(settings);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ settings: SettingsSchema.parse(settings) });
}
