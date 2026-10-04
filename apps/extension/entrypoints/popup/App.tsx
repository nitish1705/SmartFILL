import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { Command, Counts, Response, Row } from '@/lib/messages';

const ICON: Record<Row['decision'], string> = { auto: '✓', review: '✓', ask: '⚠', skip: '○', blocked: '🔒' };
const ORDER: Row['decision'][] = ['auto', 'review', 'ask', 'blocked', 'skip'];

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: Row[]; counts: Counts; note?: string };

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (type: Command) => {
    setBusy(true);
    try {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) throw new Error('No active tab.');
      const res = (await browser.runtime.sendMessage({ type, tabId: tab.id })) as Response | undefined;
      if (!res) throw new Error('No response from the page.');
      if (!res.ok) throw new Error(res.error);
      const note =
        res.filled !== undefined ? `Filled ${res.filled} field${res.filled === 1 ? '' : 's'}.` :
        res.undone !== undefined ? `Restored ${res.undone} field${res.undone === 1 ? '' : 's'}.` : undefined;
      setState({ status: 'ready', rows: res.rows, counts: res.counts, note });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run('smartfill:scan');
  }, [run]);

  const ready = state.status === 'ready' ? state : null;
  const rows = ready ? [...ready.rows].sort((a, b) => ORDER.indexOf(a.decision) - ORDER.indexOf(b.decision)) : [];

  return (
    <main className="popup">
      <h1>SmartFill</h1>

      {state.status === 'loading' && <p className="muted">Scanning page…</p>}
      {state.status === 'error' && (
        <p className="error">Can’t read this page: {state.message}</p>
      )}

      {ready && (
        <>
          <div className="pills">
            <span className="pill">{ready.counts.detected} detected</span>
            <span className="pill" style={{ color: 'var(--ok)' }}>{ready.counts.safe} safe to fill</span>
            <span className="pill">{ready.counts.review} to review</span>
            <span className="pill">{ready.counts.ask} unsure</span>
            <span className="pill">{ready.counts.unavailable} not in profile</span>
            <span className="pill">{ready.counts.blocked} protected</span>
          </div>
          {ready.note && <p role="status">{ready.note}</p>}
          <ul className="rows">
            {rows.filter((r) => r.decision !== 'skip' || r.key).map((r) => (
              <li key={r.fieldId}>
                <span aria-hidden>{ICON[r.decision]}</span>
                <span>
                  {r.label}
                  {r.keyLabel && <span className="muted"> → {r.keyLabel}</span>}
                  <div className="sub">{r.preview && r.decision !== 'blocked' ? `${r.preview} · ` : ''}{r.reason}</div>
                </span>
              </li>
            ))}
            {rows.every((r) => r.decision === 'skip' && !r.key) && (
              <li><span /><span className="muted">No fillable fields recognised.</span></li>
            )}
          </ul>
        </>
      )}

      <div className="actions">
        <button
          className="primary grow"
          disabled={busy || !ready || ready.counts.safe === 0}
          onClick={() => run('smartfill:fill')}
        >
          Fill safe fields{ready ? ` (${ready.counts.safe})` : ''}
        </button>
        <button disabled={busy || !ready} onClick={async () => { await run('smartfill:review'); window.close(); }}>Review</button>
        <button disabled={busy} onClick={() => run('smartfill:undo')}>Undo</button>
        <button onClick={() => browser.runtime.openOptionsPage()}>Profile</button>
      </div>
      <p className="muted" style={{ margin: 0 }}>SmartFill never submits forms and never touches passwords or card fields.</p>
    </main>
  );
}
