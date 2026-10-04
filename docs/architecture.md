# Architecture

```text
 Popup / Options (React)            Page (activeTab, on demand)
   │ commands, unlock, edit           ┌──────────────────────────────┐
   ▼                                  │ injected.ts                  │
 Background service worker  ◄─────────┤  detector → matcher → filler │
   • routes messages                  │  review overlay (Shadow DOM) │
   • serves page-scoped data          │  MutationObserver            │
   • learns site rules                └──────────────────────────────┘
   • LLM client (opt-in)
   • badge
   │ rank(fields)
   ▼
 Offscreen document: MiniLM (ONNX/WASM, bundled) — keeps key vectors warm
```

## Packages

| Package | Role | DOM? |
|---|---|---|
| `packages/schemas` | Zod schemas: settings, profile, submission, site mapping, LLM response | no |
| `packages/core` | key registry, normalizer, rules, validation, decision bands, embedding ranking + calibration, fusion, LLM protocol, author mapping, site signatures, vault crypto | **no** — runs in Node for the eval |
| `packages/dom` | detector (labels, aria, nearby text, headings, shadow DOM, radio groups, comboboxes), filler (native setter, checkbox/radio, custom dropdown adapter, undo), mutation watcher | yes, but global-free (works in jsdom) |
| `apps/extension` | WXT MV3 extension: background, injected script, popup, options, offscreen, privacy page | |
| `services/llm-proxy` | optional FastAPI proxy | |
| `eval/` | harness, calibration, ablations, study analysis | |

## Pipeline

```text
detect → extract context → normalize → [site memory] → rules ┐
                                                              ├→ fuse → validate → decide → review UI → fill
                         (only if rules unsettled) embeddings ┤
                         (only if still unsettled) LLM        ┘
```

* **Rules** score each registry key from autocomplete tokens (0.99), exact label (0.97), placeholder (0.94), name/id (0.93), all-synonym-tokens (0.90 / 0.85), fuzzy (0.80), minus penalties for negative hints and for other-person context (billing, guardian, emergency…). More specific synonyms beat less specific ones.
* **Fusion.** Agreeing layers take the max. Disagreeing layers take `min − 0.10`, capped into the *ask* band. Embeddings are capped at 0.94 and LLM answers at 0.90, so neither can auto-fill alone.
* **Validation gate** (every layer): key in registry, value present, control/type compatible, `maxlength`/`pattern`, not disabled/read-only/hidden/already filled. Select and radio values need a matching option; custom dropdowns are always *review*.
* **Decision bands:** ≥ 0.95 auto · 0.80–0.94 review (pre-checked) · 0.50–0.79 ask · below skip · sensitive blocked.
* **Authors.** Block *i* of a page is filled from submission author *i*. Only the corresponding author’s box is ticked; boxes are never unticked.

## Data flow and trust boundaries

* The page script never reads storage. It asks the background for exactly: the submitter’s values, the ordered authors’ values, and rules for the current origin.
* The background reads one `StoreData` object, either plain or decrypted with a session-only key (`storage.session`, unreadable by content scripts).
* The LLM sees field descriptions and candidate *keys* only, validated both ways. Page text is untrusted: it only ever reaches the model as quoted JSON, and the answer is restricted to the candidate list.
* Manifest permissions: `storage`, `activeTab`, `scripting`, `offscreen`; host access is optional and only for the AI endpoint the user types in.

## Deviations from the original plan

| Plan | Built | Why |
|---|---|---|
| pnpm | npm workspaces | pnpm not installed |
| Tailwind | plain CSS | fewer moving parts |
| Key embeddings precomputed at build time, one vector per key | computed once per session in the offscreen document, one vector per synonym (max similarity) | no build-time model step; better recall per key |
| Site mappings in IndexedDB | `storage.local` inside the (optionally encrypted) store | content scripts cannot reach the extension’s IndexedDB |
| Embeddings accepted at calibrated ≥ 0.80 | same rule, but fitted calibration rarely reaches it (see evaluation) | honest result |
