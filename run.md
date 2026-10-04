# Running SmartFill

Install, test, build, load and use the extension. Everything below was exercised while building it unless marked *(not verified)*.

## 1. Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 20+ | everything |
| npm | 10+ | everything (npm workspaces; pnpm is not used) |
| Chrome / Edge / Brave | recent | loading the extension |
| Python | 3.10+ | only the optional LLM proxy |

## 2. Install

```bash
npm install
npm run fetch-model     # downloads the quantized MiniLM model + ONNX runtime into apps/extension/public (gitignored, ≈40 MB)
```
Without `fetch-model` the extension still works, using rules only (the embedding layer fails quietly).

Notes: the root `package.json` pins `vite@6` and overrides `@vitejs/plugin-react` to v4 — required, because WXT 0.19 runs on Vite 6. If installs get into a bad state, delete `node_modules` and `package-lock.json`, then reinstall.

For the end-to-end tests also install a browser once: `npx playwright install chromium`.

## 3. Verify

```bash
npm run typecheck   # tsc for packages/eval, then the extension
npm test            # 73 Vitest tests: core, DOM (jsdom), eval gates, study analysis
npm run e2e         # builds an E2E variant and runs 14 Playwright tests in real Chromium
npm run eval        # development-set report (+ ablations, risk-coverage CSV)
npx tsx eval/run.ts --test   # held-out set (do not tune on it)
npm run calibrate   # refit the embedding calibration (needs fetch-model)
```
Proxy tests: `cd services/llm-proxy && pip install -r requirements.txt -r requirements-dev.txt && pytest`.

`npm test` fails if any wrong auto-fill appears, any unmatchable field gets filled, auto precision drops below 100%, review-band precision < 97% or recall < 75%, matching a form takes ≥ 300 ms, or site learning stops reducing corrections.

## 4. Build and load

```bash
npm run build       # production build → apps/extension/.output/chrome-mv3
npm run zip         # Chrome Web Store zip
npm run dev         # WXT dev mode with hot reload
```

1. Open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → select `apps/extension/.output/chrome-mv3`.
3. Pin **SmartFill**. After every rebuild press the reload icon on its card.
4. For local `file://` fixtures enable **Allow access to file URLs** on the card, or serve them: `npx serve fixtures/forms`.

On first install the welcome flow (3 screens) opens in a tab.

## 5. Using it

### Profiles
Options → **Profiles**: fill the tabs (Personal / Academic / Professional / Research) and **Save profile**. Only verified information; empty fields are never filled. **＋ Add co-author** creates more profiles; the one marked *me* is used for fields outside author blocks. Sensitive keys (e.g. student ID) are not offered because they are never filled.

### Filling a form
1. Open the form, click **SmartFill** (or **Alt+Shift+F**). The page script is injected only now (`activeTab`).
2. The popup shows counts and each field’s outcome:
   ✓ safe · ✓ review · ⚠ unsure · ○ not in profile · 🔒 protected.
3. **Fill safe fields** writes only the high-confidence ones. **Review** opens the panel on the page:
   * every suggested field with its value; review items are pre-checked, unsure ones are not;
   * a dropdown per field to choose another profile field, **don’t fill**, or **never fill on this site**;
   * **Fill selected**, **Undo**, **Esc** to close; hover a row to highlight the field.
4. **Undo** restores previous values (and unticks/unselects what SmartFill ticked/selected).
5. SmartFill never clicks Submit/Next and never presses Enter.

Custom dropdowns (react-select, MUI-style ARIA comboboxes) are never filled automatically: they appear in the review panel, and SmartFill opens the widget and picks the matching option only after you approve. If no option matches, nothing is written.

### Paper submissions (multiple authors)
1. Add a profile per co-author.
2. Options → **Paper submission**: add authors in order, mark one **corresponding**, **Save and use this submission**.
3. On a form with several author blocks (“Author 1/2/3”, `authors[1][…]`, or repeated unnumbered “Author” sections): block 1 ← author 1, block 2 ← author 2, … in that order; extra blocks stay blank; only the corresponding author’s checkbox is ticked (a box is never unticked).
4. Click **Add author** on the page: the toolbar badge shows how many new fields appeared; run **Fill** again to fill the new block.

Without an active submission only the first author block is filled (from *me*).

### Site rules (learning)
Options → **Site rules** → tick *Learn from my corrections* (off by default). Then, in the review panel, changing a field’s meaning (or “never fill here”) is remembered for **that site only**: label + chosen field name, never values. Manage or forget rules in the same tab.

### AI assist (optional, off by default)
Options → **AI assist**: choose **Local model (Ollama)** (`http://localhost:11434`, e.g. `llama3.1:8b`) or **My proxy server**. The page shows the exact JSON that would be sent and the last request actually sent. Only field descriptions and candidate field *names* are sent — never your values. Answers appear only as *review* items.
Proxy: see [`services/llm-proxy/README.md`](services/llm-proxy/README.md). Ollama support is implemented but *(not verified against a real Ollama server)*.

### Data & privacy
Options → **Data & privacy**: export (optionally passphrase-encrypted), import, **Lock** (AES-256-GCM; unlock from the popup or options after a browser restart), and **Delete all data**. Policy: `privacy.html` inside the extension, source in [`docs/privacy-policy.md`](docs/privacy-policy.md).

## 6. Project layout
See the tree in [`README.md`](README.md) and the design in [`docs/architecture.md`](docs/architecture.md).

## 7. Common tasks

| Task | How |
|---|---|
| Add a profile key | `packages/core/src/registry/keys.ts` (synonyms, autocomplete tokens, negative hints). It appears in Options automatically. |
| Add a fixture | Add `NN-name.html` + `NN-name.json` (`name`/`id` → key or `null`) to `fixtures/forms`, then `npm run eval`. Every detected field needs a ground-truth entry. |
| Change thresholds | `DEFAULT_SETTINGS.thresholds` in `packages/schemas/src/index.ts` (auto 0.95 / review 0.80 / ask 0.50). |
| Add sensitive patterns | `packages/core/src/validate/sensitive.ts` + a test in `core.test.ts`. |
| Regenerate icons | `node scripts/make-icons.mjs` |
| Firefox build | `npm run build:firefox` *(experimental, not verified in Firefox: no offscreen API, so matching is rules-only)* |

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Package subpath './internal' is not defined by "exports"` | plugin-react v6 installed. Keep the `overrides` entry, delete `node_modules` + lockfile, reinstall. |
| Popup: “Can’t read this page” | Chrome blocks extensions on `chrome://`, the Web Store and some PDFs; for `file://` enable file access. |
| Popup: “SmartFill is locked” | Enter your passphrase in the popup or Options. |
| Nothing is filled | Profile empty, or fields are in the review band: use **Review**. The reason for each field is shown. |
| Field not detected | Cross-origin iframe or unsupported widget. |
| Embeddings unavailable | Run `npm run fetch-model` and rebuild; rules-only mode works without it. |
| E2E: no browser | `npx playwright install chromium` |
| Changes not visible | Rebuild and reload the extension on `chrome://extensions`. |

## 9. Not done
User study with participants, the 15-live-site manual run, real-LLM measurements (incl. the keys-only vs full-context ablation), Web Store submission, and Phase 6 items other than a Firefox build script: CV/PDF import, RAG over documents, encrypted cloud sync, on-device WebLLM, opt-in analytics.
