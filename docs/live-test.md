# Live test (P6)

A live test of every module with fake data only, run after the P5 release. Rules for every row: applications are submitted only on the local mock form (`tests/helpers/mock-ats-server.mjs`), outreach goes only to addresses the maintainer owns, LinkedIn is read-only, and no real student data is used. Each row is filled in when the run happens; PASS needs the evidence named.

| Module | Use case | Environment | What happened | Evidence | PASS/FAIL |
| --- | --- | --- | --- | --- | --- |
| Setup flow (M10, M11) | fake-student setup run; every message checked for Next, Type and Why | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| M1 cheap triage | fixture pipeline with years, closed and scam rows; free rules fail them before any call | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| M2 token measurement | usage-ledger rows per step; lever-ab run against the P0 baseline | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| M3 daily autopilot | scheduled.mjs with a fake agent prepares one apply batch and submits nothing | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| M4 batches with two asks | batch page approved with "all except 2"; only unknown questions were asked | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| M5 faster fill | fill plan for the mock Greenhouse form fills known fields with zero agent calls | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| M6 Chrome sign-in once | automation profile opened, read and closed by recorded PID | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| M7 warm outreach | drafts to addresses the maintainer owns; first message has no referral ask | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| M8 cover letters | cover letter on a form with a slot; fact gate and cleanup pass | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| M9 ATS-safe resume | sample resume rendered and checked for reading order and line breaks | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| M12 fresh LinkedIn jobs | one past-hour page read in the automation Chrome, read-only | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| M13 Handshake alert links | fixture alert mail with a redirect link gives a joinhandshake job URL | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| U1 hourly feeds | fresh scan over fixture boards adds only new rows | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| U2 learning answer bank | an answer learned once fills the same question on a second form | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| U3 cover base per family | base plus one paragraph for two role families | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| U4 referral contacts and replies | reply suggestions and referral timing from outreach-state | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| U5 daily digest | digest Today section and guided footer | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| U8 Chrome for Codex | codex exec runs chrome.mjs read on the mock form (gated, CAREER_OPS_AGENT_E2E=1) | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| G1 light connect pace | default 15 a day refused at the 16th | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| G2 outreach hygiene | second first message, second contact at a company and message after a no each refused | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| G3 Gmail outcome parsing | rejection from the tracked domain sets Rejected with the prior status logged | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| G4 response-rate feedback | reply-rate groups under 5 leave the ranking unchanged | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| G5 catch-up | two missed days give one run and both dates in the digest | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| G6 follow-up | follow-up due 8 days after a submit, once, in the next approved batch | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| G7 tailored resume ATS check | tailored resume rendered and checked before batching | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| G9 scam and ghost check | payment-request fixture flagged, legitimate fixtures pass | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| G11 Windows | Windows CI job runs the Chrome e2e tests on the mock form | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| H2 pre-submit self-check | a letter naming the wrong company is flagged and kept out of the batch | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| H3 one-page approval | ten items per page, the rest on the next page | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| H4 saved job text | job text saved under data/jds with a jd= note on the row | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |
| H5 skill-gap report | Sunday digest names a requirement seen in 3 matched postings | fake student in a temp career-ops folder, automation Chrome headless | not run yet | | not run |

`tests/e2e/live-mock.test.mjs` runs the setup, scheduled run, approval and submit part of this table on every CI run where Chrome exists; the rows above record the full manual pass.
