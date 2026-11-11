# Daily use

This guide covers what you do after `node student/install.mjs` has run. Every command is run from your career-ops folder. If you need to clone the pack again, use the clone address from the pack page you were sent.

## Start with the interview

Every Claude Code or Codex session begins with `scripts/session-start.mjs` from the student folder. It prints at most six lines: the update result, any budget notes, and a last line that says what happens next. When config/student.yml is missing or the interview is not finished, the last line starts with `INTERVIEW:` and the agent runs the personalization interview before anything else.

The interview runs in four parts, each one numbered batch of questions. Every item says in one line what it does and gives a recommended answer with the reason; "all recommended" or "ok" accepts every default, and a reply such as "3: no, 5: 9am" changes only the items you name. Personal items (your name, resume, work authorization, EEO answers) have no default. A normal run takes five replies, or six when an EEO item is asked again.

- **Part A, sign-ins.** One list of every sign-in (the Gmail connector, LinkedIn, Handshake, and the optional Simplify and Indeed accounts), then one wait and one check of all of them. You sign in; the agent never asks for a password.
- **Part B, your job queue.** You give your resume, field, graduation dates and locations. The agent then researches job sources for your field on its own (see below), shows what it added and skipped, helps you create LinkedIn, Handshake and Simplify alerts, reads your alert mail, and shows the raw queue of postings with no grades.
- **Part C, application profile.** The answers forms ask for again and again: work authorization, sponsorship, start date, relocation, how you heard about the job, and six voluntary EEO questions (gender, race or ethnicity, Hispanic or Latino, veteran, disability, pronouns). Each EEO item takes a value or "decline"; there is no recommended value, and "all recommended" does not cover them.
- **Part D, schedule and switches.** The disclaimer and disclosures, then automation, time, the inbox pass, spend, daily target, mail path and the outreach, Handshake and submission switches. It installs and verifies the schedule, scores the first rows, shows your top 10 and ends with the guide in docs/commands.md.

It writes config/student.yml from your answers and prints a coverage line that says how many employers and job lists your presets reach. Read that line: a low number means your field is thinly covered; the research step in Part B and `node student/scripts/research-sources.mjs` add more. A blank resume stops the interview before anything is written.

Answering yes to the US citizen question keeps postings that ask for clearance or citizenship in your lists; any other answer filters them out. Running the interview again rebuilds the keys of config/student.yml that it asks about and rewrites only the blocks the pack marked in your other files; in config/profile.yml it replaces only the `application_answers` block and keeps every other line. Keys it never asks, such as your `rank` and `audit` settings, `judgment_keywords` and the measured triage figures, are kept, and the interview offers your current answers as the defaults. A title filter you edited in portals.yml is kept, and the interview lists the rules it did not apply. If portals.yml has a typo that stops it from loading, the interview stops before it changes any file and names the line; fix the file or move it aside, then run the apply step again. A location such as "Boston, MA" also keeps postings that name only "Boston". Companies you want to work for are not added to the do-not-apply list; only companies you want to avoid go there.

## First run

Part B of the interview builds your queue one step per command (`node student/scripts/first-run.mjs --queue --step github-lists`, then `--step scan`, run a second time when it says `scan partial` (at most 2 slices of about 5 minutes; the boards research added and your target employers go first, then the boards whose name or address names one of your cities, and the daily run reads whatever is left), then `--step merge-post` and `--step prefilter+triage`), so no command runs past a 10-minute limit; `--queue --step view` prints the postings waiting, a count per source, the 10 newest rows and the sources that are upcoming or checked by hand, with no scores. Part D then scores the first rows after the schedule check. You can repeat the first run any time:

```
node student/scripts/first-run.mjs
```

It makes no model call. It prints one line per step (`first-run: github-lists ok`, then `nyc-jobs` and `usajobs` when you enabled those feeds, `first-run: scan FAILED (reason)`, and so on (a scan that stops early is tried a second time before it is reported as failed) for merge-post and prefilter+triage), then these counts:

- `Pending rows: N`, followed by one `src=<source>: N` line for each source tag found on a row.
- `Untriaged Pending rows: N`, the rows with no triage score yet.
- `First-run triage budget: 60 rows (N scored so far, batches of 20)`, the rows the first run may score (60 by default, any whole number or `all`). First-run rows count across every date, so rerunning the interview does not hand out a fresh 60.
- Up to 20 of those rows as `url | company | title`, never more than the rows left in the first-run budget. When more exist, the last line is `... and N more untriaged Pending rows`; with none it says `no untriaged Pending rows`; with the budget used it lists none and says the daily triage scores the rest. Add `--n 10` to show fewer or more.

To list the rows again without bringing in new postings (for one more batch), add `--list-only`: `node student/scripts/first-run.mjs --list-only` skips the ingest steps and prints only the counts and the rows.

The agent then scores the listed rows in your session, applies the verdicts with `node student/scripts/apply-triage.mjs <file>` and records the count with `node student/scripts/triage-budget.mjs log <n> --first-run`. To raise the first-run budget, see the triage budget below (`set <n|all> --first-run`). `node student/scripts/rank-queue.mjs --n 10` shows your top 10 (`--n N` shows a different number). If the top list is empty, the likely causes are an empty feed that day, a field with thin coverage or titles that do not fit your graduation cycle; run the first run again tomorrow or add target employers.

You can say "stop outreach" or "stop handshake" at any time. Both are on by default and either one turns the matching feature off in config/student.yml.

## Schedule the daily run (optional)

Nothing runs on a timer until you ask for it. The interview offers it, or you can do it yourself:

```
node student/scripts/schedule.mjs install --time 07:30
node student/scripts/schedule.mjs status
node student/scripts/schedule.mjs remove
```

```
node student/scripts/schedule.mjs verify
```

`schedule.mjs verify` reads the installed job, checks that it starts this folder's `scheduled.mjs`, runs each enabled step's check (the daily run, the inbox pass, the triage agent) and prints `schedule verified` or the step that failed and how to fix it. `schedule.mjs install` refuses to replace a job that starts another folder's `scheduled.mjs` unless you add `--replace`. On Windows the unattended inbox pass is proven on your own computer by the Part A check and `schedule.mjs verify`.

`schedule.mjs install` adds a launchd agent on macOS and a Task Scheduler task on Windows. Both start `scheduled.mjs`, which runs the daily run, then the inbox pass when `mailbox.schedule` is `on`, then, only when `automation` is `scheduled-discovery-plus-triage`, the daily triage. Both use the absolute path of the Node you ran it with, the full path of your career-ops folder and, when it finds one on your PATH, the absolute path of the configured agent. `schedule.mjs` passes it to `scheduled.mjs` as `--agent` and `--agent-path`; the older `--claude` spelling is still honoured. If automation is `scheduled-discovery-plus-triage` and the agent is not found, install still works and prints a warning that every scheduled run will skip triage and say so in the digest. On Windows the task is set to run late if the computer was off at the chosen time and to run on battery. Without `--time` the time from config/student.yml is used, which is 06:00 by default. Both are read in the `timezone` from config/student.yml; launchd and Task Scheduler fire on the computer's own clock, so install converts the time with today's offsets and prints a line such as `time: 06:30 America/Chicago is 04:30 on this computer's clock (America/Los_Angeles)` when the two zones differ. Run install again after a trip that changes the computer's time zone. `schedule.mjs remove` takes the job away again. Add `--dry-run` to either command to print what it would do, including the agent path it found, without changing anything. A schedule installed before this version still starts `daily.mjs` directly: run `node student/scripts/schedule.mjs install` again to get the daily triage. `node student/update.mjs` reads the installed schedule (the launchd plist on macOS, the task's arguments on Windows) and prints `schedule: installed by an older pack, so the daily run skips triage. Run `node student/scripts/schedule.mjs install` again.` when it does not start `scheduled.mjs`, or a similar line when it lacks the configured agent's path. It never changes the schedule itself. A direct `daily.mjs` run with `scheduled-discovery-plus-triage` also puts a note in the digest saying triage did not run.

Logs go to the logs folder under data.

## What the daily run does

