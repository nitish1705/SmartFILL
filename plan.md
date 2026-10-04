# SmartFill — Complete Project Plan

> **Understand the field, find the verified value, never invent information.**

A local-first, AI-assisted Chrome extension that maps web-form fields to a verified user profile using rules → semantic embeddings → constrained LLM fallback, fills only what it can fill safely, and always lets the user review before anything is written.

---

## 0. How to Use This Plan

| Section | What it gives you |
|---|---|
| 1–2 | Goals, non-goals, success criteria |
| 3–6 | Architecture, tech decisions, data model, repo layout |
| 7 | The matching engine in implementable detail |
| 8 | Autofill engine (the part that usually breaks on real sites) |
| 9 | Phase-by-phase roadmap with tasks, deliverables and exit criteria |
| 10–11 | Testing strategy and evaluation (doubles as the research methodology) |
| 12–13 | Privacy, security, permissions |
| 14–15 | Risks, research paper track |
| 16 | Week-by-week timeline and checklists |

---

## 1. Goals and Non-Goals

### 1.1 Goals
1. Enter profile information **once**; reuse it across arbitrary websites without site-owner integration.
2. Understand that `Institution`, `Affiliation`, `University`, `Organization` (in context) mean the same thing.
3. **Correctness over coverage** — `UNKNOWN` is a valid, preferred output when unsure.
4. Human-in-the-loop review before filling anything that isn't near-certain.
5. First-class support for **research submission portals**: multiple authors, ordering, corresponding author.
6. Local-first: profile never leaves the device; LLM (if used) sees only field context and candidate *keys*, never values.

### 1.2 Non-Goals (explicitly out of scope)
- Auto-submitting forms. SmartFill **never** clicks Submit / Next / Confirm.
- Filling passwords, card data, CVV, bank details, government IDs, OTPs, security answers.
- Generating content (abstracts, cover letters, "free text" answers).
- Solving CAPTCHAs or bypassing bot detection.
- Supporting every custom widget on day one.

### 1.3 Success Criteria (MVP → V2)

| Metric | MVP target | V2 target |
|---|---|---|
| False Autofill Rate (wrong value written) | ≤ 2% | ≤ 1% |
| Precision of auto-filled fields | ≥ 97% | ≥ 98% |
| Recall on matchable fields | ≥ 75% | ≥ 90% |
| Unknown Safety Rate (correctly left blank) | ≥ 95% | ≥ 98% |
| Time saved vs manual (author-details form) | ≥ 50% | ≥ 70% |
| Matching latency (30-field form, no LLM) | < 300 ms | < 300 ms |

---

## 2. Users and Core Scenarios

| # | Scenario | Phase |
|---|---|---|
| S1 | Student fills a conference registration form (name, email, institution, country) | MVP |
| S2 | Same form on a site that labels fields differently (`Affiliation`, `Given Name`) | MVP |
| S3 | Form asks for ORCID that user never stored → left blank, flagged | MVP |
| S4 | `Organization` is ambiguous → shown in review with candidates | MVP |
| S5 | Paper submission with 3 authors in fixed order + corresponding author | V2 |
| S6 | "Add Author" button injects new fields dynamically | V2 |
| S7 | User corrects a mapping; next visit to same site uses the correction | V2 |
| S8 | User uploads CV; extracted fields go to a review queue before becoming trusted | V3 |

---

## 3. System Architecture

### 3.1 Runtime components (Manifest V3)

```text
┌──────────────────────────── Chrome ────────────────────────────┐
│                                                                │
│  Popup (React)            Options / Dashboard (React)          │
│    │  summary, "Review",    profiles, authors, rules,          │
│    │  "Fill safe fields"    privacy, AI settings               │
│    ▼                                                           │
│  Background Service Worker                                     │
│    • message router         • storage access (profile, rules)  │
│    • LLM client (opt-in)    • offscreen doc host for embeddings│
│                                                                │
│  Offscreen Document                                            │
│    • transformers.js + MiniLM (ONNX/WASM) embedding matcher    │
│                                                                │
│  Content Script (injected on demand via activeTab)             │
│    • Form Detector  • Context Extractor  • MutationObserver    │
│    • Autofill Engine • Review overlay (Shadow DOM)             │
└────────────────────────────────────────────────────────────────┘
```

