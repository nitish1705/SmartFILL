/**
 * Passphrase-based encryption for the optional profile lock and encrypted exports.
 * PBKDF2-SHA256 → AES-256-GCM via WebCrypto (available in browsers, extension workers and Node 20).
 */

export interface EncryptedBlob {
  format: 'smartfill-encrypted';
  v: 1;
  iter: number;
  salt: string; // base64
  iv: string; // base64
  data: string; // base64 ciphertext+tag
}

export const PBKDF2_ITERATIONS = 210_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function deriveKey(passphrase: string, salt: Uint8Array, iter = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter },
    base,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function exportRawKey(key: CryptoKey): Promise<string> {
  return toB64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
}

export async function importRawKey(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromB64(b64) as BufferSource, 'AES-GCM', true, ['encrypt', 'decrypt']);
}

export function newSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export async function encryptWithKey(key: CryptoKey, value: unknown, salt: Uint8Array, iter = PBKDF2_ITERATIONS): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, enc.encode(JSON.stringify(value))),
  );
  return { format: 'smartfill-encrypted', v: 1, iter, salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}

export async function decryptWithKey(key: CryptoKey, blob: EncryptedBlob): Promise<unknown> {
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv) as BufferSource }, key, fromB64(blob.data) as BufferSource);
    return JSON.parse(dec.decode(plain));
  } catch {
    throw new Error('Wrong passphrase or corrupted data.');
  }
}

export async function encryptJson(passphrase: string, value: unknown): Promise<EncryptedBlob> {
  const salt = newSalt();
  return encryptWithKey(await deriveKey(passphrase, salt), value, salt);
}

export async function decryptJson(passphrase: string, blob: EncryptedBlob): Promise<unknown> {
  return decryptWithKey(await deriveKey(passphrase, fromB64(blob.salt), blob.iter), blob);
}

export function isEncryptedBlob(x: unknown): x is EncryptedBlob {
  const b = x as Partial<EncryptedBlob> | null;
  return !!b && b.format === 'smartfill-encrypted' && typeof b.data === 'string' && typeof b.iv === 'string' && typeof b.salt === 'string';
}
