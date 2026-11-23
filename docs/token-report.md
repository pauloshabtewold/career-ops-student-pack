# Token report

One row per feature built in P1 to P4, split by step where one part calls a model and another does not. Tokens per call before the levers come from the frozen P0 baseline (`tests/fixtures/quality/baseline`, arm A); after the levers they come from a completed stacked pass in `docs/lever-verdicts.json` and say `not measured` until the A/B has run. The ledger column is tokens per row from `data/usage-ledger.tsv` (`unmeasured` when a call reported no usage). Steps an agent session pays for (its page reads) are not in the ledger and say so. The plumbing rows (setup, M1, M12) hold whole-fixture-sample totals from the zero-call plumbing trial, not tokens per call. Rebuild with `node tools/lever-ab.mjs report [--ledger <data folder>]`.

Solo run status: solo run 2026-11-23 finished: 20 lever(s). Stacked run status: stacked pass after 1 round: T1, T3, T4, T7, T8, T13, T15, T16, T17 on together. Invented facts rule: option A: lever-added over control, inputs as sources; a draft step passes when its lever-added items are at most the same step's A/A control count (data.aa.per_step), 0 with no measurement; every other step at most the bar.

<!-- rows:start -->
| Feature | Step | Claude tokens per call before | Claude after | Codex tokens per call before | Codex after | Ledger tokens per row | Levers or no AI cost | Quality verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| setup | setup | 3604 | 2024 | 3604 | 2024 | no ledger | no AI cost of its own: setup runs as plain scripts and reads the resume once (T15); T15 saving (session tokens (characters parsed / 4), whole fixture sample) | T15 pass |
| M1 | triage of unchanged postings | 50754 | 29607 | 83868 | 48923 | no ledger | T1 (plumbing): rows it keeps out of triage (P0 triage tokens per row, whole fixture sample) | T1 pass |
| M3 | autopilot | 0 | 0 | 0 | 0 | no ledger | no AI cost: the autopilot only runs the steps below; their tokens are counted in their own rows | mechanical: zero agent calls |
| M4 | batches | 0 | 0 | 0 | 0 | no ledger | no AI cost: batches and approvals are files and budget.mjs rows | mechanical: zero agent calls |
| M5 | known fields | 0 | 0 | 0 | 0 | no ledger | no AI cost: known fields are filled from the answer bank and the ATS maps by code (T3 adds learned maps) | mechanical; T3 pass |
| M6 | chrome | session tokens, not measured | session tokens, not measured | session tokens, not measured | session tokens, not measured | no ledger | no AI cost of its own: chrome.mjs drives the browser by code; an agent page read is paid by the session (T17 caps it) | T17 milder |
| M7 | outreach drafts | 4622 | not measured | 11933 | not measured | no ledger | T5, T10 | T5 fail, T10 fail |
| M8 | cover paragraph (before = P0 whole-letter prompt) | 6009 | not measured | 12813 | not measured | no ledger | T10, T11 | T10 fail, T11 fail |
| M9 | ATS check | 0 | 0 | 0 | 0 | no ledger | no AI cost: template render and text checks run by code | mechanical: zero agent calls |
| M10 | guided lines | 0 | 0 | 0 | 0 | no ledger | no AI cost: guided lines come from lib/next-step.mjs (T14) | mechanical; T14 fail |
| M11 | rule | 0 | 0 | 0 | 0 | no ledger | no AI cost: a rule, not a step | mechanical: zero agent calls |
| M12 | fresh scan | 29607 | 25377 | 48923 | 41934 | no ledger | no AI cost of its own: the fresh scan and one page read are code; T13 dedupe keeps repeated rows out of triage; T13 saving (P0 triage tokens per row, whole fixture sample) | T13 pass |
| M13 | inbox pass | 3405 | not measured | 11186 | not measured | no ledger | T7 | T7 pass |
| M13 | gmail read | 0 | 0 | 0 | 0 | no ledger | no AI cost: reading the inbox list and link ids is code | mechanical: zero agent calls |
| U1 | boards | 0 | 0 | 0 | 0 | no ledger | no AI cost: public board JSON read by code | mechanical: zero agent calls |
| U2 | answers | 0 | 0 | 0 | 0 | no ledger | no AI cost: saved answers matched exactly by code | mechanical: zero agent calls |
| U3 | cover paragraph (before = P0 whole-letter prompt) | 6009 | not measured | 12813 | not measured | no ledger | T10, T11 | T10 fail, T11 fail |
| U4 | reply drafts | 4648 | not measured | 11999 | not measured | no ledger | T6, T10 | T6 fail, T10 fail |
| U4 | reply sort | 0 | 0 | 0 | 0 | no ledger | no AI cost: thanks and no replies are sorted by code when T6 is on | mechanical; T6 fail |
| U5 | digest | 0 | 0 | 0 | 0 | no ledger | no AI cost: the digest is built by code; T9 would add one AI line and stays off until its verdict | mechanical; T9 fail |
| U8 | codex browser | session tokens, not measured | session tokens, not measured | session tokens, not measured | session tokens, not measured | no ledger | no AI cost of its own: Codex runs chrome.mjs; its page reads are paid by the session | T17 milder |
| G2 | hygiene | 0 | 0 | 0 | 0 | no ledger | no AI cost: budget.mjs hygiene rules | mechanical: zero agent calls |
| G3 | outcome classify | 3405 | not measured | 11186 | not measured | no ledger | T7 | T7 pass |
| G3 | gmail read | 0 | 0 | 0 | 0 | no ledger | no AI cost: reading mail is code | mechanical: zero agent calls |
| G4 | reply rates | 0 | 0 | 0 | 0 | no ledger | no AI cost: reply rates come from the tracker by code | mechanical: zero agent calls |
| G5 | catch-up | 0 | 0 | 0 | 0 | no ledger | no AI cost: the run ledger is written by code | mechanical: zero agent calls |
| G6 | follow-up drafts | 4622 | not measured | 11933 | not measured | no ledger | T10 | T10 fail |
| G7 | tailor resume | not measured | not measured | not measured | not measured | no ledger | T4 | T4 pass |
| G7 | ATS check | 0 | 0 | 0 | 0 | no ledger | no AI cost: the ATS text checks run by code | mechanical: zero agent calls |
| G9 | posting risk | 0 | 0 | 0 | 0 | no ledger | no AI cost: posting-risk rules run by code (T16 moves them before the model) | mechanical; T16 pass |
| H2 | self-check | 0 | 0 | 0 | 0 | no ledger | no AI cost: the deterministic checks are code | mechanical: zero agent calls |
| H2 | reviewer (optional, reviewer on) | not measured | not measured | not measured | not measured | no ledger | T8 | T8 pass |
| H3 | batch page | 0 | 0 | 0 | 0 | no ledger | no AI cost: the batch page is a file | mechanical: zero agent calls |
| H4 | job text | 0 | 0 | 0 | 0 | no ledger | no AI cost: job text is saved by code | mechanical: zero agent calls |
| H5 | skill gap | 0 | 0 | 0 | 0 | no ledger | no AI cost: phrases are counted by code | mechanical: zero agent calls |
<!-- rows:end -->

