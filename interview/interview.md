# Personalization interview

Run this when the student says "set me up", "personalize" or "redo my setup", or when `node student/scripts/session-start.mjs` reports that onboarding is not complete. It runs once, in this chat, and can be re-run any time. A re-run rebuilds the keys of config/student.yml that the interview asks and rewrites only the marked blocks in the other files; keys the interview never asks (the `rank`, `audit` and `judgment_keywords` settings and the measured triage figures) stay as they are.

## Principles

- Four Parts, in order: A sign-ins, B your job queue, C application profile, D schedule and switches. Each Part is one numbered batch of questions, not one question per message.
- Every item in a batch has one line saying what it does, a default marked "(recommended)" with a one-line reason, and the other options. An item about the student personally (resume, name, contact, work authorization, sponsorship, US citizen, locations, EEO) is marked "personal, no default" and gets no recommended value.
- The student replies "all recommended" or "ok" to accept every default, or names only the items to change, for example "3: no, 5: 9am". Say this at the top of each batch.
- Never ask for a password, a token, a 2FA code or a card number. Sign-ins happen in the browser, by the student; the agent explains the step, waits, then checks the result.
- Ask for nothing the student has already put in `cv.md`. Read it first. The answers file follows `interview/answers.schema.json`; the pack's `tests` folder holds synthetic fixtures for maintainers, so do not read it during an interview.
- Save `data/interview-answers.json` after every Part. On a resume with onboarding incomplete, read it and continue from the first Part whose answers are missing. On a re-run, read config/student.yml first and offer each current value as the default, so a re-run does not reset a budget or a switch the student changed since.
- The limits in scripts/budget.mjs are hard ceilings the student can only tighten; a request to raise one is declined in one line. The student's own triage budget (model usage for the daily triage, default 20 rows a day and 60 on the first run, any whole number or "all") is changed only after the estimate is shown.

## Part A: sign-ins

List every sign-in in one batch before any other question, so the student does them all in one go. Reply rules: "all recommended" or "ok" accepts every default; "3: skip" changes only item 3.

1. Gmail connector. Does: lets the daily inbox pass read job-alert emails and company replies with read-only tools, so they reach your queue and tracker without a session. (recommended) connect it: it is the only way replies arrive unattended. Other: skip, and paste mail by hand later.
2. LinkedIn in the browser. Does: needed for outreach and LinkedIn pages. (recommended) sign in while outreach is on: the risks and the switches come in Part D. Other: skip, and outreach stays off.
3. Handshake in the browser. Does: needed for the Handshake pass and its saved-search alerts. (recommended) sign in: campus-only postings are on no public list. Other: skip.
4. Simplify and Indeed. Does: free accounts whose alert emails add postings; you create them yourself. (recommended) skip for now: LinkedIn and Handshake alerts cover most postings, and you can add these any time.
5. GitHub. Does: the pack reads public job lists. (recommended) nothing to do: no account is needed.

Give the exact steps for the agent running this chat: in Claude Code, connect Gmail in your claude.ai connector settings and confirm it with `/mcp`; in Codex, connect the Gmail app in your ChatGPT apps settings. Then wait once while the student signs in to everything on the list, and check all of them in one go:

- Run one Gmail search in this chat with the read tools, and run `node student/scripts/inbox-pass.mjs --check --agent <claude|codex>` with the agent of this session (`claude` in Claude Code, `codex` in Codex). It works before any config exists and prints `inbox pass check: ok` only when the run used Gmail read tools and nothing else.
- Open the LinkedIn and Handshake pages and read whether a sign-in page shows.

Record `signins` in the answers file: each of gmail, linkedin, handshake, simplify and indeed is `ok`, `skipped` or `failed`. A failed check is reported with its fix; the student can fix it now or go on.

## Part B: your job queue

Part B builds the list of every job open to the student now or later. It asks no question about job boards or kinds of employer, and it shows no grades or top picks.

First batch, about you. Reply rules: "all recommended" or "ok" accepts every default; "7: 2" changes only item 7.