`node student/scripts/daily.mjs` is the unattended run. It makes no model calls, opens no browser and sends nothing. It takes a run lock in the file .student-daily.lock in the data folder; if another run holds it for under 12 hours, it writes an ABORT line to run-log.md in the data folder and stops.

In order, it:

1. Copies `applications.md` and `pipeline.md` into `data/.snapshots/<date>/` and keeps the newest 7 folders.
2. On the first run of a month (days 1 to 7), refreshes the graduation cycle, looks for new job lists and runs the portal audit summary.
3. Runs the GitHub job-list plugin, the NYC Jobs and USAJOBS feeds if you enabled them, and the scan. To turn a feed on later, run `node plugins.mjs enable nyc-jobs` (or `usajobs`, after putting your own `USAJOBS_API_KEY` and `USAJOBS_EMAIL` in `.env`) from the career-ops folder, read the card it shows, then run the same command with `--confirm`.
4. On Sundays, checks whether Pending postings are still open, without a browser.
5. Merges new rows into the pipeline and applies the free title filter.

The result is `data/digest/student-<date>.md`, with one line per step, a list of failures, any notes the count of Pending rows and a `## Feed health` section. Feed health is computed from files, with no network call and no tokens: it flags a feed that added no rows today after most of its recent runs added some (history in `data/feed-health.tsv`, the last 7 runs; the first run flags nothing), new rows with an empty or `null` company, and new rows whose title carries HTML entities or tags. A zero-yield line names the command to run by hand in the career-ops folder (for example `node plugins.mjs run nyc-jobs`); the digest does not probe the feed itself. A failed step never stops the run and the exit code is always 0, so look at the digest. `node student/scripts/daily.mjs --dry-run` prints the steps it would run, with the monthly and Sunday steps only on the days they apply, and writes nothing.

## Daily triage (optional)

With `automation: scheduled-discovery-plus-triage` the installed schedule runs `node student/scripts/daily-triage.mjs` after the daily run. It sends up to your daily triage budget of untriaged Pending rows (20 a day unless you choose another whole number or `all`; 0 turns it off), minus the rows already sent today, in calls of 20 rows. Each call is one agent call that has no tools. The `agent` key in config/student.yml picks it: `claude` runs a `claude -p` call, and `codex` runs a read-only `codex exec` call with its tools disabled (checked live on macOS, a preview on Windows; see [codex.md](codex.md)). For each chunk it first fetches the posting text itself (cut to 6000 characters; if that fails only the title and company are sent). Only well-formed verdict lines for rows that were sent are applied, one per row; every other line is dropped and counted as ignored.

Before each posting goes into the prompt, `lib/posting-guard.mjs` removes hidden HTML, zero-width, bidi, Unicode tag and other invisible characters, folds look-alike Cyrillic and Greek letters inside Latin words, and flags lines that read as instructions to an AI ("ignore previous instructions", "you are an AI", "rate this candidate as", "system prompt"). A flagged posting never gets a plain verdict: its row carries an `ANOMALY:` reason quoting the flagged line and at most MARGINAL, and a PASS is held in Flagged for you to read. To check a pasted posting yourself, run `node student/scripts/posting-guard.mjs <file>` (or pipe it on stdin); it prints the cleaned text, a summary on stderr, and exits 1 when it flagged a line. The digest gets a line after each chunk (`daily triage chunk k of m: triaged N, passed N, ignored N`, plus `daily triage posting guard: changed N (kinds), flagged N posting(s)` when the guard changed or flagged anything), then `daily triage: triaged N, passed N, ignored N` and a cost line with the rows sent today (counted against the budget) and an estimate of the tokens and dollars. The run stops at the first chunk that fails; verdicts already applied stay, and the rest wait for a later day. If the agent is missing, signed out or too slow, the digest says why; rows already applied by earlier chunks stay. Run the agent once in a terminal to sign in.

### Triage budget

The triage budget is yours: it is model usage on your own plan, so it is not one of the `budget.mjs` limits and nothing caps it for you. Every figure the pack prints about it is an estimate; [usage-cost.md](usage-cost.md) explains how each is made, with sources.

