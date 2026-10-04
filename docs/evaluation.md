# Evaluation

Reproduce everything below with:

```bash
npm run fetch-model     # once: bundled MiniLM + ONNX runtime (≈40 MB, gitignored)
npm run eval            # development set, writes eval/results.json + eval/risk-coverage.csv
npx tsx eval/run.ts --test   # held-out set, writes eval/results-test.json
npm run calibrate       # refits the embedding calibration on the development set
```

## Data

| Set | Forms | Fields | Role |
|---|---|---|---|
| `fixtures/forms` (dev) | 26 | 210 | Used while building the rules and fitting the embedding calibration |
| `fixtures/test` (held-out) | 12 | 90 | Written after the rules were frozen. Never used for tuning |

All forms are static HTML written to imitate registration, submission, admission, job and payment pages (label-for, wrapped labels, table layouts, placeholder-only, aria-label-only, ASP-style names, billing/emergency/guardian contexts, multi-author blocks). Every field is labelled with a registry key or `null` (no key; must stay blank). A field is *matchable* when its key exists **and** the evaluation profile (`eval/profile.json`, 16 values) has a value for it.

**Limitations.** The forms are synthetic and were written by the same people who wrote the rules, in one language (English); this is not the 60–100 real-site, two-annotator dataset (with Cohen’s κ) the plan calls for. The held-out set reduces tuning bias but does not remove it. Treat the numbers as regression guards and directional evidence, not as field accuracy.

## Metrics

- **Auto precision / False Autofill Rate (FAR)** – wrong auto-fills / total fields (primary). Auto = what “Fill safe fields” writes.
- **Recall (auto)** – correct auto-fills / matchable fields.
- **Recall / precision (+review)** – also counting the *review* band, which the review panel pre-checks and fills on one click. This is the figure comparable to the plan’s MVP/V2 targets.
- **Unknown Safety Rate (USR)** – unmatchable fields left blank / unmatchable fields.
- **Coverage** – auto-filled fields / all fields.

## Results

### Development set (210 fields, 125 matchable)

| Configuration | Auto precision | Recall (auto) | Precision (+review) | Recall (+review) | FAR | USR | ms / form |
|---|---|---|---|---|---|---|---|
| Rules | 100% | 62.4% | 97.6% | 96.0% | 0.0% | 100% | 13 |
| Rules + embeddings | 100% | 62.4% | 97.6% | 96.0% | 0.0% | 100% | 22 |
| Rules + embeddings + LLM *(oracle upper bound)* | 100% | 62.4% | 97.6% | 99.2% | 0.0% | 100% | – |
| Rules, **second visit** (site learning) | 100% | 100% | 97.7% | 100% | 0.0% | 100% | 15 |

### Held-out test set (90 fields, 62 matchable)

| Configuration | Auto precision | Recall (auto) | Precision (+review) | Recall (+review) | FAR | USR |
|---|---|---|---|---|---|---|
| Rules | 100% | 54.8% | 100% | 91.9% | 0.0% | 100% |
| Rules + embeddings | 100% | 54.8% | 100% | 91.9% | 0.0% | 100% |
| Rules + embeddings + LLM *(oracle upper bound)* | 100% | 54.8% | 100% | 98.4% | 0.0% | 100% |
| Rules, second visit (site learning) | 100% | 100% | 100% | 100% | 0.0% | 100% |

### Targets (plan §1.3)

| Metric | MVP | V2 | Dev | Held-out |
|---|---|---|---|---|
| False autofill rate | ≤ 2% | ≤ 1% | 0.0% ✅ | 0.0% ✅ |
| Precision of filled fields | ≥ 97% | ≥ 98% | 97.6% (+review) ✅ / 100% (auto) | 100% ✅ |
| Recall of matchable fields | ≥ 75% | ≥ 90% | 96.0% (+review) ✅ | 91.9% (+review) ✅ |
| Unknown safety rate | ≥ 95% | ≥ 98% | 100% ✅ | 100% ✅ |
| Matching latency, 30-field form, no LLM | < 300 ms | < 300 ms | ≈ 13 ms (rules) ✅ | – |
| Time saved vs manual | ≥ 50% | ≥ 70% | **not measured** (needs the user study) | |

