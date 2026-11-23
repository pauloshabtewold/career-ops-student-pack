# Token report

One row per feature built in P1 to P4, split by step where one part calls a model and another does not. Tokens per call before the levers come from the frozen P0 baseline (`tests/fixtures/quality/baseline`, arm A); after the levers they come from the passing stacked round in `docs/lever-verdicts.json` and say `not measured` until the A/B has run. The ledger column is tokens per row from `data/usage-ledger.tsv` (`unmeasured` when a call reported no usage). Rebuild with `node tools/lever-ab.mjs report [--ledger <data folder>]`.

Solo run status: no solo run yet. Stacked run status: no stacked run yet.

<!-- rows:start -->
| Feature | Step | Claude tokens per call before | Claude after | Codex tokens per call before | Codex after | Ledger tokens per row | Levers or no AI cost | Quality verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| setup | setup | 0 | 0 | 0 | 0 | no ledger | no AI cost: setup runs as plain scripts and reads the resume once (T15) | mechanical; T15 pending |
| M3 | autopilot | 0 | 0 | 0 | 0 | no ledger | no AI cost: the autopilot only runs the steps below; their tokens are counted in their own rows | mechanical: zero agent calls |
| M4 | batches | 0 | 0 | 0 | 0 | no ledger | no AI cost: batches and approvals are files and budget.mjs rows | mechanical: zero agent calls |
| M5 | unknown questions | 5697 | not measured | 12798 | not measured | no ledger | T3, T10, T12, economy_tier | pending A/B: not measured |
| M5 | known fields | 0 | 0 | 0 | 0 | no ledger | no AI cost: known fields are filled from the answer bank and the ATS maps by code | mechanical: zero agent calls |
| M6 | chrome | 0 | 0 | 0 | 0 | no ledger | no AI cost: chrome.mjs drives the browser by code (T17 caps an agent page read) | mechanical; T17 pending |
| M7 | outreach drafts | 4622 | not measured | 11933 | not measured | no ledger | T5, T10, T11 | pending A/B: not measured |
| M8 | cover letter | 6009 | not measured | 12813 | not measured | no ledger | T10, T11 | pending A/B: not measured |
| M9 | ATS check | 0 | 0 | 0 | 0 | no ledger | no AI cost: template render and text checks run by code | mechanical: zero agent calls |
| M10 | guided lines | 0 | 0 | 0 | 0 | no ledger | no AI cost: guided lines come from lib/next-step.mjs (T14) | mechanical; T14 pending |
| M11 | rule | 0 | 0 | 0 | 0 | no ledger | no AI cost: a rule, not a step | mechanical: zero agent calls |
| M12 | fresh scan | 0 | 0 | 0 | 0 | no ledger | no AI cost: the fresh scan and one page read are code | mechanical; T13 pending |
| M13 | inbox pass | 3405 | not measured | 11186 | not measured | no ledger | T7 | pending A/B: not measured |
| M13 | gmail read | 0 | 0 | 0 | 0 | no ledger | no AI cost: reading the inbox list and link ids is code | mechanical: zero agent calls |
| U1 | boards | 0 | 0 | 0 | 0 | no ledger | no AI cost: public board JSON read by code | mechanical: zero agent calls |
| U2 | answers | 0 | 0 | 0 | 0 | no ledger | no AI cost: saved answers matched exactly by code | mechanical: zero agent calls |
| U3 | cover paragraph | 6009 | not measured | 12813 | not measured | no ledger | T10, T11 | pending A/B: not measured |
| U4 | reply drafts | 4648 | not measured | 11999 | not measured | no ledger | T6, T10, T11 | pending A/B: not measured |
| U4 | reply sort | 0 | 0 | 0 | 0 | no ledger | no AI cost: thanks and no replies are sorted by code when T6 is on | mechanical; T6 pending |
| U5 | digest | 0 | 0 | 0 | 0 | no ledger | no AI cost: the digest is built by code; T9 would add one AI line and stays off until its verdict | mechanical; T9 pending |
| U8 | codex browser | 0 | 0 | 0 | 0 | no ledger | no AI cost: Codex runs chrome.mjs; no model call of its own | mechanical: zero agent calls |
| G2 | hygiene | 0 | 0 | 0 | 0 | no ledger | no AI cost: budget.mjs hygiene rules | mechanical: zero agent calls |
| G3 | outcome classify | 3405 | not measured | 11186 | not measured | no ledger | T7 | pending A/B: not measured |
| G3 | gmail read | 0 | 0 | 0 | 0 | no ledger | no AI cost: reading mail is code | mechanical: zero agent calls |
| G4 | reply rates | 0 | 0 | 0 | 0 | no ledger | no AI cost: reply rates come from the tracker by code | mechanical: zero agent calls |
| G5 | catch-up | 0 | 0 | 0 | 0 | no ledger | no AI cost: the run ledger is written by code | mechanical: zero agent calls |
| G6 | follow-up drafts | 4622 | not measured | 11933 | not measured | no ledger | T10, T11 | pending A/B: not measured |
| G7 | tailor resume | not measured | not measured | not measured | not measured | no ledger | T4 | pending A/B: not measured |
| G7 | ATS check | 0 | 0 | 0 | 0 | no ledger | no AI cost: the ATS text checks run by code | mechanical: zero agent calls |
| G9 | posting risk | 0 | 0 | 0 | 0 | no ledger | no AI cost: posting-risk rules run by code (T16 moves them before the model) | mechanical; T16 pending |
| H2 | self-check | 0 | 0 | 0 | 0 | no ledger | no AI cost: the self-check is code; the optional reviewer call is off unless the student turns it on (T8) | mechanical; T8 pending |
| H3 | batch page | 0 | 0 | 0 | 0 | no ledger | no AI cost: the batch page is a file | mechanical: zero agent calls |
| H4 | job text | 0 | 0 | 0 | 0 | no ledger | no AI cost: job text is saved by code | mechanical: zero agent calls |
| H5 | skill gap | 0 | 0 | 0 | 0 | no ledger | no AI cost: phrases are counted by code | mechanical: zero agent calls |
<!-- rows:end -->

## Per step

| Step | Agent | Tokens per call before (P0) | After | Levers |
| --- | --- | --- | --- | --- |
| triage | claude | 8459 | not measured | T2, T12, jd_trim, batch_size |
| triage | codex | 13978 | not measured | T2, T12, jd_trim, batch_size |
| cover | claude | 6009 | not measured | T10, T11 |
| cover | codex | 12813 | not measured | T10, T11 |
| outreach | claude | 4622 | not measured | T5, T10, T11 |
| outreach | codex | 11933 | not measured | T5, T10, T11 |
| reply | claude | 4648 | not measured | T10, T11 |
| reply | codex | 11999 | not measured | T10, T11 |
| form | claude | 5697 | not measured | T3, T10, T12, economy_tier |
| form | codex | 12798 | not measured | T3, T10, T12, economy_tier |
| classify | claude | 3405 | not measured | none |
| classify | codex | 11186 | not measured | none |
| sort | claude | 3376 | not measured | none |
| sort | codex | 11169 | not measured | none |

Triage rows sent (data/triage-usage.tsv): no ledger given.

## A/B spend

`tools/lever-ab.mjs` prints its estimate for Claude, Codex and the Opus judge before the first call and stops before the next arm at 1.5 times it, or on a quota or rate-limit error, with a `blocked-on-user` line.

| Lever | Estimate (tokens) | Actual (tokens) |
| --- | --- | --- |
| none | not measured | not measured |