## Per step

| Step | Agent | Tokens per call before (P0) | After | Levers |
| --- | --- | --- | --- | --- |
| triage | claude | 8459 | not measured | T1, T13, T2, jd_trim, batch_size |
| triage | codex | 13978 | not measured | T1, T13, T2, jd_trim, batch_size |
| cover | claude | 6009 | not measured | T10, T11 |
| cover | codex | 12813 | not measured | T10, T11 |
| outreach | claude | 4622 | not measured | T5, T10 |
| outreach | codex | 11933 | not measured | T5, T10 |
| reply | claude | 4648 | not measured | T10 |
| reply | codex | 11999 | not measured | T10 |
| classify | claude | 3405 | not measured | none |
| classify | codex | 11186 | not measured | none |
| sort | claude | 3376 | not measured | none |
| sort | codex | 11169 | not measured | none |

Triage rows sent (data/triage-usage.tsv): no ledger given.

## A/B spend

`tools/lever-ab.mjs` prints its estimate for Claude, Codex and the Opus judge from the P0 calls before the first call, and stops before the next arm when one of them passes 1.5 times its own estimate, or on a quota, limit or sign-in answer, with a `blocked-on-user` line.

| Lever | Estimate (tokens) | Actual (tokens) |
| --- | --- | --- |
| T1 | 5099298 | 1558961 |
| T2 | 5099298 | 2026154 |
| T3 | 5099298 | 2026154 |
| T4 | 5099298 | 2269325 |
| T5 | 5099298 | 2529546 |
| T6 | 5099298 | 2529546 |
| T7 | 5099298 | 2529546 |
| T8 | 5099298 | 2558543 |
| T9 | 5099298 | 2586646 |
| T10 | 5099298 | 3368440 |
| T11 | 5099298 | 3880784 |
| T12 | 5099298 | 3880784 |
| T13 | 5099298 | 3880784 |
| T14 | 5099298 | 3938689 |
| T15 | 5099298 | 3938689 |
| T16 | 5099298 | 3938689 |
| T17 | 5099298 | 3938689 |
| economy_tier | 5099298 | 3938689 |
| jd_trim | 5099298 | 4512231 |
| batch_size | 5099298 | 5060228 |