Why an offscreen document: MV3 service workers are short-lived and restricted; running the embedding model in an offscreen document keeps the model warm and off the page's main thread.

### 3.2 Pipeline

```text
Detect ──► Extract context ──► Normalize ──► Match (Rules → Embeddings → LLM?)
   ──► Fuse confidence ──► Validate ──► Decide (Auto / Review / Ask / Skip)
   ──► Review UI ──► Fill ──► (opt-in) Learn from corrections
```

Each stage is a pure function with typed input/output so it can be unit-tested without a browser.

---

## 4. Technology Decisions

| Concern | Choice | Reason |
|---|---|---|
| Extension framework | **WXT** (Vite-based, MV3) | HMR, typed manifest, multi-browser later; lighter than Plasmo |
| Language | TypeScript (strict) | Shared types across content/background/UI |
| UI | React + Tailwind | Popup, overlay and dashboard share components |
| Overlay isolation | Shadow DOM root | Page CSS cannot break the review panel |
| State | Zustand | Small, works in popup and options |
| Storage | `chrome.storage.local` (profile, settings) + IndexedDB via `idb` (site mappings, logs) | Simple for MVP, scalable for learning data |
| Encryption | WebCrypto AES-GCM, key from user passphrase (PBKDF2) — optional "lock" | Protects profile at rest on shared machines |
| Schema validation | **Zod** | Profile, mapping and LLM output validation |
| Fuzzy strings | `fastest-levenshtein` + custom token Jaccard | Rule layer and dropdown option matching |
| Embeddings | **transformers.js** + `Xenova/all-MiniLM-L6-v2` (≈23 MB quantized) or `bge-small-en-v1.5` | Runs fully local; no Python server needed |
| LLM fallback | Any structured-output API behind a small proxy (FastAPI), or local Ollama | Keys never in client; local option for privacy |
| Testing | Vitest (unit), Playwright (extension E2E on fixture forms) | Playwright can load unpacked extensions |
| Lint/format | ESLint + Prettier, Husky pre-commit | |
| CI | GitHub Actions: typecheck, test, build zip | |

---

## 5. Data Model

### 5.1 Profile key registry (single source of truth)

Every fillable concept is a **canonical key** with metadata. The registry drives rules, embeddings, validation and UI.

```ts
type FieldType = "text" | "email" | "tel" | "url" | "country" | "date" | "enum" | "boolean" | "longtext";

interface ProfileKeyDef {
  key: string;                 // "academic.institution"
  label: string;               // "Institution"
  description: string;         // embedding anchor: "academic institution, university, college affiliation"
  type: FieldType;
  synonyms: string[];          // rule layer: ["institution","affiliation","university","institute","college"]
  negativeHints?: string[];    // ["company","employer","publisher"] lowers score
  autocomplete?: string[];     // HTML autocomplete tokens: ["organization"]
  sensitive?: boolean;         // never auto-fill
  perAuthor?: boolean;         // repeats per author block
}
```

Initial key set (≈30 keys):

- `personal.*`: first_name, middle_name, last_name, full_name, salutation, email, alt_email, phone, country, state, city, address_line1, address_line2, postal_code, gender (optional, explicit only)
- `academic.*`: institution, department, degree, field, year_of_study, student_id (sensitive), supervisor
- `professional.*`: designation, organization, employer_email
- `research.*`: orcid, google_scholar, research_interests, ieee_member_id, default_author_role
- `submission.*` (per-submission, V2): paper_title, track, keywords

### 5.2 Stored data