**Recall (auto) is low by design.** Only exact labels (0.97) and `autocomplete` attributes (0.99) reach the auto band (≥ 0.95). Token matches with extra words (“Runner’s full name”), placeholder-only fields (0.94) and name/id-only fields (0.93) land in *review*. The headline recall therefore counts the review band.

### Second visit (site learning)

Simulation: after visit 1 the user corrects every matchable field that was wrong or left open; those corrections become site rules for visit 2. Manual corrections needed fell from **47 → 0** (dev) and **28 → 0** (test). This is an idealised upper bound (every correction is made, identical forms on the second visit), not a field measurement.

## Findings worth knowing

1. **Embeddings did not improve results on this data.** The MiniLM top-1 was correct for only 8 of the 59 fields the rules left unsettled (most of those fields have no valid key at all). Fitted calibration (`a = 5.607, b = −5.160`) therefore never reaches the 0.80 acceptance threshold, so the layer currently contributes ranked *suggestions* in the review panel and corroboration, not fills. Even at cosine ≥ 0.65 the precision was 7/18. `bge-small-en-v1.5` (34 MB) was no better (9/59 correct; 3/9 at cos ≥ 0.80), so the smaller MiniLM (23 MB) was kept. Leaving the section heading out of the embedded text doubled correct top-1s (4 → 8).
2. **An oracle LLM would add ≈ 3–6 points of review-band recall** (96.0 → 99.2 dev; 91.9 → 98.4 test) without changing FAR. A real model can only do worse; run `services/llm-proxy` and plug it in (`SMARTFILL_LLM_URL` is not wired into `eval/run.ts` yet — the harness accepts any `llm` function) to measure it. The privacy ablation (keys-only vs full context) needs that real model and was **not run**.
3. **Bugs the larger fixture set exposed in the rule layer** (all fixed): digits stripped from synonyms made `address 1`/`address 2` collapse into `address`; plurals (“given names”) did not match; “Mobile (with country code)” was penalised as a country-code field; a page titled “Reviewer Registration” downgraded every field.
4. **One known rule gap on the held-out set:** “Program of study” resolves to *Field of study*, not *Degree*. Left unfixed to keep the test set clean.
5. **Frameworks / widgets.** Verified in real Chromium against the real extension: native-setter fills on a value-tracked input, a real **react-select** (never auto, filled only after approval), radio groups, checkboxes (tick-only), dynamic “Add author”. **Select2 and MUI were not tested**; native `<select>` behind Select2 goes through the normal select path.

## Software tests

| Layer | Tests |
|---|---|
| Core (matching, validation, normalizer, fusion, LLM protocol, authors, site signatures) | 45 |
| CV extraction (patterns, heuristics, never-invent cases) | 4 |
| Vault crypto (round trip, wrong passphrase, tamper, fresh salt/IV) | 3 |
| DOM (detector, filler, radios, custom dropdowns, observer, safety) | 13 |
| Eval gates (fixture ground truth, FAR = 0, USR = 100%, precision/recall floors, latency, site learning) | 8 |
| Study analysis (SUS, paired stats) | 4 |

(77 Vitest tests in total.)
| LLM proxy (pytest) | 8 |
| Real-extension E2E (Playwright + Chromium; incl. real react-select, axe WCAG 2.1 AA, lock, CV import from a real PDF) | 15 |

Safety tests that must always pass: password/card/OTP/ID fields are never filled; missing values leave fields untouched; no `submit` event or button click during a fill; LLM answers outside the candidate list or quoting profile values are rejected; locked data never reaches a page.

## Not done

- User study (timing + SUS) — protocol and analysis code are ready (`docs/user-study.md`, `eval/study.ts`); no participants were run.
- Manual run of the 15 live sites (`docs/real-site-checklist.md` is the template).
- Real-LLM runs and the keys-only vs full-context privacy ablation.
- Chrome Web Store submission itself.
