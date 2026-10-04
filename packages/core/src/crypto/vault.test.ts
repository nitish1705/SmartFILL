import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson, isEncryptedBlob } from './vault';

describe('vault', () => {
  const data = { profiles: [{ id: 'me', values: { 'personal.email': 'ada@example.edu' } }] };

  it('round-trips with the right passphrase', async () => {
    const blob = await encryptJson('correct horse', data);
    expect(isEncryptedBlob(blob)).toBe(true);
    expect(JSON.stringify(blob)).not.toContain('ada@example.edu');
    expect(await decryptJson('correct horse', blob)).toEqual(data);
  });

  it('rejects a wrong passphrase and tampered data', async () => {
    const blob = await encryptJson('correct horse', data);
    await expect(decryptJson('wrong', blob)).rejects.toThrow(/passphrase/);
    const bytes = atob(blob.data).split('');
    bytes[0] = String.fromCharCode(bytes[0]!.charCodeAt(0) ^ 1);
    await expect(decryptJson('correct horse', { ...blob, data: btoa(bytes.join('')) })).rejects.toThrow();
  });

  it('uses a fresh salt and iv every time', async () => {
    const a = await encryptJson('p', data);
    const b = await encryptJson('p', data);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });
});