```ts
interface Profile {
  id: string;
  name: string;                       // "Me", "Co-author: Marcus"
  values: Record<string, string>;     // key -> verified value
  updatedAt: number;
}

interface Submission {               // V2
  id: string;
  title: string;
  authors: { profileId: string; order: number; corresponding: boolean; role?: string }[];
}

interface SiteMapping {              // V2 learning
  origin: string;                    // "https://conf.example.com"
  fieldSignature: string;            // hash of normalized label+name+id+section
  key: string | "IGNORE";
  source: "user_correction" | "user_confirmed";
  hits: number;
  updatedAt: number;
}

interface Settings {
  thresholds: { auto: number; review: number; ask: number };   // defaults 0.95 / 0.80 / 0.50
  llm: { enabled: boolean; provider: "proxy" | "ollama" | "off"; endpoint?: string };
  learning: { enabled: boolean };
  locked: boolean;
}
```

### 5.3 Detected field (pipeline currency)

```ts
interface DetectedField {
  fieldId: string;                 // stable within page session
  element: WeakRef<HTMLElement>;
  controlType: "input" | "textarea" | "select" | "radio-group" | "checkbox" | "contenteditable" | "custom";
  inputType?: string;              // email, tel, text...
  context: {
    label?: string; placeholder?: string; name?: string; id?: string;
    ariaLabel?: string; ariaDescribedBy?: string; autocomplete?: string;
    nearbyText?: string; sectionHeading?: string; options?: string[];
    pageTitle: string; authorIndex?: number;   // detected author block
  };
  normalized: { tokens: string[]; text: string };
}

interface MatchResult {
  fieldId: string;
  key: string | null;              // null = UNKNOWN
  confidence: number;
  layer: "site" | "autocomplete" | "rule" | "embedding" | "llm";
  candidates: { key: string; score: number }[];
  decision: "auto" | "review" | "ask" | "skip" | "blocked";
  reason: string;
}
```

---

## 6. Repository Layout

```text
smartfill/
├── apps/
│   └── extension/                  # WXT project
│       ├── entrypoints/
│       │   ├── background.ts
│       │   ├── content.ts
│       │   ├── offscreen/          # embedding worker
│       │   ├── popup/
│       │   └── options/            # dashboard
│       ├── components/             # shared React UI
│       └── wxt.config.ts
├── packages/
│   ├── core/                       # PURE TS — no DOM, fully unit-tested
│   │   ├── registry/               # ProfileKeyDef list
│   │   ├── normalize/
│   │   ├── match/                  # rules, embedding, llm, fusion
│   │   ├── validate/
│   │   └── decide/
│   ├── dom/                        # detector, context extractor, filler
│   └── schemas/                    # Zod schemas shared everywhere
├── services/
│   └── llm-proxy/                  # FastAPI, V2 (optional)
├── fixtures/
│   └── forms/                      # 40+ HTML test forms + ground-truth JSON
├── eval/                           # evaluation harness + reports
├── tests/e2e/                      # Playwright
└── docs/                           # architecture, privacy policy, paper drafts
```

Keeping `core` DOM-free is the key decision: the evaluation harness can run the matcher on thousands of labelled fields in Node without a browser.

---

## 7. Matching Engine — Detailed Design

### 7.1 Context extraction (priority order)

1. `autocomplete` attribute (strongest standard signal — `given-name`, `email`, `organization`, `country-name`)
2. `<label for>` / wrapping `<label>`
3. `aria-label`, `aria-labelledby`, `aria-describedby`
4. `placeholder`
5. `name`, `id` (split camelCase / snake / kebab)
6. Preceding text node / sibling within same row (table cell, flex row) — limit to ~60 chars
7. Nearest `<legend>`, `<h1–h4>`, or section container heading → `sectionHeading`
8. Repeated-block detection → `authorIndex` (e.g. `author[2][email]`, "Author 3" heading, `authors.2.email`)

### 7.2 Normalization

- Lowercase, strip punctuation and `*`, collapse whitespace
- Split identifiers: `authorFirstName` → `author first name`
- Expand abbreviations: `fname`→`first name`, `lname`→`last name`, `inst`→`institution`, `dept`→`department`, `org`→`organization`, `ph`/`mob`→`phone`, `desig`→`designation`
- Remove filler: `please enter`, `your`, `name of`, `the`
- Keep a stop-list of noise tokens (`field`, `input`, `txt`, `ctl00`)