1. Resume. personal, no default. Does: every later step reads it. Paste it or give a path; a relative path starts in the career-ops folder. Read the file by type: `.md` and `.txt` directly, a PDF with your own file tool, a `.docx` with `node student/interview/resume-text.mjs <file>`. Keep the text as `cv_markdown`; give a path as `cv_path` only for a `.md` or `.txt` file. An empty resume is refused later, so do not go on without one.
2. Field or major. Does: picks the job lists and employer boards to read. (recommended) the field detected from your resume, because it matches your own words; say another major to override.
3. Tracks and graduation month. personal, no default. Does: internship, co-op or new grad, each with its graduation month, so postings match your cycle.
4. Locations in order of preference. personal, no default. Does: filters postings to places you would work.
5. US citizen. personal, no default. Does: citizens keep postings that ask for clearance or citizenship; for everyone else the filters drop them.
6. Target roles. Does: short phrases that shape the title filters. (recommended) proposed from your resume, because each one is grounded in it.
7. Years of experience. Does: drops roles above your level. (recommended) 0, the right value for most students.
8. Time zone. Does: sets when the daily run fires. (recommended) this computer's time zone, because that is where it runs.
9. GitHub job lists. Does: reads public internship and new-grad lists (the `github-lists` plugin; show its capability card). (recommended) on: they are the widest free source of postings.

After the reply, with no further prompt, do these in order:

1. Run `node student/interview/detect-field.mjs` on the resume text: `cv.md`, the `.md` or `.txt` path, or `-` with the text piped in on stdin. Do not write `cv.md` yet. It prints the two best-fitting field presets with a score and the resume lines that matched. Use the best one the student did not override; a pick below 2 matches is `byo-employer-list`. Tell the student which preset was used and why.
2. Write `data/interview-answers.json` with presets, tracks, locations, archetypes, timezone, the resume, `us_citizen`, `experience_years` and `signins`, then run `node student/interview/apply-answers.mjs data/interview-answers.json --stage queue`. If it exits non-zero, nothing was written; fix the listed problems and run it again.
3. Research sources for the student's field, whatever it is. Use at most 5 web searches in this chat across: public GitHub job-list repos for the field, employer career boards on Greenhouse, Lever or Ashby, and general web search for roles like the student's target roles. Use public pages only: no sign-in, no LinkedIn or Handshake search. Write what you found to `data/research-candidates.json` as `{"web_searches": N, "boards": [{"name", "careers_url"}], "github_lists": [{"repo", "path", "kind"}]}`, then run `node student/scripts/research-sources.mjs`. It vets every candidate (robots.txt, a readable board, no duplicate of a list the student already has, at least 5 matching rows for a list) and writes only the survivors. Show its summary as printed: what was added, what was skipped and why, and its cost line.
4. Enable the GitHub-lists plugin only after showing its capability card: run `node plugins.mjs enable github-lists`, show the card, and run it again with `--confirm` only after the student agreed in item 9. If the chosen presets include `policy-government`, offer the NYC Jobs feed the same way: say "Policy and government students can also read recent City of New York student and entry-level postings from NYC Open Data. It needs no account or key. Enable it?", run `node plugins.mjs enable nyc-jobs`, show its card, and run it again with `--confirm` only after the student says yes. For `policy-government` students also offer the USAJOBS feed: say "Federal student and recent-graduate postings can come from the USAJOBS API. It needs your own free API key, which you request at developer.usajobs.gov with your email; I cannot request it for you. Put USAJOBS_API_KEY and USAJOBS_EMAIL in your .env yourself. Want to enable it?", then run `node plugins.mjs enable usajobs`, show its card, and run it again with `--confirm` only after the student says yes. Without a yes, or without a key in `.env`, the USAJOBS feed stays off, and the agent never requests the key for them.

Second batch, alerts. Run `node student/scripts/alert-plan.mjs` and show its numbered items as one batch (LinkedIn, Handshake, Simplify, Indeed, and USAJOBS for policy students), each with its purpose, its recommended or optional tag with the reason, and the prefilled search page; add the nyc-jobs and usajobs items when they apply. Reply rules: "all recommended" or "ok" accepts the recommended items, "do it for me" opens the pages only, and "3: skip" changes only item 3. The student presses the button on each site and turns on email alerts; you open the pages, wait, and check that each alert shows as saved. Never search or scrape LinkedIn or Handshake yourself, and never enter a password.

Then show the queue:

1. When the Gmail check passed in Part A, run the inbox step in this chat now with `modes/inbox.md` so any alert mail already waiting is staged.
2. Run `node student/scripts/first-run.mjs --queue`. It takes about 10 minutes: tell the student, run it in the foreground and wait for it to exit. Do not start it in the background or go on while it runs.
3. Show its raw queue as printed: how many postings wait, from which sources, the newest ten, and the sources that are upcoming or checked by hand. Show no grades and no top picks.
4. Print the coverage line for each chosen preset, exactly as `interview/coverage.mjs` returns it, and do not soften it. A preset that is discovery help only says so. For `policy-government`, also tell the student to set up a USAJOBS saved search with email alerts: the inbox pass reads those alerts, and the pack has no USAJOBS key to set up.

Save the answers file.

## Part C: application profile

