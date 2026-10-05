# SmartFill privacy policy

SmartFill fills web forms from a profile you enter yourself. It is built so that your information stays on your device. (The same text ships inside the extension at `privacy.html`.)

## What SmartFill stores
- The profiles you enter (yours and, optionally, co-authors’), paper submissions you define, and — only if you turn learning on — per-site rules (a field’s label and the profile field you chose for it, never a value).
- Settings, including the AI endpoint and, if you add one, your Groq API key (stored only in this browser, not encrypted by the lock).

All of this is stored in your browser’s local extension storage. If you enable the lock it is encrypted with a key derived from your passphrase (PBKDF2-SHA-256, AES-256-GCM).

## What SmartFill does not do
- No accounts, no servers operated by us, no analytics, no telemetry, no advertising, no sale or sharing of data.
- It never submits forms, and never fills passwords, payment-card data, one-time codes, security answers or government/bank identifiers.
- It does not read pages in the background: it runs only when you click its button or use its shortcut.

## Optional AI assist (off by default)
If you enable it and choose Groq (with your own API key) or your own proxy server, SmartFill may send, for fields it cannot decide, the field’s label, placeholder, section heading, page title and a short list of candidate profile-field names. It never sends your profile values, the page URL, or page content. Answers are validated and can never fill a field without your review. The exact request is shown in Options → AI assist.

## Permissions
| Permission | Why |
|---|---|
| `activeTab`, `scripting` | Read and fill the form on the page you are looking at, only after you click SmartFill. |
| `storage` | Save your profiles and settings on this device. |
| `offscreen` | Run the bundled on-device matching model in a background document. |
| optional host permission | Requested only if you enable AI assist, and only for the one endpoint you enter. |

## Your controls
- Export your data (optionally encrypted), import it elsewhere, or delete everything from Options → Data & privacy.
- View and delete learned site rules at any time.
- Uninstalling the extension removes all of its stored data.