### 7.3 Layer 0 — Site memory (V2)
If `origin + fieldSignature` exists in `SiteMapping` with `source=user_correction` → confidence 0.99, layer `site`. Learned `IGNORE` entries are respected.

### 7.4 Layer 1 — Deterministic rules
Scoring per candidate key:

| Signal | Score |
|---|---|
| `autocomplete` token maps to key | 0.99 |
| Exact synonym match on full normalized label | 0.97 |
| `input type=email` + label contains email synonym | 0.99 |
| Exact synonym match on `name`/`id` | 0.93 |
| All synonym tokens present in label | 0.90 |
| Partial/fuzzy synonym (Levenshtein ≤ 1 on tokens ≥ 5 chars) | 0.80 |
| Negative hint present (`company` for institution) | −0.30 |
| Section heading conflicts (e.g. "Billing", "Emergency contact") | −0.40 |

Special-case rules:
- `name` alone + adjacent `first`/`last` fields → probably `full_name` only if no sibling first/last fields exist.
- "Confirm email" / "Re-enter email" → `personal.email` (same value), still allowed.
- Contact person / guardian / reviewer / emergency sections → **downgrade everything** (it's not the user).

If best rule score ≥ 0.90 and margin to 2nd candidate ≥ 0.15 → accept, skip later layers.

### 7.5 Layer 2 — Semantic embeddings
- Precompute embeddings for each key's `label + description + synonyms` at build time; ship as JSON (≈30 × 384 floats).
- At runtime embed `sectionHeading + " | " + label + " | " + placeholder` per field (batch per page).
- Cosine similarity → calibrate with a learned mapping (Platt scaling on the labelled dataset) so the score behaves like a probability.
- Accept if calibrated score ≥ 0.80 and margin ≥ 0.08.

### 7.6 Layer 3 — LLM fallback (opt-in, V2)
Only for fields still ambiguous **and** whose candidate keys have values in the profile.

Prompt contract (no personal values ever sent):

```text
SYSTEM: You map web form fields to profile keys. Choose ONLY from candidate_keys
or return null. Never output personal data. Respond with JSON matching the schema.

USER: {"field_id":"f17","label":"Name of affiliated institution","placeholder":"",
"section":"Author Information","page_title":"Paper Submission – Step 2",
"candidate_keys":["academic.institution","professional.organization","academic.department"]}
```

Output schema (Zod-validated; anything else is discarded):

```json
{"field_id":"f17","matched_profile_key":"academic.institution","confidence":0.94,"reason":"asks for institutional affiliation"}
```

Batch up to 20 ambiguous fields per call. Timeout 4 s → fall back silently to layer-2 result.

### 7.7 Confidence fusion
```text
final = max over layers, but:
  • if two layers disagree on top key → final = min(scores) − 0.10, decision ≥ "ask"
  • LLM confidence is capped at 0.90 (it can never trigger auto-fill on its own)
  • profile value missing → decision = "skip" (status: Not available)
  • sensitive key or sensitive field detected → decision = "blocked"
```

### 7.8 Validation gate (every result, every layer)
1. Key exists in registry
2. Value exists and is non-empty in the active profile
3. Type compatibility: email→`type=email|text`, phone→`tel|text`, country→select must contain a matching option, boolean→checkbox/radio
4. `maxlength` / `pattern` attributes satisfied by the value (else → review)
5. Field not disabled/readonly/hidden; not already filled by user (don't overwrite unless user opts in)
6. Thresholds → decision

### 7.9 Decision bands (configurable)

| Confidence | Decision | UI |
|---|---|---|
| ≥ 0.95 | auto | ✓ pre-checked, filled with "Fill safe fields" |
| 0.80–0.94 | review | ✓ pre-checked, highlighted in review list |
| 0.50–0.79 | ask | ⚠ unchecked, shows candidates dropdown |
| < 0.50 | skip | ○ left blank, "No information" |
| sensitive | blocked | 🔒 never filled |

---

## 8. Autofill Engine

Real-world filling is harder than matching. Requirements:

- **Framework-controlled inputs (React/Vue/Angular):** set value through the native setter (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el, v)`), then dispatch `input`, `change`, and `blur` with `bubbles: true`. Otherwise the site's state ignores the change.
- **Selects:** match stored value to options by (1) exact text, (2) exact value attr, (3) alias table (India/IN/IND/Bharat; USA/United States/US), (4) fuzzy ≥ 0.9. No match → review, never type.
- **Radio/checkbox:** only when profile has an explicit value; match by label text. Corresponding-author checkbox driven by submission config.
- **contenteditable:** `focus` + `document.execCommand('insertText')` fallback to `textContent` + input event.
- **Custom dropdowns (MUI, Select2, react-select):** V2 adapters — click to open, find option by text, click. Unknown widget → "Unsupported field" notice.
- **iframes:** inject into same-origin frames with `allFrames`; cross-origin frames are listed as unsupported.
- **Shadow DOM:** traverse open shadow roots during detection.
- **Undo:** snapshot previous values; "Undo fill" button restores them.
- **Highlight:** brief outline on filled fields (green = auto, amber = reviewed).
- **Never** click buttons, submit forms, or press Enter.

### Dynamic forms
MutationObserver on the form container (debounced 300 ms). New fields → run pipeline for those fields only → popup badge "3 new fields detected". For "Add Author" flows, new block gets `authorIndex = previous + 1` and maps to the next author in the submission order.

---

## 9. Phased Roadmap

### Phase 0 — Foundations (Week 1)
**Tasks**
- WXT + React + TS + Tailwind scaffold; monorepo with `core`, `dom`, `schemas`
- CI pipeline, lint, Vitest, Playwright loading unpacked extension
- Write the key registry v1 (≈30 keys) with synonyms and descriptions
- Build **10 fixture forms** (plain HTML) + ground-truth JSON (`fieldId → key | null`)

**Exit criteria:** extension loads, popup opens, `pnpm test` and CI green, fixtures served locally.

### Phase 1 — Detect → Match (rules) → Fill (Weeks 2–3) — *MVP core*
**Tasks**
- Profile editor in options page (personal / academic / professional / research tabs); save to `chrome.storage.local`
- Content script injected on toolbar click via `activeTab` + `scripting`
- Form detector + context extractor (label, aria, placeholder, name/id, section heading)
- Normalizer + rule matcher + validation gate
- Autofill engine for input/textarea/native select with native setter + events
- Popup summary (detected / safe / review / unavailable) + "Fill safe fields"
- Sensitive-field blocklist (password, cc-*, cvv, otp, aadhaar/pan/ssn patterns)

**Deliverable:** fills a standard registration form correctly; leaves ORCID blank.
**Exit criteria:** on the 10 fixtures, false autofill = 0, recall ≥ 65%.

### Phase 2 — Semantic Matching + Confidence + Review UI (Weeks 4–5) — *MVP complete*
**Tasks**
- Offscreen document running transformers.js MiniLM; batch embedding API via messaging
- Precomputed key embeddings; cosine + margin logic; calibration on fixture data
- Confidence fusion and decision bands; thresholds in settings
- Review overlay in Shadow DOM: per-field row, value preview, candidate dropdown, include/exclude toggle
- Undo fill; field highlighting
- Expand fixtures to **25 forms**, including real-world snapshots (IEEE/Springer-style author pages, college forms, event registrations) saved as static HTML
- Evaluation harness v1 in `eval/` (Node, runs `core` on all fixtures, prints precision/recall/FAR/USR)

**Deliverable:** MVP as defined in the context doc.
**Exit criteria:** precision ≥ 97%, FAR ≤ 2%, recall ≥ 75%, latency < 300 ms (no LLM).

### Phase 3 — LLM Fallback + Validation hardening (Weeks 6–7)
**Tasks**
- `services/llm-proxy` (FastAPI): single `/map-fields` endpoint, rate limiting, no request logging, API key server-side
- Optional Ollama provider for fully local mode (e.g. small 3–8B instruct model with JSON mode)
- Prompt + Zod schema; reject malformed / out-of-candidate output; timeout fallback
- AI settings page: off / proxy / local; per-request privacy preview ("this is what will be sent")
- Ablation runs: rules-only vs +embeddings vs +LLM on the full fixture set

**Exit criteria:** LLM layer improves recall on ambiguous subset without raising FAR; extension fully works with AI off or offline.

### Phase 4 — Research-Portal Features (Weeks 8–10) — *V2*
**Tasks**
- Multiple profiles (self + co-authors); author library in dashboard
- Submission object: ordered authors, corresponding-author flag, roles
- Author-block detection (indexed names, repeated fieldsets, "Author N" headings)
- Map block *i* → submission author *i*; never reorder
- Radio/checkbox support; corresponding-author control selection
- Custom dropdown adapters (react-select, Select2, MUI) — top 3 by frequency in fixtures
- MutationObserver for "Add Author" flows
- Site-specific mappings + learning from corrections (opt-in), management UI to view/delete learned rules
- Export/import profile JSON (encrypted option)

**Exit criteria:** fills a 3-author fixture correctly in order, correct corresponding author, second visit to same fixture site uses learned mapping (measurable correction-rate drop).

### Phase 5 — Polish, User Study, Release (Weeks 11–12)
**Tasks**
- Onboarding flow (3 screens), empty states, keyboard shortcuts (`Alt+Shift+F` open review)
- Optional profile lock (passphrase → AES-GCM)
- "Delete all data" button; privacy policy page
- Accessibility pass on popup/overlay (focus order, ARIA, contrast)
- User study (10–15 participants): manual vs SmartFill timing on 3 forms, SUS questionnaire
- Chrome Web Store package, screenshots, listing (unlisted first)

**Exit criteria:** all V2 targets in §1.3 met or documented; store build passes review checklist.

### Phase 6 — V3 (post-semester / stretch)
- CV/PDF import: pdf.js text extraction → rule + LLM extraction → **review queue** (extracted values are untrusted until approved)
- Optional RAG over uploaded documents for long-tail fields (research interests, bio)
- Cloud sync (FastAPI + PostgreSQL, end-to-end encrypted blobs), cross-device
- Firefox/Edge builds via WXT
- Fully local LLM via WebGPU (WebLLM)
- Opt-in anonymous analytics (field-signature → key stats only, no values)

---

## 10. Testing Strategy

| Level | Tooling | What |
|---|---|---|
| Unit | Vitest | normalizer, each rule, fusion, validation, option matcher, author-block detection |
| Property | fast-check | normalizer idempotence; validation never passes a missing value |
| Golden | Vitest snapshots | `core` output for every fixture field |
| Integration | Playwright + unpacked extension | open fixture → trigger → assert DOM values, assert nothing submitted |
| Framework | Playwright | React, Vue, Angular fixture apps to verify native setter/event dispatch |
| Regression | CI | eval harness must not drop precision or raise FAR vs `main` |
| Manual | checklist | 15 live sites (registration, conference, job, college portals) per release |

**Safety tests that must always pass**
- Password / card / OTP fields are never filled
- Missing profile value → field untouched
- No `submit` event fired and no button clicked during fill
- LLM returning a key not in candidates → rejected
- LLM returning a value-looking string → rejected

---

## 11. Evaluation Plan (also the research methodology)

### 11.1 Dataset
- **Target: 60–100 forms, 800–1500 fields**, split by site into train (calibration/rule tuning) 40% / validation 20% / **unseen test 40%**
- Sources: academic submission portals (author-detail steps saved as static HTML), conference/workshop registrations, college admission and internship forms, event signups, generic contact forms
- Label each field: canonical key or `null` (not in registry) plus `matchable` flag (key exists AND user profile has value)
- Two annotators on 20% of fields → report Cohen's κ

### 11.2 Metrics
- **Precision** = correct fills / total fills
- **Recall** = correct fills / matchable fields
- **False Autofill Rate** = incorrect fills / total fields *(primary)*
- **Unknown Safety Rate** = unmatchable fields left blank / unmatchable fields
- **Coverage** = fields filled / total fields
- **User Correction Rate** (from study and learning logs)
- **Time saved** (stopwatch study, within-subject, counterbalanced order)
- **Latency** and **LLM call rate** (% fields escalated)
- Risk–coverage curve by varying the auto threshold

### 11.3 Baselines and ablations
1. Chrome native autofill (on same forms, manual observation)
2. Keyword-only exact match
3. Rules (Layer 1)
4. Rules + Embeddings
5. Rules + Embeddings + LLM
6. Full + site learning (second-visit simulation)
7. Embedding model comparison: MiniLM vs BGE-small
8. Privacy ablation: LLM with keys only vs LLM with full context (to show the minimal-context design costs little accuracy)

---

## 12. Privacy Architecture

- Profile stored only in `chrome.storage.local` / IndexedDB; optional passphrase lock
- Embedding model runs on-device; no network for MVP at all
- LLM requests contain: label, placeholder, section heading, page title, candidate keys. **Never values, never full DOM, never URL query strings**
- Privacy preview in AI settings shows the exact JSON that would be sent
- No telemetry by default; no logging of personal data anywhere (lint rule banning `console.log` in content/fill code paths)
- "Delete all data" wipes storage + IndexedDB + learned mappings
- Plain-language privacy page explaining every permission

---

## 13. Security and Permissions

**Manifest permissions (MVP)**
```json
{
  "permissions": ["storage", "activeTab", "scripting", "offscreen"],
  "optional_host_permissions": ["https://*/*"]
}
```
- `activeTab` + `scripting`: inject only when the user clicks SmartFill — no access to sites by default
- `optional_host_permissions`: requested only if user enables "auto-detect on sites I've approved" or dynamic-form watching per site
- LLM proxy domain added as a specific host permission only when AI is enabled

**Other controls**
- Strict CSP for extension pages; no remote code (MV3 requirement); model files bundled or fetched once from a pinned, integrity-checked URL
- Overlay in closed Shadow DOM; never inject HTML from page into extension UI
- Content script treats all page text as untrusted (relevant for prompt injection: page text goes into LLM only as quoted JSON fields, and the output is constrained to candidate keys, so injection cannot cause value generation)
- Proxy: HTTPS only, rate limit, request size cap, no body logging

---

## 14. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| React/Angular inputs ignore programmatic values | Fills appear then vanish | Native setter + event sequence; framework fixtures in CI |
| Custom dropdown variety | Low coverage on portals | Adapter pattern; prioritize top 3; mark others unsupported |
| Embedding model size / cold start | Slow first run | Quantized MiniLM, offscreen doc keeps it warm, lazy-load only when rules leave ambiguity |
| Ambiguous "Organization"/"Name" | Wrong fills | Section-aware rules, margin checks, ask band, learning |
| Prompt injection via page text | Bad mapping | Output restricted to candidate keys, LLM capped below auto threshold |
| Chrome Web Store rejection (broad permissions) | Release delay | activeTab-first design, clear privacy policy |
| Dataset too small for credible paper | Weak results | Start collecting fixtures in Week 1; target ≥ 60 forms |
| Scope creep (V3 features early) | MVP slips | Phase exit criteria; V3 frozen until Phase 5 done |
| Accidental submission | Serious user harm | Hard rule: engine has no click/submit code path; tested |

---

## 15. Research Paper Track

**Working title:** *Context-Aware and Privacy-Preserving Intelligent Form Autofill Using Hybrid Rule, Semantic and LLM-Based Field Matching*

**Contributions to claim**
1. A hybrid cascade (rules → embeddings → constrained LLM) with confidence fusion and abstention
2. A **value-free LLM mapping protocol**: the model selects keys, never sees or produces personal data
3. A labelled form-field dataset across academic and general web forms
4. Evaluation emphasizing False Autofill Rate and Unknown Safety Rate, not just accuracy

**Paper outline**
1. Introduction — repetitive forms, limits of browser autofill
2. Related work — browser autofill heuristics, form understanding / web element classification, semantic similarity, LLM agents on the web and hallucination
3. System design — §3, §7
4. Privacy model — §12
5. Dataset and experimental setup — §11.1
6. Results — ablations, risk–coverage curve, latency, user study
7. Discussion — failure cases, limitations (cross-origin iframes, custom widgets)
8. Conclusion and future work — document import, RAG, on-device LLM

**Artifacts to prepare alongside development**
- Architecture diagram, cascade flow diagram, review UI screenshot
- Results tables auto-generated by `eval/` (CSV → LaTeX)
- Ablation chart and risk–coverage plot

---

## 16. Timeline (12 Weeks)

| Week | Focus | Key deliverable |
|---|---|---|
| 1 | Phase 0 | Scaffold, CI, key registry, 10 fixtures |
| 2 | Phase 1 | Profile editor, detector, context extractor |
| 3 | Phase 1 | Rule matcher, validator, filler, popup → **first working fill** |
| 4 | Phase 2 | Offscreen embeddings, fusion, thresholds |
| 5 | Phase 2 | Review overlay, undo, 25 fixtures, eval harness → **MVP** |
| 6 | Phase 3 | LLM proxy, schema, Ollama option |
| 7 | Phase 3 | Ablations, AI settings, privacy preview |
| 8 | Phase 4 | Multi-profile, submissions, author-block detection |
| 9 | Phase 4 | Radio/checkbox, dropdown adapters, MutationObserver |
| 10 | Phase 4 | Site learning, export/import → **V2** |
| 11 | Phase 5 | Polish, lock, a11y, user study |
| 12 | Phase 5 | Final eval on unseen test set, store package, paper draft |

### Suggested team split (3–4 members)
- **Extension/UI:** popup, options dashboard, review overlay, onboarding
- **DOM/Fill:** detector, context extraction, filler, adapters, MutationObserver
- **Matching/AI:** registry, rules, embeddings, LLM proxy, fusion, validation
- **Data/Eval/Paper:** fixtures, labelling, eval harness, user study, paper writing

---

## 17. Definition of Done Checklists

### MVP (end of Week 5)
- [ ] Profile create/edit/delete, stored locally
- [ ] On-demand injection via toolbar (activeTab)
- [ ] Detects input / textarea / select with full context
- [ ] Rule + embedding matching with confidence
- [ ] Review overlay with include/exclude and candidate override
- [ ] Fills safe fields; undo works
- [ ] Unknown and missing-value fields left blank
- [ ] Sensitive fields blocked
- [ ] No submission code path; safety tests green
- [ ] Eval: precision ≥ 97%, FAR ≤ 2%, recall ≥ 75%

### V2 (end of Week 10)
- [ ] LLM fallback (proxy + local), schema-validated, optional
- [ ] Multiple author profiles, ordered submissions, corresponding author
- [ ] Radio, checkbox, custom dropdown adapters
- [ ] Dynamic forms via MutationObserver
- [ ] Site learning from corrections (opt-in, manageable)
- [ ] Eval on unseen test set meets V2 targets

### Release (end of Week 12)
- [ ] Privacy page, delete-all, optional lock
- [ ] User study completed with timing + SUS
- [ ] Store build and listing assets
- [ ] Paper draft with results tables and figures

---

## 18. First Five Things to Do Tomorrow

1. `pnpm dlx wxt@latest init smartfill` → React + TS template, add Tailwind
2. Create `packages/core/registry/keys.ts` with the 30 keys, synonyms and descriptions
3. Save 10 real form pages you've personally had to fill (conference registrations, author-details steps) as static HTML into `fixtures/forms/` and label them
4. Write the normalizer + 20 unit tests
5. Implement the detector on one fixture and log `DetectedField[]` to the console — then build outward from there: **Detect → Match → Validate → Fill**
