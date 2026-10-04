import { useRef, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

const STEPS = [
  {
    title: 'Fill forms from details you have verified',
    body: (
      <>
        <p>Enter your details once. When you open SmartFill on a form, it matches each field to your profile and fills only what it is sure about.</p>
        <ul>
          <li>Unknown fields and details you never entered are <strong>left blank</strong> — it never guesses or invents.</li>
          <li>Less certain matches go to a <strong>review panel</strong> where you decide.</li>
          <li>It <strong>never submits</strong> a form and never touches passwords, card numbers, OTPs or ID numbers.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Private by design',
    body: (
      <>
        <ul>
          <li>Your profile stays on this device. There is no account, no server and no analytics.</li>
          <li>SmartFill only looks at a page when you click its button (the “activeTab” permission).</li>
          <li>Field matching runs on your computer, using a small model bundled with the extension.</li>
          <li>Optional AI assist is <strong>off</strong>. If you turn it on it sees only field labels and candidate field names — never your details.</li>
          <li>You can encrypt your data with a passphrase and delete everything at any time.</li>
        </ul>
        <p><a href="privacy.html" target="_blank" rel="noreferrer">Read the full privacy policy</a></p>
      </>
    ),
  },
  {
    title: 'Add your first details',
    body: (
      <>
        <p>Next you’ll land on your profile. Fill in what you’re comfortable storing — name, email, institution — and save.</p>
        <p>Working on a paper with co-authors? Add a profile for each of them and set the author order under <em>Paper submission</em>.</p>
        <p>Open SmartFill on any form with the toolbar button or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>F</kbd>.</p>
      </>
    ),
  },
] as const;

export function Welcome({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const last = step === STEPS.length - 1;
  const s = STEPS[step]!;

  // move focus to the new step's heading for keyboard / screen-reader users
  useEffect(() => heading.current?.focus(), [step]);

  const finish = async () => {
    await browser.storage.local.set({ onboarded: true });
    onDone();
  };

  return (
    <main className="options" aria-labelledby="welcome-h">
      <p className="muted" aria-live="polite">Step {step + 1} of {STEPS.length}</p>
      <h1 id="welcome-h" ref={heading} tabIndex={-1}>{s.title}</h1>
      <div>{s.body}</div>
      <div className="actions">
        <button disabled={step === 0} onClick={() => setStep(step - 1)}>Back</button>
        {last ? (
          <button className="primary" onClick={finish}>Set up my profile</button>
        ) : (
          <button className="primary" onClick={() => setStep(step + 1)}>Next</button>
        )}
        <button onClick={finish}>Skip</button>
      </div>
    </main>
  );
}
