import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { LLM_SYSTEM_PROMPT, buildLlmRequest, type FieldInfo, type LlmRequest } from '@smartfill/core';
import type { Settings } from '@smartfill/schemas';
import { originPattern, validateEndpoint } from '@/lib/llm';
import { getSettings, saveSettings } from '@/lib/storage';

const SAMPLE: FieldInfo = {
  fieldId: 'f17', controlType: 'input', inputType: 'text', disabled: false, readOnly: false, hidden: false, hasValue: false,
  context: { label: 'Name of affiliated institution', sectionHeading: 'Author Information', pageTitle: 'Paper Submission – Step 2' },
};

export function AiSettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState('');
  const [last, setLast] = useState<{ at: number; provider: string; request: LlmRequest } | null>(null);

  useEffect(() => {
    void getSettings().then(setS);
    void browser.storage.local.get('lastLlmPayload').then((r) => setLast((r.lastLlmPayload as typeof last) ?? null));
  }, []);
  if (!s) return null;

  const set = (patch: Partial<Settings['llm']>) => setS({ ...s, llm: { ...s.llm, ...patch } });
  const on = s.llm.provider !== 'off';

  const save = async () => {
    try {
      if (on) {
        const url = validateEndpoint(s.llm.endpoint, s.llm.provider);
        const ok = await browser.permissions.request({ origins: [originPattern(url)] });
        if (!ok) return setMsg('Permission for that endpoint was not granted, so AI stays off.');
      }
      await saveSettings({ ...s, llm: { ...s.llm, enabled: on } });
      setMsg(on ? 'Saved. AI assist is on.' : 'Saved. AI assist is off — nothing leaves your device.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const preview = JSON.stringify(
    buildLlmRequest([{ field: SAMPLE, candidates: ['academic.institution', 'professional.organization', 'academic.department'] }]),
    null, 2,
  );

  return (
    <section aria-labelledby="ai-h" style={{ display: 'grid', gap: 12 }}>
      <h2 id="ai-h">AI assist (optional)</h2>
      <p className="muted">
        SmartFill works fully offline. Optionally, when rules and the on-device model cannot decide a field, an AI model can
        choose between a few candidate profile fields. It is shown only the field’s label, placeholder, section heading, page
        title and the candidate field names — <strong>never your profile values, the page URL or the page contents</strong> —
        and its answer can never be filled without your review.
      </p>
      <label>
        Provider
        <select value={s.llm.provider} onChange={(e) => set({ provider: e.target.value as Settings['llm']['provider'] })}>
          <option value="off">Off (default)</option>
          <option value="ollama">Local model (Ollama) — stays on this machine</option>
          <option value="proxy">My proxy server</option>
        </select>
      </label>
      {on && (
        <div className="grid">
          <label className="wide">
            Endpoint
            <input
              value={s.llm.endpoint ?? ''}
              placeholder={s.llm.provider === 'ollama' ? 'http://localhost:11434' : 'https://my-proxy.example.com'}
              onChange={(e) => set({ endpoint: e.target.value })}
            />
          </label>
          {s.llm.provider === 'ollama' && (
            <label>
              Model
              <input value={s.llm.model ?? ''} placeholder="llama3.1:8b" onChange={(e) => set({ model: e.target.value })} />
            </label>
          )}
          {s.llm.provider === 'proxy' && (
            <label>
              Proxy token (optional)
              <input type="password" autoComplete="off" value={s.llm.token ?? ''} onChange={(e) => set({ token: e.target.value })} />
            </label>
          )}
        </div>
      )}
      <div className="actions">
        <button className="primary" onClick={save}>Save AI settings</button>
        {msg && <span role="status" className="muted">{msg}</span>}
      </div>

      <details>
        <summary>Exactly what would be sent (example)</summary>
        <pre style={{ overflow: 'auto', fontSize: 12 }}>{preview}</pre>
        <p className="muted">System prompt:</p>
        <pre style={{ overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 12 }}>{LLM_SYSTEM_PROMPT}</pre>
      </details>
      <details>
        <summary>Last request actually sent</summary>
        {last ? (
          <>
            <p className="muted">{new Date(last.at).toLocaleString()} via {last.provider}</p>
            <pre style={{ overflow: 'auto', fontSize: 12 }}>{JSON.stringify(last.request, null, 2)}</pre>
          </>
        ) : (
          <p className="muted">Nothing has been sent.</p>
        )}
      </details>
    </section>
  );
}
