# Context-Aware and Privacy-Preserving Intelligent Form Autofill Using Hybrid Rule, Semantic and LLM-Based Field Matching

*Working draft. Results are from the synthetic fixture sets described in `docs/evaluation.md`; claims below are limited to what those experiments support. Items marked **TODO** were not done.*

## Abstract
Browser autofill relies on a fixed vocabulary of `autocomplete` tokens and fails on the free-form fields of research-submission and registration portals (“Affiliation”, “Name of institution”, repeated author blocks). We describe SmartFill, a local-first browser extension that maps form fields to a user-verified profile with a cascade of deterministic rules, on-device embeddings and an optional, value-free LLM tie-breaker, and that treats *abstention* as a first-class outcome. On 38 labelled synthetic forms (300 fields) the system made no incorrect automatic fill (false-autofill rate 0%), left every unmatchable field blank (unknown-safety rate 100%), and matched 91.9–96.0% of fillable fields when review-band suggestions are counted. We report negative results too: on this data an on-device sentence-embedding layer did not improve on rules.

## 1. Introduction
Repetitive forms are a recurring cost for researchers (portals ask for the same author, affiliation and identifier data per submission). Autofill errors are costly — a wrong affiliation in a submission is worse than a blank field — so we optimise for **correctness over coverage**. Contributions:
1. A rule → embedding → constrained-LLM cascade with confidence fusion, validation and abstention.
2. A **value-free LLM protocol**: the model receives field descriptions and candidate profile *keys*, never values; its answer is restricted to the candidates, schema-validated, checked for echoed values, and capped below the auto-fill threshold.
3. Handling of research-portal structure: ordered multi-author blocks mapped to a submission, a corresponding-author checkbox that is only ever ticked, and fields that appear dynamically.
4. An evaluation emphasising False Autofill Rate and Unknown Safety Rate, with a held-out set and ablations; and a negative result on embeddings.

## 2. Related work
**TODO** — browser autofill heuristics (HTML `autocomplete`, Chrome/Firefox form classification), web element / form-field classification, sentence embeddings for schema matching, LLM web agents and hallucination. (Citations not collected.)

## 3. System
See `docs/architecture.md`. Rules score registry keys from autocomplete tokens, labels, placeholders and identifiers, penalising other-person contexts (billing, guardian, emergency). Embeddings (MiniLM, quantised, in an offscreen document) rank only the fields the rules could not settle; their output is calibrated by Platt scaling fitted on the development set and capped below the auto band. Fusion takes the maximum when layers agree and `min − 0.10` (capped into *ask*) when they disagree. A validation gate checks key, value, control compatibility, `maxlength`/`pattern` and widget options before any decision. Decisions are *auto* (≥ 0.95), *review* (0.80–0.94, pre-checked), *ask*, *skip* or *blocked* (passwords, cards, OTPs, ID numbers). SmartFill never submits.

## 4. Privacy model
Profile data never leaves the device (optionally encrypted at rest with AES-256-GCM). With AI assist enabled, an LLM sees at most a field’s label, placeholder, section heading, page title and ≤ 5 candidate key names. The exact payload is shown to the user. Page text is untrusted: it reaches the model only as quoted JSON, and the output space is the candidate list, so injected instructions cannot cause value generation. **TODO** — measure the accuracy cost of the minimal context against full context with a real model.

## 5. Experimental setup
Two fixture sets of static HTML forms with hand-labelled fields (`null` = no registry key, must stay blank): development (26 forms / 210 fields, used while building the rules and fitting calibration) and held-out test (12 forms / 90 fields, written after freezing the rules). A field is *matchable* if its key exists and the evaluation profile has a value. Metrics: auto precision and FAR, recall (auto and incl. review band), precision incl. review, unknown-safety rate, coverage, latency. **Limitations:** synthetic forms authored by the system’s authors; English only; no inter-annotator agreement (**TODO**: κ on a second annotator’s labels); no real-site corpus (**TODO**).

## 6. Results
| Configuration (held-out) | Auto precision | Recall (auto) | Precision (+review) | Recall (+review) | FAR | USR |
|---|---|---|---|---|---|---|
| Rules | 100% | 54.8% | 100% | 91.9% | 0.0% | 100% |
| + embeddings | 100% | 54.8% | 100% | 91.9% | 0.0% | 100% |
| + LLM (oracle upper bound) | 100% | 54.8% | 100% | 98.4% | 0.0% | 100% |

Development set: rules 96.0% recall (+review) at 97.6% precision (+review); latency ≈ 13 ms per form for rules, ≈ 22 ms with embeddings after a ≈ 2.7 s one-off model load. Site learning (idealised): corrections needed fall 47 → 0 (dev) and 28 → 0 (held-out) on a second visit. Risk–coverage curves: `eval/risk-coverage*.csv`.

**Embeddings.** Of 59 fields the rules left unsettled on the development set, MiniLM’s top-1 was right for 8; at cosine ≥ 0.65 precision was 7/18. bge-small-en-v1.5 was similar (9/59; 3/9 at ≥ 0.80). Most unsettled fields have no valid key, so a calibrated probability rarely clears 0.80. The layer therefore supplies suggestions and corroboration but did not change fills. Excluding the section heading from the embedded text doubled correct top-1s (4 → 8).

**LLM.** Only an oracle upper bound was measured (+3.2 to +6.5 points of review-band recall). **TODO** real-model run.

**User study.** **TODO** — protocol and analysis code ready (`docs/user-study.md`).

## 7. Discussion
Auto-fill coverage is deliberately modest (≈ 38% of fields): exact labels and `autocomplete` attributes only; everything else goes through a one-click review. The cost of this caution was recall in the auto band; the benefit was no wrong automatic fill on 300 fields. Failure cases: one held-out field resolved to a neighbouring key (“Program of study” → Field of study); custom dropdowns are never auto-filled because their options are unknown until opened; cross-origin iframes, Select2/MUI popups and date pickers are unsupported or unverified. A larger, real-world corpus is the main missing evidence.

## 8. Conclusion and future work
A conservative cascade with explicit abstention filled research-portal forms without incorrect automatic fills on our fixtures. Future work: real-site corpus and annotator agreement, a real-LLM ablation, stronger on-device models or fine-tuning for short-label matching, CV/PDF import with a review queue, optional end-to-end encrypted sync, and on-device LLMs.
