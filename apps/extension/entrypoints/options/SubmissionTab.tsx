import { useEffect, useState } from 'react';
import type { Submission } from '@smartfill/schemas';
import { newId, type StoreData } from '@/lib/store';

interface Props {
  data: StoreData;
  update: (fn: (d: StoreData) => StoreData) => Promise<void>;
}

const blank = (): Submission => ({ id: newId(), title: 'My paper', authors: [] });

export function SubmissionTab({ data, update }: Props) {
  const [id, setId] = useState(data.activeSubmissionId ?? data.submissions[0]?.id ?? '');
  const existing = data.submissions.find((s) => s.id === id);
  const [draft, setDraft] = useState<Submission>(existing ?? blank());
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDraft(data.submissions.find((s) => s.id === id) ?? blank());
    setSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const edit = (fn: (s: Submission) => Submission) => {
    setSaved(false);
    setDraft(fn);
  };
  const renumber = (authors: Submission['authors']) => authors.map((a, i) => ({ ...a, order: i + 1 }));
  const move = (i: number, dir: -1 | 1) =>
    edit((s) => {
      const a = [...s.authors];
      const j = i + dir;
      if (j < 0 || j >= a.length) return s;
      [a[i], a[j]] = [a[j]!, a[i]!];
      return { ...s, authors: renumber(a) };
    });

  const save = async () => {
    const authors = renumber(draft.authors);
    // exactly one corresponding author at most
    const seen = authors.findIndex((a) => a.corresponding);
    const fixed = authors.map((a, i) => ({ ...a, corresponding: i === seen }));
    const next = { ...draft, authors: fixed, title: draft.title.trim() || 'Untitled' };
    await update((d) => ({
      ...d,
      submissions: d.submissions.some((s) => s.id === next.id) ? d.submissions.map((s) => (s.id === next.id ? next : s)) : [...d.submissions, next],
      activeSubmissionId: next.id,
    }));
    setId(next.id);
    setSaved(true);
  };

  const remove = async () => {
    if (!existing || !window.confirm(`Delete the submission "${existing.title}"?`)) return;
    await update((d) => ({
      ...d,
      submissions: d.submissions.filter((s) => s.id !== existing.id),
      activeSubmissionId: d.activeSubmissionId === existing.id ? undefined : d.activeSubmissionId,
    }));
    setId('');
  };

  const profileName = (pid: string) => data.profiles.find((p) => p.id === pid)?.name ?? '(deleted)';
  const unused = data.profiles.filter((p) => !draft.authors.some((a) => a.profileId === p.id));

  return (
    <section aria-labelledby="sub-h" style={{ display: 'grid', gap: 16 }}>
      <header>
        <h1 id="sub-h">Paper submission</h1>
        <p className="muted">
          Order your authors once. On a submission form with several author blocks, block 1 is filled from the first author,
          block 2 from the second, and so on — in this order, never reshuffled. Extra blocks are left blank.
        </p>
      </header>

      <div className="grid">
        <label>
          Active submission
          <select value={id} onChange={(e) => { setId(e.target.value); void update((d) => ({ ...d, activeSubmissionId: e.target.value || undefined })); }}>
            <option value="">None (single-author fill)</option>
            {data.submissions.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
        <div style={{ alignSelf: 'end' }}>
          <button onClick={() => { const b = blank(); setId(''); setDraft(b); }}>＋ New submission</button>
        </div>
      </div>

      <label>
        Title
        <input value={draft.title} onChange={(e) => edit((s) => ({ ...s, title: e.target.value }))} />
      </label>

      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <caption className="muted" style={{ textAlign: 'left' }}>Authors, in submission order</caption>
        <thead>
          <tr><th scope="col">#</th><th scope="col">Profile</th><th scope="col">Corresponding</th><th scope="col">Role</th><th scope="col">Order</th></tr>
        </thead>
        <tbody>
          {draft.authors.map((a, i) => (
            <tr key={a.profileId}>
              <td>{i + 1}</td>
              <td>{profileName(a.profileId)}</td>
              <td>
                <input
                  type="radio" name="corr" aria-label={`${profileName(a.profileId)} is the corresponding author`}
                  checked={a.corresponding} style={{ width: 'auto' }}
                  onChange={() => edit((s) => ({ ...s, authors: s.authors.map((x) => ({ ...x, corresponding: x.profileId === a.profileId })) }))}
                />
              </td>
              <td>
                <input
                  aria-label={`Role of ${profileName(a.profileId)}`} value={a.role ?? ''} placeholder="optional"
                  onChange={(e) => edit((s) => ({ ...s, authors: s.authors.map((x) => (x.profileId === a.profileId ? { ...x, role: e.target.value } : x)) }))}
                />
              </td>
              <td>
                <button aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>{' '}
                <button aria-label="Move down" disabled={i === draft.authors.length - 1} onClick={() => move(i, 1)}>↓</button>{' '}
                <button aria-label={`Remove ${profileName(a.profileId)}`} onClick={() => edit((s) => ({ ...s, authors: renumber(s.authors.filter((x) => x.profileId !== a.profileId)) }))}>✕</button>
              </td>
            </tr>
          ))}
          {draft.authors.length === 0 && <tr><td colSpan={5} className="muted">No authors yet.</td></tr>}
        </tbody>
      </table>

      <label>
        Add author
        <select
          value="" disabled={unused.length === 0}
          onChange={(e) => e.target.value && edit((s) => ({ ...s, authors: renumber([...s.authors, { profileId: e.target.value, order: 0, corresponding: s.authors.length === 0 }]) }))}
        >
          <option value="">{unused.length ? 'Choose a profile…' : 'All profiles are already authors'}</option>
          {unused.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>

      <div className="actions">
        <button className="primary" onClick={save}>Save and use this submission</button>
        <button onClick={remove} disabled={!existing}>Delete</button>
        {saved && <span role="status" className="muted">Saved.</span>}
      </div>
    </section>
  );
}