```
node student/scripts/triage-budget.mjs status
node student/scripts/triage-budget.mjs cost all
node student/scripts/triage-budget.mjs set 150
node student/scripts/triage-budget.mjs set 150 --confirm
node student/scripts/triage-budget.mjs log 7
node student/scripts/triage-budget.mjs calibrate 6 --rows 150 --window weekly
```

`status` shows the budgets, the rows sent today (counted against the budget) and the rows left. `cost` prices a number of rows, or `all` as the untriaged Pending rows there are now. `set` without `--confirm` writes nothing and prints the estimate; the same command with `--confirm` writes `triage_budget.daily` (add `--first-run` for the first-run budget). `log` records rows a session triaged, so they count today. `calibrate` stores your own before-and-after reading from `/usage` or `/status`. You can ask for a change in a session too; it runs the same two steps and asks you first.

## Mail: the inbox step

`node student/scripts/inbox.mjs` reads mail you give it. It never signs in to Gmail and never opens a link. Pick one backend with `--backend`:

- **connector**: Claude searches your mail through the Gmail connector in a session, saves the results to a JSON file in the data folder, and you run `node student/scripts/inbox.mjs --backend connector --input data/mail.json`. Use this when the connector is set up; it is the best fit for replies and assessments.
- **paste**: copy the messages into a text file, each with `Id:`, `From:`, `Subject:` and `Date:` lines, a blank line and the body, with a line holding only `---` between messages. Run `node student/scripts/inbox.mjs --backend paste --file data/mail.txt`. Use this when there is no connector.
- **gmail-plugin**: `node student/scripts/inbox.mjs --backend gmail-plugin` only runs `node plugins.mjs run gmail` for job alerts. It cannot read replies, so use connector or paste for those.

Mail from the last 2 days is read, and each message is read once (ids are kept in the file .student-inbox-seen in the data folder). A message from an assessment domain sets the tracker status to Assessment, and a plain reply from a company in your tracker sets Responded. Rejections, interview requests and scheduling requests are always proposals; you decide. Two messages from one company on the same day count as a conflict only when one is an Assessment and the other a Responded; you get a note to check by hand. Mail asking for a Social Security number, bank details, a password or a verify link is listed as suspicious: do not answer it. Alert mail from LinkedIn, Handshake, Simplify, Indeed and USAJOBS becomes rows in pipeline.staging.md in the data folder. An alert that lists its jobs stages one row per job: a Handshake job gets its Handshake page address, and with `--resolve` (the scheduled pass always uses it) the pack looks the job up on the employer's own Greenhouse, Lever or Ashby board, reading robots.txt first, and stages the employer's address so the row reaches Pending. A job it cannot confirm there stays in Flagged as needs-url with its source noted; the pack never opens a LinkedIn, Indeed or Simplify link.

### Scheduled inbox pass

With `mailbox.schedule` set to `on` (Part D turns it on after the Gmail check passes), `scheduled.mjs` starts `node student/scripts/inbox-pass.mjs` after the daily run. It makes one headless agent call with the Gmail read tools only: Gmail write tools are denied, every tool the run called is audited, and a run that called anything else is discarded. The pass stages alert jobs, applies the same status rules as above and writes counts to the digest's `## Inbox` section; proposed status changes wait for your answer. A failed pass is one digest line with its reason and fix. `node student/scripts/inbox-pass.mjs --check` tests it by hand, and "turn off the inbox pass" sets `mailbox.schedule` to `off`. Its token cost per run is in docs/usage-cost.md.

### Finding more sources and saved answers

`node student/scripts/research-sources.mjs` vets job boards and GitHub lists your agent found for your field and adds the ones that pass to your lists, and `node student/scripts/profile-answers.mjs show` prints the application answers the apply mode fills from. `node student/scripts/alert-plan.mjs` prints the alert steps again. At most 5 one-line notices are printed per run. Use `--propose-only` to change nothing in the tracker and mark no message as seen, or `--dry-run` to change nothing at all.

## Pilot report