One batch for what forms ask for again and again. Reply rules: "all recommended" or "ok" accepts every default; "4: immediately" changes only item 4. Items marked "personal, no default" need an answer.

1. Identity. personal, no default. Does: name, email, phone, city, LinkedIn and GitHub for forms. Propose each from the resume and let the student correct them.
2. Work authorization. personal, no default. Does: answers "are you authorized to work" in the student's words, for example "F-1 with OPT" or "US citizen".
3. Needs sponsorship. personal, no default. Does: answers the sponsorship question: yes or no.
4. Start date. Does: answers "when can you start". (recommended) the month after graduation as `YYYY-MM`, because it matches your track. Other: `immediately`.
5. Relocation. Does: answers "willing to relocate". (recommended) `within-locations`, because it keeps you to the places you named. Other: `yes`, `no`.
6. How did you hear about us. Does: fills that box. (recommended) "Online job search", because it is true for every posting the pack finds.
7. Resume variants. Does: names one resume per track with a page limit. (recommended) one page per track, because that is what recruiters read. The files themselves stay under the student's control.
8. Priority companies, blacklist, dealbreakers and target employers. Does: ranks, hides or adds employers (dealbreakers are phrases such as "unpaid" or "on-site only outside my metros"). (recommended) none now, because Part B already added employers for your field; add them any time.

The six EEO questions below are voluntary and usually not seen by the hiring team. They have no recommended value: "all recommended" and "ok" do not cover them. Each takes a value in the student's words or "decline", which is stored as the string `decline` and shown as "decline to self-identify". If any are left unanswered, ask for only those once, in the same reply to the student's answers.

9. Gender. personal, no default. Does: fills the gender question on forms.
10. Race or ethnicity. personal, no default. Does: fills that question.
11. Hispanic or Latino. personal, no default. Does: fills that question.
12. Veteran status. personal, no default. Does: fills that question.
13. Disability status. personal, no default. Does: fills that question.
14. Pronouns. personal, no default. Does: fills that question.

If the student needs sponsorship, offer upstream's h1b-sponsor plugin: show its capability card with `node plugins.mjs enable h1b-sponsor` and run it again with `--confirm` only after the student agrees. Record `application_profile` with `eeo` as a map of the six items (never the older `leave-blank` or `ask-each-time`), and save the answers file.

## Part D: schedule and switches

Before the disclosures, read this disclaimer once, word for word. Do not repeat it later in the interview.

This pack is not affiliated with or endorsed by LinkedIn, Handshake, career-ops or any employer. You are responsible for following the terms of every site you use it with. LinkedIn and Handshake automation can lead to limits or restrictions on your accounts; both are on by default and each can be switched off at any time ("stop outreach", "stop handshake"). The software comes with no warranty of any kind (MIT license).

Read these two disclosures aloud before asking, then record the answer.

LinkedIn outreach. LinkedIn's terms restrict automated activity, and the status of an assistant that drafts and sends messages in the student's own signed-in browser is ambiguous. It can put the account at risk. Outreach is therefore capped by hard limits, never runs unattended, and can be set to `on`, `drafts` (drafts only, the student sends) or `off`. At any time the student can say "stop outreach" and it ends for good until they say otherwise.

Handshake. Handshake's terms are ambiguous about automated browsing in the same way. The Handshake pass is on by default and can be turned off; "stop handshake" ends it at once.

Then one batch. Reply rules: "all recommended" or "ok" accepts every default; "5: 9am" changes only item 5. These defaults never loosen a safety limit: nothing is submitted without the student's yes, Gmail stays read-only and the budget caps stay.

