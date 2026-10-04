import { useEffect, useMemo, useState } from 'react';
import { REGISTRY } from '@smartfill/core';
import type { Profile } from '@smartfill/schemas';
import { newId, type StoreData } from '@/lib/store';

const GROUPS = [
  { id: 'personal', title: 'Personal' },
  { id: 'academic', title: 'Academic' },
  { id: 'professional', title: 'Professional' },
  { id: 'research', title: 'Research' },
] as const;

interface Props {
  data: StoreData;
  update: (fn: (d: StoreData) => StoreData) => Promise<void>;
}

export function ProfilesTab({ data, update }: Props) {
  const [selectedId, setSelectedId] = useState(data.activeProfileId);
  const selected = data.profiles.find((p) => p.id === selectedId) ?? data.profiles[0]!;
  const [draft, setDraft] = useState<Profile>(selected);
  const [group, setGroup] = useState<(typeof GROUPS)[number]['id']>('personal');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(selected);
    setSaved(false);
    // reload the draft only when switching profile, not when unrelated data (site rules) changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.id]);

  // Sensitive keys (e.g. student ID) are never filled, so there is no reason to store them.
  const keys = useMemo(() => REGISTRY.filter((d) => !d.sensitive && d.type !== 'boolean' && d.key.startsWith(`${group}.`)), [group]);
  const set = (key: string, v: string) => {
    setSaved(false);
    setDraft((cur) => ({ ...cur, values: { ...cur.values, [key]: v } }));
  };

  const save = async () => {
    const values = Object.fromEntries(Object.entries(draft.values).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== ''));
    await update((d) => ({
      ...d,
      profiles: d.profiles.map((p) => (p.id === draft.id ? { ...draft, values, name: draft.name.trim() || 'Unnamed', updatedAt: Date.now() } : p)),
    }));
    setSaved(true);
  };

  const add = async () => {
    const id = newId();
    await update((d) => ({ ...d, profiles: [...d.profiles, { id, name: 'New co-author', values: {}, updatedAt: Date.now() }] }));
    setSelectedId(id);
  };

  const remove = async () => {
    if (data.profiles.length < 2) return;
    if (!window.confirm(`Delete the profile "${selected.name}"? It is also removed from any submission.`)) return;
    await update((d) => {
      const profiles = d.profiles.filter((p) => p.id !== selected.id);
      return {
        ...d,
        profiles,
        activeProfileId: d.activeProfileId === selected.id ? profiles[0]!.id : d.activeProfileId,
        submissions: d.submissions.map((s) => ({ ...s, authors: s.authors.filter((a) => a.profileId !== selected.id) })),
      };
    });
    setSelectedId(data.profiles.find((p) => p.id !== selected.id)!.id);
  };

  return (
    <section aria-labelledby="prof-h" style={{ display: 'grid', gap: 16 }}>
      <header>
        <h1 id="prof-h">Profiles</h1>
        <p className="muted">
          Only enter information you have verified. It is stored on this device and never sent anywhere. Empty fields are never
          filled. Add profiles for co-authors to fill multi-author submission forms.
        </p>
      </header>

      <div className="tabs" role="tablist" aria-label="Profiles">
        {data.profiles.map((p) => (
          <button key={p.id} role="tab" aria-selected={p.id === selected.id} onClick={() => setSelectedId(p.id)}>
            {p.name}
            {p.id === data.activeProfileId ? ' (me)' : ''}
          </button>
        ))}
        <button onClick={add}>＋ Add co-author</button>
      </div>

      <div className="grid">
        <label>
          Profile name
          <input value={draft.name} onChange={(e) => { setSaved(false); setDraft({ ...draft, name: e.target.value }); }} />
        </label>
        <label style={{ alignSelf: 'end' }}>
          <span>
            <input
              type="radio" name="me" style={{ width: 'auto' }}
              checked={data.activeProfileId === selected.id}
              onChange={() => update((d) => ({ ...d, activeProfileId: selected.id }))}
            />{' '}
            This profile is me (used for fields outside author blocks)
          </span>
        </label>
      </div>

      <div className="tabs" role="tablist" aria-label="Field groups">
        {GROUPS.map((g) => (
          <button key={g.id} role="tab" aria-selected={group === g.id} onClick={() => setGroup(g.id)}>{g.title}</button>
        ))}
      </div>

      <div className="grid">
        {keys.map((d) => {
          const long = d.type === 'longtext';
          return (
            <label key={d.key} className={long ? 'wide' : undefined}>
              <span>{d.label}</span>
              {long ? (
                <textarea rows={3} value={draft.values[d.key] ?? ''} onChange={(e) => set(d.key, e.target.value)} />
              ) : (
                <input
                  type={d.type === 'email' ? 'email' : d.type === 'tel' ? 'tel' : d.type === 'url' ? 'url' : 'text'}
                  value={draft.values[d.key] ?? ''}
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
        <button onClick={remove} disabled={data.profiles.length < 2}>Delete profile</button>
        {saved && <span role="status" className="muted">Saved.</span>}
      </div>
    </section>
  );
}
