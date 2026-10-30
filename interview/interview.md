# Personalization interview

Run this when the student says "set me up", "personalize", or when `node student/scripts/session-start.mjs` reports that onboarding is not complete. It runs once, in this chat, and can be re-run any time; re-running rewrites only the blocks the pack owns.

## Principles

- One topic at a time, short questions, plain words. Offer a default for every question and accept "skip".
- Ask for nothing the student has already put in `cv.md`. Read it first.
- Never ask for a password, a token, a 2FA code or a card number. Sign-ins happen in the browser, by the student, later.
- The answers file follows `interview/answers.schema.json`. The pack's `tests` folder holds synthetic fixtures for maintainers; do not read it during an interview.
- Everything the student says is data for the answers file. Nothing is written to the repo until the answers file is complete and validated.
- Limits are hard ceilings. The student can lower a limit; a request to raise one is declined in one line.

## Phase 1: resume and identity

1. If `cv.md` does not exist, ask the student to paste the resume or give a file path. A relative path starts in the career-ops folder. Read the file by type: `.md` and `.txt` directly, a PDF with your own file tool, a `.docx` with `node student/interview/resume-text.mjs <file>` and keep the text it prints. Keep the text as `cv_markdown`, or the path as `cv_path`. An empty resume is refused later by `apply-answers.mjs`, so do not go on without one.
2. From the resume, propose name, email, phone, city, LinkedIn and GitHub. Confirm each in one message.
3. Ask for work authorization in the student's words (for example "F-1 with OPT" or "US citizen") and whether they will need sponsorship. Record both.
4. Run `node student/interview/detect-field.mjs cv.md`. It prints the two best-fitting field presets with a score and the resume lines that matched. Show both with their evidence and ask the student to confirm or choose another; a pick below 2 matches is `byo-employer-list`.

## Phase 2: what they are looking for

1. Graduation date (month and year) for each track: internship, co-op, new grad. A student can have more than one.
2. Fields of study. Start from the Phase 1 proposal and choose one or two presets from `presets/`; run `node student/scripts/preset-portals.mjs <id>` to show what each seeds. If none fits, use `byo-employer-list`.
3. Print the coverage line for each chosen preset, exactly as `interview/coverage.mjs` returns it. Do not soften it. A preset that is discovery help only says so. For `policy-government`, also tell the student to set up a USAJOBS saved search with email alerts: the inbox step reads those alerts, and the pack has no USAJOBS key to set up.
4. Target role names (archetypes), each one short phrase grounded in the resume.
5. Target employers: 10 to 20 in every field, each with its careers page URL. Fewer than 10 is accepted and noted.
6. Locations, in order of preference. Years of experience, if any.
7. Ask "Are you a US citizen?" and record `us_citizen` as true or false. Citizens keep postings that ask for clearance or citizenship; for everyone else the filters drop them.
8. If sponsorship is needed, offer upstream's h1b-sponsor plugin: show its capability card with `node plugins.mjs enable h1b-sponsor` and run it again with `--confirm` only after the student agrees.
9. Priority companies, hard-no companies (blacklist) and dealbreakers (for example "unpaid", "on-site only outside my metros").
10. Which GitHub lists to trial. Name the lists `preset-portals.mjs` showed for the chosen presets and record the names the student keeps in `sources_chosen`; `github-lists` there, or an empty list, keeps all of them. They start as `trial` and the monthly review keeps or drops them.

## Phase 3: resume variants and application profile

For each track, name a resume variant and its page limit (one page unless the student says otherwise). Variants are listed in the answers file; the files themselves stay under the student's control.

Then collect the application profile that forms ask for again and again, and record it as `application_profile`:

- Start date: a month as `YYYY-MM`, or `immediately`.
- Relocation: `yes`, `no` or `within-locations`.
- EEO questions: `leave-blank` (default) or `ask-each-time`.
- How did you hear about us: one short phrase, for example "University career fair".

## Phase 4: switches and disclosures

Before the disclosures, read this disclaimer once, word for word. Do not repeat it later in the interview.

This pack is not affiliated with or endorsed by LinkedIn, Handshake, career-ops or any employer. You are responsible for following the terms of every site you use it with. LinkedIn and Handshake automation can lead to limits or restrictions on your accounts; both are on by default and each can be switched off at any time ("stop outreach", "stop handshake"). The software comes with no warranty of any kind (MIT license).