1. Automation. Does: what runs by itself each day. (recommended) `scheduled-discovery-plus-triage`, because it finds and scores postings while you are away; it needs the chosen agent signed in on this computer. Other: `manual`, `scheduled-discovery`.
2. Time. Does: when the daily run starts, in your time zone. (recommended) 06:00, because the queue is ready before your day starts.
3. Inbox pass. Does: runs after the daily run with Gmail read tools only, stages alert jobs and reads company replies; each run costs about 15,000 tokens on a typical day and at most about 60,000 (docs/usage-cost.md, "The inbox pass"). (recommended) on only when the Part A check passed, automation is not `manual` and the mail path is `connector`; otherwise show it off with the plain reason.
4. Model tier. Does: the model quality for triage. (recommended) `standard`, because it is the lowest tier that judges postings well. Other: `premium`. There is no economy tier.
5. Plan. Does: only sets the wording of the cost estimates. (recommended) `unknown`; or name your plan: `claude-pro`, `claude-max`, `claude-ultra`, `chatgpt-plus`, `chatgpt-pro` or `api`.
6. Triage budget. Does: caps the rows scored by the model: daily and on the first run. (recommended) 20 a day and 60 on the first run, because they keep a normal plan well inside its limits. Other: any whole number or "all". For each value above its default, run `node student/scripts/triage-budget.mjs cost <n|all> --plan <plan> --agent <agent> --spend-tier <standard|premium>` and show the printed cost line, an estimate, before accepting it. Record `triage_budget.daily` and `triage_budget.first_run` only when they differ from the defaults.
7. Daily target. Does: applications you aim to prepare a day. (recommended) 10; the ceiling still applies.
8. Mail path. Does: how mail is read. (recommended) `connector`, because only it runs unattended. Other: `paste`, `gmail-plugin`.
9. Outreach. Does: one daily round drafts and sends at most the capped connection requests and messages, and every send needs your "send all" or "send 1,3". (recommended) `on`, because the caps and your approval keep it safe. Other: `drafts` (the cautious option: drafts only, you send), `off`.
10. Handshake pass. Does: reads your Handshake saved searches. (recommended) `on`. Other: `off`.
11. Who presses submit. Does: decides who submits applications. (recommended) `user`, because nothing is submitted without your yes. Other: `agent`.
12. LinkedIn account tier. Does: sets the connection-request limit. (recommended) `free`. Other: `premium`.

Below the limits table, say this once: the pack's ceilings (daily applications, connection requests, messages, profile views, and the score floor) are fixed in `scripts/budget.mjs` in the student folder. Limits can only be tightened: daily and rolling caps can be set lower, while minimums (the score floor, which starts at 3.5, the gap between actions, and nudge wait days) can be set higher. Looser values are clamped and logged. The triage budget is not one of these limits: it is the student's own, and Part D sets it. A student with an unusual reason to evaluate lower-scoring jobs can read them in the pipeline file, but the pack will not apply to them.

The reply confirms the summary. Do not ask for the agent: record `agent` as `codex` when this interview runs in Codex and `claude` when it runs in Claude Code. Then, in this order:

1. Write the answers to `data/interview-answers.json` following `interview/answers.schema.json`, set `inbox_schedule` from item 3, read the file back in a short summary, then run `node student/interview/apply-answers.mjs data/interview-answers.json`. If it exits non-zero, nothing was written; fix the listed problems and run it again. If it prints `inbox pass left off`, tell the student why.
2. Run `node doctor.mjs --json` and report anything not green. Do not mark setup done while doctor reports unpersonalized files.
3. Unless automation is `manual`, run `node student/scripts/schedule.mjs install` and tell the student the time it was set for. It reads the time in the student's time zone and prints the matching time on this computer's clock when the two differ.
4. Run `node student/scripts/schedule.mjs verify`. It proves the installed job starts this folder and that the daily run, the inbox pass and the triage agent each pass their check. Report a failed step with its fix.
5. Score the first rows. Run `node student/scripts/first-run.mjs --list-only`; it skips the ingest, so it takes seconds and makes no model call. Triage the listed rows in this chat with the triage mode, standard model tier at minimum. Write one line per row as `TRIAGE: PASS|MARGINAL|FAIL|SKIP|EXPIRED|BROWSER | <url> | <score> | <reason>` to a file in the data folder and run `node student/scripts/apply-triage.mjs <file>`, then run `node student/scripts/triage-budget.mjs log <n> --first-run` with the number of rows applied. If more rows remain untriaged, say how many. Only `scheduled-discovery-plus-triage` scores them on its own, up to the daily triage budget a day; with `manual` or `scheduled-discovery` they wait until the student asks for triage in a session.
6. Run `node student/scripts/rank-queue.mjs --n 10` and show the top 10. If fewer than 10 rows come back and untriaged rows remain, say so plainly ("top N so far: M of T rows scored, N cleared your score floor") and offer one more batch while rows remain: run `node student/scripts/first-run.mjs --list-only` again, triage the rows it lists and rank again. Each batch uses model time, so ask before each one, and stop when the first-run budget is used. A student who already used the first-run budget can raise it with `node student/scripts/triage-budget.mjs set <n|all> --first-run`, which shows the estimate first; run it again with `--confirm` only after the student says yes. If no untriaged rows remain, say the exact count and why: the live sources hold no more postings that fit the student's setup today, and the daily run keeps looking. Then walk through the top three postings with the student, using `modes/apply-loop.md` from the student folder. Nothing is submitted without the student's yes during this first run.
7. Last message: read `docs/commands.md` from the student folder and show it grouped as it is written (daily use, applying, outreach, inbox, settings, help), then say "say help any time to see this again".