`node student/scripts/pilot-report.mjs` prints one line per week with counts only: connection requests, accepts and the acceptance rate, messages, warnings, applications submitted, responses, assessments, interviews and offers, and the model cost when student-cost.tsv in the data folder exists. It prints no company names, links or message text and sends nothing anywhere, so it is safe to paste into a message to the person running the pilot.

## Tuning the apply list and the weekly audit

These keys go in config/student.yml. Most of them only narrow what the pack already does, and none of them can raise a limit in `scripts/budget.mjs`. A key you leave out keeps its default. `rank.metro_match` defaults to `word` and `audit.duplicate_reason` to `first`; set `substring` or `last` to get the looser matching some setups expect.

Weekly second look at skipped rows (`node student/scripts/fail-audit.mjs pick`):

- `audit.exclude_reasons`: a list of regular expressions, matched in any letter case. A skipped row whose reason matches one of them is not picked. Example: `- manual hold`.
- `audit.require_triage`: with `true`, rows whose triage note is missing, not a number, or zero or below are not picked. The default is `false`.
- `audit.keyword_match`: `word` (the default) matches each `judgment_keywords` entry at the start of a word. `substring` matches it anywhere, so the keyword `grad` also finds `undergrad`.
- `audit.duplicate_reason`: `first` (the default) or `last`. The default `first` matches the order a person reads the note left to right. When a skipped row carries more than one `reason=` note, this picks the one that is read for the second look. A row with a single reason note is not affected.

A reason that starts with "Title pre-filter" is never picked, whatever you set.

Daily apply list (`node student/scripts/rank-queue.mjs`):

- `rank.company_caps`: the most applications allowed per company in total, for example `Acme: 3`. `0` blocks the company entirely. The count is the larger of two numbers: the rows in `applications.md` at Applied, Responded, Assessment, Interview, Offer or Hired, and the submits logged in `action-log.tsv`. A row the tracker later marks Rejected stops adding to the first number, but its logged submit still counts, so a rejected application keeps using up the cap once it was logged. Room for a run is the smaller of the daily per-company limit left and the cap left, so a cap never lets a company past the daily limit.
- `rank.intern_only`: companies whose rows are listed only when the title says intern, internship or co-op. Example: `- Globex`.
- `rank.one_track_per_company`: with `true`, a row is hidden when its track (internship or full-time, read from the title) differs from a track already applied at that company. This only hides rows from the list. The submit-time track confirmation in `budget.mjs` stays on, and any `employer_policies` in your presets still apply at submit time.
- `rank.ignore_words`: extra lowercase words dropped from company names before they are compared, so `Acme International` and `Acme` count as one company. Letters and digits only.
- `rank.weights.effort`: a score bonus for rows that are quick to apply to. The default weight is `0`, so scores stay as they are until you set it, for example `effort: 2`. The factor is `1` for a row with a `prebuilt=yes` note, `0.8` when the posting host contains an entry of `rank.easy_apply_hosts`, and `0.5` for any other row. A `rank.weights` map you write replaces the default weights, so a factor you do not list weighs `0`. Add `effort` to your `rank.weights` map even at a low value; a map that omits it ignores effort.
- `rank.easy_apply_hosts`: the host names that count as quick to apply to. The default is `greenhouse`, `ashby` and `lever`. An entry matches any part of the host name, so a short entry such as `lever` also matches an unrelated host that contains it; write a specific entry such as `lever.co` or `ashbyhq.com` to narrow it. Letters, digits, dots and dashes only.
- `rank.contacts_format`: how `contacts.tsv` in the data folder is read. `stage` (the default) expects the columns date, company, name and stage. `status-notes` expects a tab-separated file whose header row has a `company` column and a `notes` column; the header may start with `# `. The notes column carries these tokens: `status:referred`, `status:warm`, `status:accepted`, `status:asked MM-DD` and `status:sent MM-DD (connect`, the last being a pending connection request. `status:warm` and `status:accepted` both mark the contact warm; `status:accepted` also cancels a pending connection request. `do-not-contact`, `do-not-ask` or `skipped` in the same notes also cancels it. MM-DD means this year, unless that date is after today, in which case it means last year. A month and day that does not exist, such as 13-45, is ignored. If the header has no `company` column or no `notes` column, rank-queue prints a warning and ignores contact state.
- `rank.metro_match`: how `rank.metros` entries are matched against a row's location. `word` (the default) matches whole words in any letter case, so the metro `LA` does not match `Atlanta GA`. `substring` matches an entry anywhere in the location.
- `rank.hold_on_pending_connect`: `true` (the default) keeps a row off the list while its company has a connection request under 5 days old and no referral yet. With `false`, such a row is listed. Use `false` if your setup only lowers the score of a row with a pending invite; the 3-day wait after a referral ask still applies either way.

