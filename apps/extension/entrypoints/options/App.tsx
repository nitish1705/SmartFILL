import { useEffect, useMemo, useState } from 'react';
import { REGISTRY } from '@smartfill/core';
import { getProfile, saveProfile } from '@/lib/storage';

const GROUPS = [
  { id: 'personal', title: 'Personal' },
  { id: 'academic', title: 'Academic' },
  { id: 'professional', title: 'Professional' },
  { id: 'research', title: 'Research' },
] as const;

export function App() {
  const [group, setGroup] = useState<(typeof GROUPS)[number]['id']>('personal');
  const [values, setValues] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getProfile().then((p) => {
      setValues(p.values);
      setLoaded(true);
    });
  }, []);

  // Sensitive keys (e.g. student ID) are never filled, so there is no reason to store them.
  const keys = useMemo(
    () => REGISTRY.filter((d) => !d.sensitive && d.key.startsWith(`${group}.`)),
    [group],
  );

  const set = (key: string, v: string) => {
    setSaved(false);
    setValues((cur) => ({ ...cur, [key]: v }));
  };

  const save = async () => {
    const p = await saveProfile(values);
    setValues(p.values);
    setSaved(true);
  };

  if (!loaded) return null;

  return (
    <main className="options">
      <header>
        <h1>Your SmartFill profile</h1>
        <p className="muted">
          Only enter information you have verified. It is stored on this device and is never sent anywhere.
          Empty fields are never filled.
        </p>
      </header>

      <div className="tabs" role="tablist">
        {GROUPS.map((g) => (
          <button key={g.id} role="tab" aria-selected={group === g.id} onClick={() => setGroup(g.id)}>
            {g.title}
          </button>
        ))}
      </div>

      <div className="grid">
        {keys.map((d) => {
          const long = d.type === 'longtext';
          return (
            <label key={d.key} className={long ? 'wide' : undefined}>
              <span>{d.label}</span>
              {long ? (
                <textarea rows={3} value={values[d.key] ?? ''} onChange={(e) => set(d.key, e.target.value)} />
              ) : (
                <input
                  type={d.type === 'email' ? 'email' : d.type === 'tel' ? 'tel' : d.type === 'url' ? 'url' : 'text'}
                  value={values[d.key] ?? ''}
                  onChange={(e) => set(d.key, e.target.value)}
                  autoComplete="off"
                />
              )}
            </label>
          );
        })}
      </div>

      <div className="actions">
        <button className="primary" onClick={save}>Save profile</button>
        {saved && <span role="status" className="muted">Saved.</span>}
      </div>
    </main>
  );
}
