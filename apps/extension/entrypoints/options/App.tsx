import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { unlock } from '@/lib/store';
import { AiSettings } from './AiSettings';
import { DataTab } from './DataTab';
import { ProfilesTab } from './ProfilesTab';
import { RulesTab } from './RulesTab';
import { SubmissionTab } from './SubmissionTab';
import { Welcome } from './Welcome';
import { useStore } from './useStore';

const VIEWS = [
  { id: 'profiles', title: 'Profiles' },
  { id: 'submission', title: 'Paper submission' },
  { id: 'ai', title: 'AI assist' },
  { id: 'rules', title: 'Site rules' },
  { id: 'data', title: 'Data & privacy' },
] as const;
type View = (typeof VIEWS)[number]['id'];

function Unlock({ onDone }: { onDone: () => void }) {
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  return (
    <main className="options">
      <h1>SmartFill is locked</h1>
      <form
        style={{ display: 'grid', gap: 12, maxWidth: 360 }}
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await unlock(pass);
            onDone();
          } catch {
            setErr('Wrong passphrase.');
          }
        }}
      >
        <label>Passphrase<input type="password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} /></label>
        <button className="primary" type="submit">Unlock</button>
        {err && <p role="alert" className="error">{err}</p>}
      </form>
    </main>
  );
}

export function App() {
  const store = useStore();
  const [view, setView] = useState<View>('profiles');
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  useEffect(() => {
    void browser.storage.local.get('onboarded').then((r) => setOnboarded(r.onboarded === true));
  }, []);

  if (store.locked) return <Unlock onDone={store.reload} />;
  if (!store.data || onboarded === null) return null;
  if (!onboarded) return <Welcome onDone={() => setOnboarded(true)} />;
  const { data, update, reload } = store;

  return (
    <main className="options">
      <nav className="tabs" aria-label="Sections">
        {VIEWS.map((v) => (
          <button key={v.id} aria-current={view === v.id ? 'page' : undefined} onClick={() => setView(v.id)}>
            {v.title}
          </button>
        ))}
      </nav>
      {view === 'profiles' && <ProfilesTab data={data} update={update} />}
      {view === 'submission' && <SubmissionTab data={data} update={update} />}
      {view === 'ai' && <AiSettings />}
      {view === 'rules' && <RulesTab data={data} update={update} />}
      {view === 'data' && <DataTab data={data} reload={reload} />}
    </main>
  );
}
