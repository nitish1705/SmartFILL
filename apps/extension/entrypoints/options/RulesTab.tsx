import { useEffect, useState } from 'react';
import { getKeyDef } from '@smartfill/core';
import type { Settings } from '@smartfill/schemas';
import { getSettings, saveSettings } from '@/lib/storage';
import type { StoreData } from '@/lib/store';

interface Props {
  data: StoreData;
  update: (fn: (d: StoreData) => StoreData) => Promise<void>;
}

export function RulesTab({ data, update }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => void getSettings().then(setSettings), []);
  const rules = Object.entries(data.siteMappings).sort(([, a], [, b]) => b.updatedAt - a.updatedAt);

  const toggle = async (on: boolean) => {
    if (!settings) return;
    const next = { ...settings, learning: { enabled: on } };
    setSettings(next);
    await saveSettings(next);
  };

  return (
    <section aria-labelledby="rules-h" style={{ display: 'grid', gap: 16 }}>
      <header>
        <h1 id="rules-h">Learned site rules</h1>
        <p className="muted">
          When learning is on, SmartFill remembers a correction you make in the review panel (which profile field a form field
          means, or “never fill this”) for that site only. Only the field’s label and your chosen field name are stored — never values.
        </p>
      </header>

      <label>
        <input type="checkbox" style={{ width: 'auto' }} checked={settings?.learning.enabled ?? false} onChange={(e) => toggle(e.target.checked)} />{' '}
        Learn from my corrections (off by default)
      </label>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr><th scope="col">Site</th><th scope="col">Field</th><th scope="col">Meaning</th><th scope="col">Source</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
        </thead>
        <tbody>
          {rules.map(([id, r]) => (
            <tr key={id}>
              <td>{r.origin.replace(/^https?:\/\//, '')}</td>
              <td>{r.label ?? '(unlabelled)'}</td>
              <td>{r.key === 'IGNORE' ? 'Never fill' : getKeyDef(r.key)?.label ?? r.key}</td>
              <td>{r.source === 'user_correction' ? 'correction' : `confirmed ×${r.hits}`}</td>
              <td><button aria-label={`Forget rule for ${r.label ?? 'field'} on ${r.origin}`} onClick={() => update((d) => { const { [id]: _gone, ...rest } = d.siteMappings; return { ...d, siteMappings: rest }; })}>Forget</button></td>
            </tr>
          ))}
          {rules.length === 0 && <tr><td colSpan={5} className="muted">Nothing learned yet.</td></tr>}
        </tbody>
      </table>
      {rules.length > 0 && (
        <div className="actions">
          <button onClick={() => window.confirm('Forget all learned site rules?') && update((d) => ({ ...d, siteMappings: {} }))}>Forget all</button>
        </div>
      )}
    </section>
  );
}
