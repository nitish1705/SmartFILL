# SmartFill

> Understand the field, find the verified value, never invent information.

A local-first Chrome extension (Manifest V3) that maps web-form fields to a profile **you** entered, fills only what it can fill safely, and lets you review the rest. Built for research-submission portals: several authors, author order, a corresponding author, fields that appear dynamically.

* **Careful by design** — rules → on-device embeddings → optional value-free LLM; unknown fields and missing details are left blank; passwords, cards, OTPs and ID numbers are never touched; it never submits a form.
* **Private** — no account, server or analytics. Optional passphrase lock, encrypted export, delete-everything.
* **Verified** — 73 unit tests, 8 proxy tests and 14 end-to-end tests that drive the real extension in Chromium (including a real react-select and WCAG 2.1 AA checks).

Status: all phases of [`plan.md`](plan.md) are implemented except the parts that need people or external accounts (user study, live-site checklist, Web Store submission, real-LLM measurements) and the Phase 6 stretch items. See [`docs/evaluation.md`](docs/evaluation.md) for measured results and honest limitations.

## Quick start

```bash
npm install
npm run fetch-model     # bundled on-device model (≈40 MB, once)
npm test                # unit + fixture-evaluation gates
npm run build           # → apps/extension/.output/chrome-mv3  (load unpacked in Chrome)
```
Full instructions, including every feature, are in [`run.md`](run.md).

## Layout
```
apps/extension/   WXT extension: background, injected page script, popup, options, offscreen model, privacy page
packages/         schemas (Zod) · core (DOM-free matching engine) · dom (detector + filler)
services/         llm-proxy (optional FastAPI proxy)
fixtures/         38 labelled HTML forms (26 development, 12 held-out)
eval/             evaluation, calibration, ablations, study analysis
tests/e2e/        Playwright tests against the real extension
docs/             architecture, evaluation, privacy policy, user study, store listing, paper draft
```

## Documents
[Architecture](docs/architecture.md) · [Evaluation](docs/evaluation.md) · [Privacy policy](docs/privacy-policy.md) · [User study](docs/user-study.md) · [Store listing](docs/store-listing.md) · [Real-site checklist](docs/real-site-checklist.md) · [Paper draft](docs/paper-draft.md) · [LLM proxy](services/llm-proxy/README.md)
