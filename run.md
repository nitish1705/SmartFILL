# Running SmartFill

Step-by-step guide to install, test, build, load and try the extension (Phase 0 + Phase 1).

## 1. Prerequisites

| Tool | Version | Check |
|---|---|---|
| Node.js | 20 or newer | `node -v` |
| npm | 10 or newer | `npm -v` |
| Google Chrome (or Edge/Brave) | recent | — |

The project uses **npm workspaces** (no pnpm needed).

## 2. Install

From the repository root:

```bash
npm install
```

This installs every workspace: `packages/schemas`, `packages/core`, `packages/dom` and `apps/extension`.

Notes:
- The root `package.json` pins `vite@6` and overrides `@vitejs/plugin-react` to v4. This is required: WXT 0.19 runs on Vite 6, and a newer plugin-react needs Vite 7. Don't remove the override.
- If installs get into a bad state, delete `node_modules` and `package-lock.json`, then run `npm install` again.

## 3. Verify the code

```bash
npm test            # 36 unit + DOM + fixture-eval tests (Vitest)
npm run typecheck   # tsc for packages/eval, then wxt prepare + tsc for the extension
npm run eval        # prints the fixture evaluation report
```

Expected `npm run eval` summary (10 fixtures, 84 fields):

```
precision            100.0%
recall (auto only)   ~74%
recall (auto+review) 100.0%
false autofill rate  0.0%
unknown safety rate  100.0%
```

`npm test` fails if the false-autofill count is above 0, if any unmatchable field gets filled, or if recall drops below 65%.

## 4. Build the extension

```bash
npm run build       # production build
```

Output: `apps/extension/.output/chrome-mv3/` (manifest, `background.js`, `injected.js`, `popup.html`, `options.html`).

Other build commands:

```bash
npm run dev         # WXT dev mode: opens a Chrome profile with hot reload
npm run zip         # builds and zips for the Chrome Web Store
```

## 5. Load it in Chrome (manual)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the folder `apps/extension/.output/chrome-mv3`.
5. Pin **SmartFill** from the puzzle-piece menu so the toolbar button is visible.

After every rebuild, click the reload icon on the extension card.

## 6. First-time use

### 6.1 Enter your profile
1. Right-click the SmartFill icon → **Options** (or click the icon → **Profile**).
2. Fill the tabs: Personal, Academic, Professional, Research.
3. Click **Save profile**.

Rules:
- Enter only information you have verified. Empty fields are never filled.
- Data stays in `chrome.storage.local` on this device; nothing is sent anywhere.
- Sensitive keys (e.g. student ID) are not offered, because they are never filled.

### 6.2 Fill a form
1. Open a page with a form. To try it locally, open one of `fixtures/forms/*.html` directly in Chrome (`file:///D:/SmartFILL/fixtures/forms/01-conference-registration.html`), or serve the folder:
   ```bash
   npx serve fixtures/forms
   ```
2. Click the SmartFill icon (or press **Alt+Shift+F**). The page script is injected only now, through `activeTab`.
3. The popup shows counts and a per-field list:
   - ✓ safe to fill (high confidence)
   - ✓ review (medium confidence, **not** filled by the button in this version)
   - ⚠ unsure (candidates exist, not filled)
   - ○ not in profile
   - 🔒 protected (password, card, OTP, ID numbers)
4. Click **Fill safe fields**. Filled inputs get a green outline for a moment.
5. Click **Undo** to restore the previous values.

SmartFill never clicks Submit/Next and never fires form submission.

## 7. What to expect on the fixtures

Use your own profile values, then check these behaviours:

| Fixture | What it shows |
|---|---|
| `01-conference-registration` | Names, email, phone, institution, country select filled; ORCID left blank if not in profile |
| `02-table-layout` | Labels taken from neighbouring table cells |
| `03-placeholders-only` | Placeholder-only inputs land in *review* (not auto-filled) |
| `04-asp-style-names` | `ctl00$txtEmail`-style names; autocomplete attribute gives an auto-fill |
| `05-paper-author-details` | "Affiliation / Institution", research interests; biography untouched |
| `06-college-admission` | Aadhaar/passport blocked; "Father's Name" and "Mother's Mobile" not filled |
| `07-job-application` | Password blocked; file input ignored |
| `08-contact-form` | Single "Name" field → full name |
| `09-event-payment` | Card/CVV/expiry/name-on-card blocked; billing address not filled |
| `10-multi-author` | Only Author 1 is filled; Author 2 is left alone |

## 8. Project layout

```
apps/extension/        WXT + React extension
  entrypoints/
    background.ts      message router, injects the page script on demand
    injected.ts        page script: detect → match → fill → undo
    popup/             toolbar popup
    options/           profile editor
  lib/                 storage + message types
packages/
  schemas/             Zod schemas (Profile, Settings)
  core/                DOM-free: registry, normalizer, rules matcher, validation, decisions
  dom/                 detector (labels, headings, shadow DOM) + filler (native setter, undo)
fixtures/forms/        10 HTML forms + ground-truth JSON
eval/                  evaluation harness (profile.json, run.ts, evaluate.ts)
```

Pipeline: `detect → normalize → rank candidates → validate → decide (auto/review/ask/skip/blocked) → fill`.

## 9. Common tasks

| Task | How |
|---|---|
| Add a profile key | Add an entry to `packages/core/src/registry/keys.ts` (synonyms, autocomplete tokens, negative hints). It appears in the Options page automatically. |
| Add a fixture | Add `NN-name.html` and `NN-name.json` (map of `name`/`id` → key or `null`) to `fixtures/forms/`, then `npm run eval`. Every detected field must have a ground-truth entry. |
| Change thresholds | `DEFAULT_SETTINGS.thresholds` in `packages/schemas/src/index.ts` (auto 0.95 / review 0.80 / ask 0.50). |
| Add sensitive patterns | `packages/core/src/validate/sensitive.ts`, plus a test in `core.test.ts`. |

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Package subpath './internal' is not defined by "exports"` | plugin-react v6 got installed. Keep the `overrides` entry in the root `package.json`, delete `node_modules` + `package-lock.json`, reinstall. |
| Popup says "Can't read this page" | Chrome blocks extensions on `chrome://`, the Web Store and some PDFs. Try a normal web page. For `file://` fixtures, enable **Allow access to file URLs** on the extension card. |
| Nothing is filled | Profile is empty or the fields are in the review band. Check the popup list for the reason on each row. |
| Field not detected | It may be in a cross-origin iframe or a custom widget (not supported yet). |
| Changes not visible | Rebuild (`npm run build`) and reload the extension on `chrome://extensions`. |
| `pnpm` not found | Not used; run everything with `npm`. |

## 11. Not yet implemented

Per `plan.md`: embeddings (Phase 2), review overlay, LLM fallback (Phase 3), multiple profiles/authors, custom dropdown adapters, dynamic forms and site learning (Phase 4), lock/onboarding/store packaging (Phase 5). Playwright end-to-end tests and ESLint/Prettier are also not set up.
