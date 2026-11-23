# Autopilot design

Why the daily pipeline is built the way it is. The code shows what each step does; this page records the rules behind it.

## Flow

scheduled.mjs (daily) -> daily.mjs (zero-token ingest: feeds, scan, merge, prefilter, jd-rules, posting-risk, triage-cache, digest) -> inbox-pass.mjs when `mailbox.schedule` is on -> daily-triage.mjs (model only for survivors) when `automation` is `scheduled-discovery-plus-triage` -> autopilot.mjs once setup has recorded `chrome_in_schedule` (rank, fill plans, cover letters, tailored resumes, outreach drafts, follow-ups, weekly outreach lessons) -> one-page batches -> student reply -> batch.mjs approve -> chrome.mjs fill and submit, or gmail.mjs send (lib/gmail-chrome.mjs), for approved items only -> digest.

The hourly entry (`scheduled.mjs --fresh`) runs only fresh-scan.mjs, which makes no model call.

The autopilot needs `chrome_in_schedule`: setup-flow runs tools/schedule-probe.mjs right after the schedule step and records `no` whenever the probe cannot answer, and scheduled.mjs treats a key still unset after onboarding as `no`, so the batches are always prepared and only the Chrome steps (read forms, fill and submit approved items, outcome mail) wait for an open Chrome.

## Invariants

- Script first, model last. Fetching, filtering, dedupe, known-ATS field mapping, ranking, reply-rate stats and tracker writes are plain code. A model runs only for fit judgment, the tailored resume and the one tailored cover paragraph, outreach personal lines, unknown form questions, outcome-mail classification and reply sorting, the weekly outreach lessons (one call over new or changed threads only), and the opt-in pre-submit reviewer (`reviewer: "off"` by default).
- Nothing is submitted or sent outside a batch the student approved. Every submit and send first asks budget.mjs, which refuses an item with no unused logged approval (exit 3); one approval item is spent once. Filling never asks for approval; the two asks are unknown questions (saved to the answer bank) and "submit this batch?".
- A CAPTCHA or bot check is never solved or bypassed. The job goes to a "finish these yourself" list with a direct link.
- Passwords, card numbers and API keys are never typed. Sign-ins are the student's.
- The automation Chrome profile is separate from the default profile because Chrome blocks remote debugging on the default one. The debugging endpoint is accepted on loopback only.
- Every PDF render and Chrome launch asks the browser-slot command first (`BROWSER_SLOT_CMD`, else `browser.slot_cmd`); any non-zero answer means wait (exit 4) and nothing is launched.
- Every model call appends a row to data/usage-ledger.tsv, and the daily run adds zero-token rows for its code-only steps (digest, catch-up, reply rates, Sunday skill gaps).
- Every student-facing message ends with Next, Type and Why lines, says the student can ask for more, and offers "I'll do X, approve?" before asking the student to do anything by hand.

## Token levers and the quality gate

A token lever ships only after an A/B against the frozen baseline on the same fixture sample. Bars are fixed before the run (docs/quality-gate.md). A lever that fails ships off or milder. After each lever passes alone, all passing levers run together; if the stacked run fails a bar, the lever costing the most quality is dropped or softened until it passes.

docs/lever-verdicts.json is the only thing that turns a lever on; `config/levers.yml` can turn a lever off, never on. The shipped verdicts turn on T1, T3, T4 (at 0.85), T7, T8, T13, T15 and T16, and T17 at its milder setting (12000); the stacked run passed with those together. Every other lever (T2, T5, T6, T9 to T12, T14, economy_tier, jd_trim, batch_size) failed a bar and stays on its off path.

## Rejected

- A browser automation package: the student's Chrome is used instead, with no new dependency. The only other browser is upstream's PDF render, behind the browser slot.
- A hard daily token cap: rejected; the pipeline lowers usage per step and the digest shows a daily estimate. The one spend limit is the student's own triage budget (`triage-budget.mjs`).
- Scraping LinkedIn with a script, or a second LinkedIn account: terms-of-service risk to the student's real account. Fresh jobs come from one saved search read in the student's own Chrome plus an instant alert via Gmail.

## Outreach pacing

Defaults are 15 connection requests per day and 80 per rolling 7 days; the student can raise them up to the budget.mjs ceilings (20 and 100), never past them. A person gets one first message and one follow-up, one contact per company is active at a time, and a no, no reply after the follow-up, or an invite with no accept after 21 days stops the thread.
