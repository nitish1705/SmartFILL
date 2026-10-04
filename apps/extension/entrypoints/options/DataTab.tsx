import { useEffect, useState } from 'react';
import { decryptJson, encryptJson, isEncryptedBlob } from '@smartfill/core';
import {
  StoreDataSchema, deleteEverything, disableLock, enableLock, isLockEnabled, lockNow, saveData, type StoreData,
} from '@/lib/store';

interface Props {
  data: StoreData;
  reload: () => Promise<void>;
}

const FORMAT = 'smartfill-export';

function download(name: string, json: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function DataTab({ data, reload }: Props) {
  const [msg, setMsg] = useState('');
  const [expPass, setExpPass] = useState('');
  const [impPass, setImpPass] = useState('');
  const [needPass, setNeedPass] = useState<File | null>(null);
  const [lockOn, setLockOn] = useState<boolean | null>(null);
  const [pass1, setPass1] = useState('');
  const [pass2, setPass2] = useState('');

  useEffect(() => {
    void isLockEnabled().then(setLockOn);
  }, []);
  const say = (m: string) => setMsg(m);
  const guard = (fn: () => Promise<void>) => async () => {
    try {
      await fn();
    } catch (e) {
      say(e instanceof Error ? e.message : String(e));
    }
  };

  const doExport = guard(async () => {
    const payload = { format: FORMAT, v: 1, exportedAt: new Date().toISOString(), data };
    if (expPass) {
      if (expPass.length < 8) throw new Error('Use a passphrase of at least 8 characters.');
      download('smartfill-export.encrypted.json', await encryptJson(expPass, payload));
      say('Exported an encrypted file. Keep the passphrase safe — it cannot be recovered.');
    } else {
      download('smartfill-export.json', payload);
      say('Exported. This file is NOT encrypted: it contains your profile in plain text.');
    }
    setExpPass('');
  });

  const doImport = async (file: File, passphrase?: string) => {
    try {
      let parsed: unknown = JSON.parse(await file.text());
      if (isEncryptedBlob(parsed)) {
        if (!passphrase) {
          setNeedPass(file);
          return say('This file is encrypted. Enter its passphrase and press Import again.');
        }
        parsed = await decryptJson(passphrase, parsed);
      }
      const p = parsed as { format?: string; data?: unknown };
      if (p.format !== FORMAT) throw new Error('This is not a SmartFill export.');
      const imported: StoreData = StoreDataSchema.parse(p.data);
      if (!window.confirm(`Replace your current data with ${imported.profiles.length} profile(s) and ${imported.submissions.length} submission(s) from this file?`)) return;
      await saveData(imported);
      await reload();
      setNeedPass(null);
      setImpPass('');
      say('Imported.');
    } catch (e) {
      say(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  return (
    <section aria-labelledby="data-h" style={{ display: 'grid', gap: 24 }}>
      <header>
        <h1 id="data-h">Data &amp; privacy</h1>
        <p className="muted">
          Everything stays on this device. SmartFill has no account, no analytics and no server.{' '}
          <a href="privacy.html" target="_blank" rel="noreferrer">Read the privacy policy</a>.
        </p>
      </header>

      <div role="status" aria-live="polite" className="muted">{msg}</div>

      <fieldset>
        <legend>Export</legend>
        <div className="grid">
          <label className="wide">
            Passphrase (optional — encrypts the file)
            <input type="password" autoComplete="new-password" value={expPass} onChange={(e) => setExpPass(e.target.value)} />
          </label>
        </div>
        <p><button onClick={doExport}>Export profiles, submissions and rules</button></p>
      </fieldset>

      <fieldset>
        <legend>Import</legend>
        <div className="grid">
          <label>
            File
            <input type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && void doImport(e.target.files[0])} />
          </label>
          {needPass && (
            <label>
              Passphrase of the file
              <input type="password" autoComplete="off" value={impPass} onChange={(e) => setImpPass(e.target.value)} />
            </label>
          )}
        </div>
        {needPass && <p><button onClick={() => void doImport(needPass, impPass)}>Import</button></p>}
      </fieldset>

      <fieldset>
        <legend>Lock</legend>
        {lockOn === false && (
          <>
            <p className="muted">
              Encrypt your profiles at rest with a passphrase (AES-256-GCM). After the browser restarts you unlock once from
              the SmartFill popup. If you forget the passphrase the data cannot be recovered.
            </p>
            <div className="grid">
              <label>New passphrase (8+ characters)<input type="password" autoComplete="new-password" value={pass1} onChange={(e) => setPass1(e.target.value)} /></label>
              <label>Repeat passphrase<input type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} /></label>
            </div>
            <p>
              <button
                disabled={!pass1 || pass1 !== pass2}
                onClick={guard(async () => {
                  await enableLock(pass1);
                  setPass1(''); setPass2(''); setLockOn(true);
                  say('Lock enabled. Your data is now encrypted at rest.');
                })}
              >Enable lock</button>
            </p>
          </>
        )}
        {lockOn === true && (
          <>
            <p className="muted">Your data is encrypted at rest.</p>
            <p>
              <button onClick={guard(async () => { await lockNow(); await reload(); })}>Lock now</button>{' '}
              <button
                onClick={guard(async () => {
                  const p = window.prompt('Enter your passphrase to remove the lock');
                  if (!p) return;
                  await disableLock(p);
                  setLockOn(false);
                  say('Lock removed. Your data is stored unencrypted again.');
                })}
              >Remove lock…</button>
            </p>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>Delete everything</legend>
        <p className="muted">Removes all profiles, submissions, learned rules and settings from this browser.</p>
        <button
          onClick={guard(async () => {
            if (!window.confirm('Delete ALL SmartFill data from this browser? This cannot be undone.')) return;
            await deleteEverything();
            await reload();
            say('All SmartFill data has been deleted.');
          })}
        >Delete all data</button>
      </fieldset>
    </section>
  );
}
