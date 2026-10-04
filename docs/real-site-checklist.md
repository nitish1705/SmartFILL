# Manual real-site checklist (per release)

Not yet run. Use a throwaway profile with fictional data, never submit, and never use a real payment card.
Load the production build (`npm run build`, unpacked from `apps/extension/.output/chrome-mv3`).

For each site record: ✅ pass / ⚠ partial / ❌ fail, and a note. Pass means: correct fields filled, nothing wrong filled, protected fields untouched, undo works.

| # | Kind | Site (fill in) | Fields detected | Safe fills correct | Review panel sensible | Protected fields untouched | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Conference registration | | | | | | |
| 2 | Conference registration | | | | | | |
| 3 | Journal submission – author step | | | | | | |
| 4 | Journal submission – author step | | | | | | |
| 5 | Multi-author submission (≥ 3 authors) | | | | | | |
| 6 | Workshop / abstract portal | | | | | | |
| 7 | College admission | | | | | | |
| 8 | Internship / job application | | | | | | |
| 9 | Event tickets (stop before payment) | | | | | | |
| 10 | Library / membership | | | | | | |
| 11 | Government-style form (stop at ID fields) | | | | | | |
| 12 | React / Angular / Vue app form | | | | | | |
| 13 | Select2 or MUI dropdown form | | | | | | |
| 14 | Form inside an iframe (same origin / cross origin) | | | | | | |
| 15 | “Add another” dynamic form | | | | | | |

Known unsupported: cross-origin iframes, canvas/WebGL widgets, Select2/MUI popups beyond the generic ARIA adapter (unverified), file uploads, date pickers.

Always check: no submit happened · password/card/OTP/ID fields blank · “Undo” restores · the badge reports newly added fields · the lock screen blocks fills while locked.