Three notes you can add to a Pending row in `pipeline.md`:

- `closes=YYYY-MM-DD` is the posting's application deadline. A row that closes today through 7 days from today wins ties on score (the sooner date first) and its line ends with "closes in N days". A row whose date has passed is left out and counted as closed in the list header. The `usajobs` and `nyc-jobs` feeds fill it in from the date their API gives, through the notes column of `student-rows.tsv` in the data folder, which the ranker reads when the row has no `closes=` note of its own. When a posting you read states a deadline, the session adds `closes=` to that row's note. A value that does not start with a real date is ignored.

- `hold=YYYY-MM-DD` keeps the row off the list until that date. On the date itself it is listed again. Free text may follow the date after a space, for example `hold=2026-11-05 (waiting on recruiter)`; only the date is read. A value that does not start with a date is ignored.
- `reserved-slot` reserves the company for that row: every other Pending row of the same company is hidden. Free text may follow it after a space or an opening bracket, for example `reserved-slot (last cap slot)`; the text is ignored. A key such as `reserved-slots` does not reserve anything.

If two rows of a company carry `reserved-slot`, the one listed first in `pipeline.md` keeps it.

The track check uses only applications already made, so one list can still show both tracks of a new company; the submit-time confirmation asks before the second is used.

The list header counts rows hidden by track rules or a reserved slot as blocked, and rows of a company that has already reached its cap. When a cap leaves partial room (cap 3, 2 applied, 3 eligible rows), the list shows only the remaining number and the trimmed rows are not counted. Its "(N waiting on referral timing)" count also includes rows held with `hold=DATE`, not only rows waiting on referral timing.

## Fresh-context review and the research cache (optional)

- `reviewer`: `off` (the default) or `on`. With `on`, every 4.0+ application's tailored resume and cover letter go to a reviewer that has not seen your chat before the batch is shown to you (`modes/review.md`). It gets only `cv.md`, the posting, the drafts and the facts you gave in chat, makes no tool calls, and returns exact edits plus a list of every claim in the drafts that `cv.md` or your answers do not support. The session applies an edit only when it checks out, and the rule that nothing goes in a draft unless it comes from `cv.md` or you still decides. It spends model usage on each reviewed application, about 2 cents of API-equivalent on Claude and 3 on Codex; see [usage-cost.md](usage-cost.md#what-one-review-costs). `node student/scripts/review-app.mjs prompt ...` prints the exact text that would be sent and sends nothing.
- `research_cache_days`: how many days a company research note counts as fresh, a whole number of 1 or more (the default is 30). Notes live in `data/research/` on your computer; `node student/scripts/research-cache.mjs get "<company>"` prints a fresh note (exit 3 stale, exit 4 none), `put "<company>"` stores one, `list` shows them and `prune` deletes the stale ones (`--dry-run` lists first). A cached note is a lead only: the session re-checks any claim from it before it goes into a letter.

## Turning things off

- "stop outreach" turns LinkedIn outreach off; "drafts only" keeps drafts without sending.
- "stop handshake" turns the Handshake pass off.
- `node student/scripts/schedule.mjs remove` turns the daily run off.
- `node student/uninstall.mjs` takes the whole pack out of the career-ops folder and keeps your data; see the README.

The limits on messages, applications and page loads are fixed in `scripts/budget.mjs` in the student folder. Settings can only tighten them: a maximum can go down and a minimum (score floor, gap between actions, nudge wait days) can go up, never the reverse.