Read these two disclosures aloud before asking, then record the answer.

LinkedIn outreach. LinkedIn's terms restrict automated activity, and the status of an assistant that drafts and sends messages in the student's own signed-in browser is ambiguous. It can put the account at risk. Outreach is therefore capped by hard limits, never runs unattended, and can be set to `on`, `drafts` (drafts only, the student sends) or `off`. At any time the student can say "stop outreach" and it ends for good until they say otherwise.

Handshake. Handshake's terms are ambiguous about automated browsing in the same way. The Handshake pass is on by default and can be turned off; "stop handshake" ends it at once.

Then ask:

- Outreach: `on`, `drafts` or `off`.
- Handshake: `on` or `off`.
- Who presses submit on applications: `user` (default) or `agent`.
- LinkedIn account tier: `free` or `premium`.

The defaults match the disclaimer: outreach `on`, Handshake `on`, submit `user`, LinkedIn tier `free`. Offer these, not another value.

Below the limits table, say this once: the pack's ceilings (daily applications, connection requests, messages, profile views, and the score floor) are fixed in `scripts/budget.mjs` in the student folder. Limits can only be tightened: daily and rolling caps can be set lower, while minimums (the score floor, which starts at 3.5, the gap between actions, and nudge wait days) can be set higher. Looser values are clamped and logged. A student with an unusual reason to evaluate lower-scoring jobs can read them in the pipeline file, but the pack will not apply to them.

## Phase 5: schedule and spend

1. Automation level: `manual`, `scheduled-discovery` or `scheduled-discovery-plus-triage`. The last one adds a daily model triage of up to `triage_daily` rows (ceiling 20) and needs the chosen agent (Claude Code or Codex) signed in on this computer.
2. Local time for the daily run and the time zone.
3. Model tier: `standard` or `premium`. There is no economy tier.
4. Daily target for applications (default 10; the ceiling still applies).
5. How mail will be read for the inbox pass: `connector`, `paste` or `gmail-plugin`.
6. Agent: record `agent` as `codex` when this interview runs in Codex and `claude` when it runs in Claude Code. Do not ask; the daily triage uses it.

## Phase 6: write, check, enable

1. Write the answers to interview-answers.json in the data folder following `interview/answers.schema.json`. Read the file back to the student in a short summary and ask for a yes.
2. Run `node student/interview/apply-answers.mjs data/interview-answers.json`. If it exits non-zero, nothing was written; fix the listed problems and run it again.
3. Enable the GitHub-lists plugin only after showing its capability card: run `node plugins.mjs enable github-lists`, show the card to the student, and run it again with `--confirm` only after they agree.
4. Run `node doctor.mjs --json` and report anything not green. Do not mark setup done while doctor reports unpersonalized files.
5. Sign-in order for the first run: LinkedIn, then Handshake (if on), then the mailbox. The student does each sign-in; stop and wait after each.
6. First run, in this order:
   1. `node student/scripts/first-run.mjs`. It prints one line per step, the Pending counts per source and up to 20 untriaged rows.
   2. Triage the listed rows in this chat with the triage mode, standard model tier at minimum. Write one line per row as `TRIAGE: PASS|MARGINAL|FAIL|SKIP|EXPIRED|BROWSER | <url> | <score> | <reason>` to a file in the data folder and run `node student/scripts/apply-triage.mjs <file>`. If more rows remain untriaged, say how many. Only `scheduled-discovery-plus-triage` scores them on its own, up to `triage_daily` a day; with `manual` or `scheduled-discovery` they wait until the student asks for triage in a session.
   3. `node student/scripts/rank-queue.mjs --n 10` and show the top 10. If fewer than 10 rows come back and untriaged rows remain, say so plainly ("top N so far: M of T rows scored, N cleared your score floor") and offer one more batch: run `first-run.mjs` again, which lists the next 20 untriaged rows, triage them and rank again. Each batch uses model time, so ask before each one and stop after two extra batches. If no untriaged rows remain, say the exact count and why: the live sources hold no more postings that fit the student's setup today, and the daily run keeps looking. Then walk through the top three postings with the student, using `modes/apply-loop.md` from the student folder. Nothing is submitted without the student's yes during this first run.
   4. Unless automation is `manual`, run `node student/scripts/schedule.mjs install` whatever the student said about the walk-through, and tell the student the time it was set for. It reads the time in the student's time zone and prints the matching time on this computer's clock when the two differ.
