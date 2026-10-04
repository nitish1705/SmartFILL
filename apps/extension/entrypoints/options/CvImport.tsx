import { useState } from 'react';
import { extractFromCv, getKeyDef, type CvSuggestion } from '@smartfill/core';

interface Row extends CvSuggestion {
  include: boolean;
  /** Value the user may edit before accepting. */
  edited: string;
  current?: string;
}

interface Props {
  /** Values already in the profile being edited (shown so conflicts are visible). */
  current: Record<string, string>;
  /** Merge accepted values into the profile draft (the user still presses Save). */
  onApply: (values: Record<string, string>) => void;
}

const MAX_BYTES = 10 * 1024 * 1024;

export function CvImport({ current, onApply }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (file: File) => {
    setBusy(true);
    setRows(null);
    try {
      if (file.size > MAX_BYTES) throw new Error('That file is larger than 10 MB.');
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
      // pdf.js is only loaded when a PDF is actually chosen
      const text = isPdf ? await (await import('@/lib/pdf')).pdfToText(file) : await file.text();
      const found = extractFromCv(text);
      setRows(
        found.map((s) => {
          const cur = current[s.key];
          return {
            ...s,
            edited: s.value,
            current: cur,
            // pre-select only distinctive, non-conflicting values; everything else waits for the user
            include: s.confidence === 'high' && (!cur || cur === s.value),
          };
        }),
      );
      setMsg(found.length ? `Found ${found.length} possible detail${found.length === 1 ? '' : 's'}. Nothing is saved until you apply and save.` : 'No details recognised in that file.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not read that file.');
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    const chosen = (rows ?? []).filter((r) => r.include && r.edited.trim());
    onApply(Object.fromEntries(chosen.map((r) => [r.key, r.edited.trim()])));
    setMsg(`Added ${chosen.length} value${chosen.length === 1 ? '' : 's'} to the form below. Review them and press “Save profile”.`);
    setRows(null);
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <p className="muted">
        Reads a CV (PDF or text) <strong>in your browser</strong> — it is never uploaded — and suggests details. Suggestions are
        untrusted until you tick them. Lower-confidence guesses (names, institutions) start unticked.
      </p>
      <label>
        CV file
        <input type="file" accept=".pdf,.txt,.md,application/pdf,text/plain" disabled={busy} onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
      </label>
      <div role="status" aria-live="polite" className="muted">{busy ? 'Reading…' : msg}</div>

      {rows && rows.length > 0 && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <caption className="sr-only">Details found in the CV</caption>
            <thead>
              <tr><th scope="col">Use</th><th scope="col">Field</th><th scope="col">Value</th><th scope="col">Found in</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const label = getKeyDef(r.key)?.label ?? r.key;
                return (
                  <tr key={r.key}>
                    <td>
                      <input
                        type="checkbox" style={{ width: 'auto' }} aria-label={`Use ${label}`} checked={r.include}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)))}
                      />
                    </td>
                    <td>
                      {label}
                      <div className="muted">{r.confidence === 'high' ? 'pattern match' : 'guess'}</div>
                    </td>
                    <td>
                      <input
                        aria-label={`Value for ${label}`} value={r.edited}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, edited: e.target.value } : x)))}
                      />
                      {r.current && r.current !== r.edited && <div className="muted">replaces: {r.current}</div>}
                    </td>
                    <td className="muted">{r.evidence}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="actions">
            <button className="primary" onClick={apply}>Add ticked values to this profile</button>
            <button onClick={() => { setRows(null); setMsg(''); }}>Discard</button>
          </div>
        </>
      )}
    </div>
  );
}
