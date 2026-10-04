import { browser } from 'wxt/browser';
import { DEFAULT_SETTINGS, ProfileSchema, SettingsSchema, emptyProfile, type Profile, type Settings } from '@smartfill/schemas';

export async function getProfile(): Promise<Profile> {
  const { profile } = await browser.storage.local.get('profile');
  const parsed = ProfileSchema.safeParse(profile);
  return parsed.success ? parsed.data : emptyProfile();
}

export async function saveProfile(values: Record<string, string>): Promise<Profile> {
  const cleaned = Object.fromEntries(
    Object.entries(values)
      .map(([k, v]) => [k, v.trim()] as const)
      .filter(([, v]) => v !== ''),
  );
  const profile: Profile = { ...(await getProfile()), values: cleaned, updatedAt: Date.now() };
  await browser.storage.local.set({ profile });
  return profile;
}

export async function getSettings(): Promise<Settings> {
  const { settings } = await browser.storage.local.get('settings');
  const parsed = SettingsSchema.safeParse(settings);
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ settings: SettingsSchema.parse(settings) });
}
