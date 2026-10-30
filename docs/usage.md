# Daily use

This guide covers what you do after `node student/install.mjs` has run. Every command is run from your career-ops folder. If you need to clone the pack again, use the clone address from the pack page you were sent.

## Start with the interview

Every Claude Code or Codex session begins with `scripts/session-start.mjs` from the student folder. It prints at most six lines: the update result, any budget notes, and a last line that says what happens next. When config/student.yml is missing or the interview is not finished, the last line starts with `INTERVIEW:` and the agent runs the personalization interview before anything else.

The interview reads your resume first (paste it, give a PDF or Word file, or put it in cv.md), proposes your field from what the resume says and shows the lines that led to the proposal. It then asks about graduation dates, locations, 10 to 20 target employers, whether you are a US citizen, the answers application forms ask for again and again (start date, relocation, EEO questions, how you heard about the job), the LinkedIn and Handshake switches, how you want your mail read and whether to set up a daily schedule. It writes config/student.yml from your answers and prints a coverage line that says how many employers and job lists your presets reach. Read that line: a low number means your field is thinly covered and you should add employers by hand. A blank resume stops the interview before anything is written.

Answering yes to the US citizen question keeps postings that ask for clearance or citizenship in your lists; any other answer filters them out. Running the interview again rewrites only the blocks the pack marked in your files. A title filter you edited in portals.yml is kept, and the interview lists the rules it did not apply. If portals.yml has a typo that stops it from loading, the interview stops before it changes any file and names the line; fix the file or move it aside, then run the apply step again. A location such as "Boston, MA" also keeps postings that name only "Boston". Companies you want to work for are not added to the do-not-apply list; only companies you want to avoid go there.

## First run

The interview ends with the first run, and you can repeat it any time:

```
node student/scripts/first-run.mjs
```

It makes no model call. It prints one line per step (`first-run: github-lists ok`, `first-run: scan FAILED (reason)`, and so on (a scan that stops early is tried a second time before it is reported as failed) for merge-post and prefilter+triage), then these counts:

- `Pending rows: N`, followed by one `src=<source>: N` line for each source tag found on a row.
- `Untriaged Pending rows: N`, the rows with no triage score yet.
- `First-run triage budget: 60 rows (N scored so far, batches of 20)`, the rows the first run may score (60 by default, any whole number or `all`). First-run rows count across every date, so rerunning the interview does not hand out a fresh 60.
- Up to 20 of those rows as `url | company | title`, never more than the rows left in the first-run budget. When more exist, the last line is `... and N more untriaged Pending rows`; with none it says `no untriaged Pending rows`; with the budget used it lists none and says the daily triage scores the rest. Add `--n 10` to show fewer or more.

Claude then scores the listed rows in your session, applies the verdicts with `node student/scripts/apply-triage.mjs <file>` and records the count with `node student/scripts/triage-budget.mjs log <n> --first-run`. To raise the first-run budget, see the triage budget below (`set <n|all> --first-run`). `node student/scripts/rank-queue.mjs --n 10` shows your top 10. If the top list is empty, the likely causes are an empty feed that day, a field with thin coverage or titles that do not fit your graduation cycle; run the first run again tomorrow or add target employers.

You can say "stop outreach" or "stop handshake" at any time. Both are on by default and either one turns the matching feature off in config/student.yml.

## Schedule the daily run (optional)

Nothing runs on a timer until you ask for it. The interview offers it, or you can do it yourself:

```
node student/scripts/schedule.mjs install --time 07:30
node student/scripts/schedule.mjs status
node student/scripts/schedule.mjs remove
```

`schedule.mjs install` adds a launchd agent on macOS and a Task Scheduler task on Windows. Both start `scheduled.mjs`, which runs the daily run and then, only when `automation` is `scheduled-discovery-plus-triage`, the daily triage. Both use the absolute path of the Node you ran it with, the full path of your career-ops folder and, when it finds one on your PATH, the absolute path of the configured agent. `schedule.mjs` passes it to `scheduled.mjs` as `--agent` and `--agent-path`; the older `--claude` spelling is still honoured. If automation is `scheduled-discovery-plus-triage` and the agent is not found, install still works and prints a warning that every scheduled run will skip triage and say so in the digest. On Windows the task is set to run late if the computer was off at the chosen time and to run on battery. Without `--time` the time from config/student.yml is used, which is 06:00 by default. Both are read in the `timezone` from config/student.yml; launchd and Task Scheduler fire on the computer's own clock, so install converts the time with today's offsets and prints a line such as `time: 06:30 America/Chicago is 04:30 on this computer's clock (America/Los_Angeles)` when the two zones differ. Run install again after a trip that changes the computer's time zone. `schedule.mjs remove` takes the job away again. Add `--dry-run` to either command to print what it would do, including the agent path it found, without changing anything. A schedule installed before this version still starts `daily.mjs` directly: run `node student/scripts/schedule.mjs install` again to get the daily triage; until then the digest carries a note saying so.

Logs go to the logs folder under data.

## What the daily run does

`node student/scripts/daily.mjs` is the unattended run. It makes no model calls, opens no browser and sends nothing. It takes a run lock in the file .student-daily.lock in the data folder; if another run holds it for under 12 hours, it writes an ABORT line to run-log.md in the data folder and stops.

In order, it:

1. Copies `applications.md` and `pipeline.md` into `data/.snapshots/<date>/` and keeps the newest 7 folders.
2. On the first run of a month (days 1 to 7), refreshes the graduation cycle, looks for new job lists and runs the portal audit summary.
3. Runs the GitHub job-list plugin and the scan.
4. On Sundays, checks whether Pending postings are still open, without a browser.
5. Merges new rows into the pipeline and applies the free title filter.

The result is `data/digest/student-<date>.md`, with one line per step, a list of failures, any notes and the count of Pending rows. A failed step never stops the run and the exit code is always 0, so look at the digest. `node student/scripts/daily.mjs --dry-run` prints the steps it would run, with the monthly and Sunday steps only on the days they apply, and writes nothing.

## Daily triage (optional)

With `automation: scheduled-discovery-plus-triage` the installed schedule runs `node student/scripts/daily-triage.mjs` after the daily run. It sends up to your daily triage budget of untriaged Pending rows (20 a day unless you choose another whole number or `all`; 0 turns it off), minus the rows already scored today, in calls of 20 rows. Each call is one agent call that has no tools. The `agent` key in config/student.yml picks it: `claude` runs a `claude -p` call, and `codex` runs a read-only `codex exec` call with its tools disabled (a preview; see [codex.md](codex.md)). For each chunk it first fetches the posting text itself (cut to 6000 characters; if that fails only the title and company are sent). Only well-formed verdict lines for rows that were sent are applied, one per row; every other line is dropped and counted as ignored.

The digest gets a line after each chunk (`daily triage chunk k of m: triaged N, passed N, ignored N`), then `daily triage: triaged N, passed N, ignored N` and a cost line with the rows scored today and an estimate of the tokens and dollars. The run stops at the first chunk that fails; verdicts already applied stay, and the rest wait for a later day. If claude is missing, signed out or too slow, the digest says why and pipeline.md stays as it was. Run the agent once in a terminal to sign in.

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

`status` shows the budgets, the rows scored today and the rows left. `cost` prices a number of rows, or `all` as the untriaged Pending rows there are now. `set` without `--confirm` writes nothing and prints the estimate; the same command with `--confirm` writes `triage_budget.daily` (add `--first-run` for the first-run budget). `log` records rows a session triaged, so they count today. `calibrate` stores your own before-and-after reading from `/usage` or `/status`. You can ask for a change in a session too; it runs the same two steps and asks you first.

## Mail: the inbox step

`node student/scripts/inbox.mjs` reads mail you give it. It never signs in to Gmail and never opens a link. Pick one backend with `--backend`:

- **connector**: Claude searches your mail through the Gmail connector in a session, saves the results to a JSON file in the data folder, and you run `node student/scripts/inbox.mjs --backend connector --input data/mail.json`. Use this when the connector is set up; it is the best fit for replies and assessments.
- **paste**: copy the messages into a text file, each with `Id:`, `From:`, `Subject:` and `Date:` lines, a blank line and the body, with a line holding only `---` between messages. Run `node student/scripts/inbox.mjs --backend paste --file data/mail.txt`. Use this when there is no connector.
- **gmail-plugin**: `node student/scripts/inbox.mjs --backend gmail-plugin` only runs `node plugins.mjs run gmail` for job alerts. It cannot read replies, so use connector or paste for those.

Mail from the last 2 days is read, and each message is read once (ids are kept in the file .student-inbox-seen in the data folder). A message from an assessment domain sets the tracker status to Assessment, and a plain reply from a company in your tracker sets Responded. Rejections, interview requests and scheduling requests are always proposals; you decide. Two messages from one company on the same day count as a conflict only when one is an Assessment and the other a Responded; you get a note to check by hand. Mail asking for a Social Security number, bank details, a password or a verify link is listed as suspicious: do not answer it. LinkedIn and Handshake job alerts become rows in pipeline.staging.md in the data folder that need a link. At most 5 one-line notices are printed per run. Use `--propose-only` to change nothing in the tracker and mark no message as seen, or `--dry-run` to change nothing at all.

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

Two notes you can add to a Pending row in `pipeline.md`:

- `hold=YYYY-MM-DD` keeps the row off the list until that date. On the date itself it is listed again. Free text may follow the date after a space, for example `hold=2026-11-05 (waiting on recruiter)`; only the date is read. A value that does not start with a date is ignored.
- `reserved-slot` reserves the company for that row: every other Pending row of the same company is hidden. Free text may follow it after a space or an opening bracket, for example `reserved-slot (last cap slot)`; the text is ignored. A key such as `reserved-slots` does not reserve anything.

If two rows of a company carry `reserved-slot`, the one listed first in `pipeline.md` keeps it.

The track check uses only applications already made, so one list can still show both tracks of a new company; the submit-time confirmation asks before the second is used.

The list header counts rows hidden by track rules or a reserved slot as blocked, and rows of a company that has already reached its cap. When a cap leaves partial room (cap 3, 2 applied, 3 eligible rows), the list shows only the remaining number and the trimmed rows are not counted. Its "(N waiting on referral timing)" count also includes rows held with `hold=DATE`, not only rows waiting on referral timing.

## Turning things off

- "stop outreach" turns LinkedIn outreach off; "drafts only" keeps drafts without sending.
- "stop handshake" turns the Handshake pass off.
- `node student/scripts/schedule.mjs remove` turns the daily run off.
- `node student/uninstall.mjs` takes the whole pack out of the career-ops folder and keeps your data; see the README.

The limits on messages, applications and page loads are fixed in `scripts/budget.mjs` in the student folder. Settings can only tighten them: a maximum can go down and a minimum (score floor, gap between actions, nudge wait days) can go up, never the reverse.
