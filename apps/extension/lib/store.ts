import { browser } from 'wxt/browser';
import {
  decryptWithKey, deriveKey, encryptWithKey, exportRawKey, fromB64, importRawKey, isEncryptedBlob,
  type EncryptedBlob,
} from '@smartfill/core';
import {
  ProfileSchema, SiteMappingSchema, SubmissionSchema, emptyProfile,
  type Profile, type SiteMapping, type Submission,
} from '@smartfill/schemas';
import { z } from 'zod';

/**
 * All personal data lives in one `StoreData` object. It is stored in `storage.local` either as plain JSON
 * or, when the optional lock is on, only as an AES-GCM `vault` blob (the plaintext copy is removed). The
 * lock key is derived from the passphrase and kept in `storage.session` (memory only, cleared when the
 * browser closes, not readable by content scripts).
 */

export const StoreDataSchema = z.object({
  profiles: z.array(ProfileSchema).min(1),
  /** The profile of the person using SmartFill (the submitter). */
  activeProfileId: z.string(),
  submissions: z.array(SubmissionSchema),
  activeSubmissionId: z.string().optional(),
  siteMappings: z.record(z.string(), SiteMappingSchema),
});
export type StoreData = z.infer<typeof StoreDataSchema>;

export class LockedError extends Error {
  constructor() {
    super('SmartFill is locked.');
    this.name = 'LockedError';
  }
}

export function emptyData(): StoreData {
  const me = emptyProfile();
  return { profiles: [me], activeProfileId: me.id, submissions: [], siteMappings: {} };
}

const local = () => browser.storage.local;
const session = () => browser.storage.session;

async function readVault(): Promise<EncryptedBlob | null> {
  const { vault } = await local().get('vault');
  return isEncryptedBlob(vault) ? vault : null;
}

async function sessionKey(): Promise<CryptoKey | null> {
  const { lockKey } = await session().get('lockKey');
  return typeof lockKey === 'string' ? importRawKey(lockKey) : null;
}

export async function isLockEnabled(): Promise<boolean> {
  return (await readVault()) !== null;
}

export async function isLocked(): Promise<boolean> {
  return (await isLockEnabled()) && (await sessionKey()) === null;
}

/** Load (and migrate) the data. Throws `LockedError` while the vault is locked. */
export async function loadData(): Promise<StoreData> {
  const vault = await readVault();
  if (vault) {
    const key = await sessionKey();
    if (!key) throw new LockedError();
    return StoreDataSchema.parse(await decryptWithKey(key, vault));
  }
  const { data, profile } = await local().get(['data', 'profile']);
  const parsed = StoreDataSchema.safeParse(data);
  if (parsed.success) return parsed.data;
  // migrate the Phase 1 single-profile layout
  const legacy = ProfileSchema.safeParse(profile);
  const base = emptyData();
  if (legacy.success) return { ...base, profiles: [legacy.data], activeProfileId: legacy.data.id };
  return base;
}

export async function saveData(data: StoreData): Promise<void> {
  const clean = StoreDataSchema.parse(data);
  const vault = await readVault();
  if (vault) {
    const key = await sessionKey();
    if (!key) throw new LockedError();
    await local().set({ vault: await encryptWithKey(key, clean, fromB64(vault.salt), vault.iter) });
    return;
  }
  await local().set({ data: clean });
}

export async function enableLock(passphrase: string): Promise<void> {
  if (passphrase.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
  if (await isLockEnabled()) throw new Error('Lock is already enabled.');
  const data = await loadData();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  await local().set({ vault: await encryptWithKey(key, data, salt) });
  await session().set({ lockKey: await exportRawKey(key) });
  await local().remove(['data', 'profile']); // no plaintext copy remains
}

export async function unlock(passphrase: string): Promise<void> {
  const vault = await readVault();
  if (!vault) return;
  const key = await deriveKey(passphrase, fromB64(vault.salt), vault.iter);
  StoreDataSchema.parse(await decryptWithKey(key, vault)); // throws on wrong passphrase
  await session().set({ lockKey: await exportRawKey(key) });
}

export async function lockNow(): Promise<void> {
  await session().remove('lockKey');
}

export async function disableLock(passphrase: string): Promise<void> {
  await unlock(passphrase);
  const data = await loadData();
  await local().set({ data });
  await local().remove('vault');
  await session().remove('lockKey');
}

/** "Delete all data": wipes everything this extension stores. */
export async function deleteEverything(): Promise<void> {
  await local().clear();
  await session().clear();
}

// ── convenience helpers ──────────────────────────────────────────────────────────

export const newId = () => crypto.randomUUID();

export function activeProfile(d: StoreData): Profile {
  return d.profiles.find((p) => p.id === d.activeProfileId) ?? d.profiles[0]!;
}

export function activeSubmission(d: StoreData): Submission | undefined {
  return d.submissions.find((s) => s.id === d.activeSubmissionId);
}

export interface PageData {
  values: Record<string, string>;
  authors: { values: Record<string, string>; corresponding: boolean }[];
  submissionTitle?: string;
  /** Learned per-site rules that may be applied automatically. */
  mappings: { sig: string; key: string }[];
}

/** What the page script is allowed to know: values of the person + ordered authors + this origin's rules. */
export function pageData(d: StoreData, origin: string): PageData {
  const sub = activeSubmission(d);
  const authors = sub
    ? [...sub.authors]
        .sort((a, b) => a.order - b.order)
        .map((a) => ({ values: d.profiles.find((p) => p.id === a.profileId)?.values ?? {}, corresponding: a.corresponding }))
    : [];
  const mappings = Object.values(d.siteMappings)
    .filter((m) => m.origin === origin && (m.source === 'user_correction' || m.hits >= 2))
    .map((m) => ({ sig: m.fieldSignature, key: m.key }));
  return { values: activeProfile(d).values, authors, submissionTitle: sub?.title, mappings };
}

export function learn(
  d: StoreData,
  m: { origin: string; sig: string; key: string; label?: string; source: SiteMapping['source'] },
): StoreData {
  const id = `${m.origin}|${m.sig}`;
  const prev = d.siteMappings[id];
  const same = prev?.key === m.key;
  const next: SiteMapping = {
    origin: m.origin,
    fieldSignature: m.sig,
    label: m.label?.slice(0, 80),
    key: m.key,
    // a correction always outranks earlier confirmations
    source: m.source === 'user_correction' || !same ? m.source : (prev?.source ?? m.source),
    hits: same ? (prev?.hits ?? 0) + 1 : 1,
    updatedAt: Date.now(),
  };
  return { ...d, siteMappings: { ...d.siteMappings, [id]: next } };
}
