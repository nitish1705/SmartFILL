# User study protocol (not yet run)

**Status:** the protocol and the analysis code are ready; **no participants have been run**, so there are no results. Do not quote the plan’s “≥ 50% time saved” target as achieved until this is done.

## Question
Does SmartFill reduce the time and effort of filling research-portal forms compared with typing by hand, without more errors?

## Design
- Within-subject, 10–15 participants (students/researchers who have submitted a paper or registered for a conference).
- Three tasks on locally served fixture forms, each with a printed “source sheet” of the participant’s (fictional) details:
  1. **Registration** — `fixtures/forms/01-conference-registration.html`
  2. **Author details** — `fixtures/forms/05-paper-author-details.html`
  3. **Three authors + corresponding author** — `fixtures/forms/26-three-authors.html` (SmartFill condition uses a pre-entered submission)
- Each participant does every task **twice**: once manually, once with SmartFill. Counterbalance condition order with a Latin square so order effects average out; use a different fictional source sheet per repeat.
- SmartFill condition starts with the profile already entered (profile entry time is reported separately, once per participant).

## Procedure
1. Consent and a 2-minute demo of SmartFill (not of the forms).
2. For each task: start a stopwatch when the form is shown; stop when the participant says “done” (they do **not** submit).
3. Record: seconds, number of wrong or missing fields afterwards (compare to the source sheet), and any fields the participant corrected after SmartFill.
4. After the last SmartFill task: the 10-item **System Usability Scale** (1–5), plus free comments on trust (“would you let it fill a real submission?”).

## Data files
Fill `docs/study-templates/sus.csv` (`participant,q1…q10`) and `docs/study-templates/timings.csv` (`participant,form,condition,seconds`) — the checked-in rows are **example data only**.

```bash
npx tsx eval/study.ts docs/study-templates/sus.csv docs/study-templates/timings.csv
```
Outputs: mean SUS (68 ≈ average), and per form the mean times, relative time saved, mean paired difference with a 95% t-confidence interval (`eval/study.ts`, covered by `eval/study.test.ts`).

## Report
Time saved (with CI), error counts per condition, SUS (mean, sd), User Correction Rate (fields changed after SmartFill ÷ fields filled), qualitative themes. State sample size and limitations (small n, fictional data, lab setting).

## Ethics
Use fictional personal data only. Do not collect real identity, contact or payment information. Get consent for timing and comment recording; store results without names.
