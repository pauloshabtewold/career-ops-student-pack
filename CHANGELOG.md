# Changelog

One section per pack release, newest first. The release workflow writes each section from the first-parent commit subjects since the previous release, then moves the lines written by hand under Unreleased into that section as Details.

## Unreleased

## v0.11.0 (2026-11-22)

- Merge branch 'claude/v2-p4'

### Details

- M-005 (P4 Autopilot): each scheduled run ends with `scripts/autopilot.mjs` once setup has recorded `chrome_in_schedule`. It ranks the day, prepares fill plans, cover letters, outreach drafts and due follow-ups as one-page batches, and submits nothing without your approval. When the schedule reaches the automation Chrome it fills and submits approved, unsent items through `chrome.mjs` (whose `budget.mjs` check uses the plan's score; a posting is never submitted twice), but only items whose fill plan carries the form's fields, which today come from a session that read the form, and has no unknown question and no field only you fill (a government id, card or bank field). After the fill it submits only when every field was filled and a text field was typed; a field it could not fill, or an upload-only fill, holds the item. Any held item waits with its reason (fields only you fill are named, never their values) and the footer offers a session fill. It reads outcome mail with the newest message's sender address, at most 10 new conversations a run, and says how many more the next run reads; otherwise the digest names the steps waiting for Chrome and ends with Next, Type and Why. Rows and contacts already waiting for approval are not prepared again. Outcome mail sets a row only from the company's own registrable domain, for one clear row, with no conflicting same-day mail and never backwards.
- `node student/scripts/schedule.mjs pause` and `resume` stop and restart scheduled runs without removing them ("pause my schedule" now pauses; "remove my schedule" uninstalls). Missed runs are recorded in `data/student-runs.tsv`; the next run runs once and the digest lists the missed dates (7 at most, then a count).
- Outcome mail: a rejection, interview or offer from the tracked company's own domain sets the status when the phrase rules, the domain and (while T7 is off) the agent classifier agree; the prior status goes in the set-status note. Anything else stays a proposal. The scheduled inbox pass classifies outcome mail with its own agent.
- The digest's Today section is built by code: applied, outreach this week, replies waiting, missed runs, the day's token estimate (labelled an estimate) and, on Sundays, skill gaps seen in 3 or more matched postings. `triage-budget.mjs status --per-day` shows the per-day estimate.
- Ranking adds a reply-rate weight only for role-family or source groups with 5 or more applications.
- Weekly outreach lessons: plain-code reply and referral rates per opener and follow-up kind, plus one short model call over only new or changed threads (at most 12), written to `data/outreach-lessons.md` and read by the drafter as style guidance only. `outreach_lessons: off` in `config/levers.yml` turns it off.

## v0.10.0 (2026-11-22)

- Merge branch 'claude/v2-p3-winfix'
- Merge branch 'claude/v2-p3'

### Details

- M-004 (P3 Outreach): warm-first outreach. `scripts/outreach-state.mjs due` lists each contact's next step from `data/contacts.tsv` and the action log with no model call: a warm opener with no referral ask, a reply, a referral ask only after two exchanges while the company has an open posting, or the one follow-up. `scripts/outreach-drafts.mjs` drafts the round at the mid tier from cv.md and the contact's own data, checks each draft, and writes one-page batches; a draft naming a fact that is not in cv.md is flagged and left out. Every reply gets a suggested answer (lever T6 stays off).
- Outreach hygiene in `budget.mjs`: one active contact per company, one first message per person, no second connection request to the same person, and nothing after a no or an unanswered follow-up. A withdrawn invite, or one left unaccepted for 21 days, frees the company. Every LinkedIn send, email and application follow-up needs an item from an approved batch, and an item is spent once across all send kinds.
- Application follow-ups: one email per application, 7 to 10 days after the submit, checked as `apply.followup`.
- Gmail in the automation Chrome (`lib/gmail-chrome.mjs`) is the one path to read and send email. It sends only after `budget.mjs check gmail.send` passes for an approved item. The Gmail connector tools stay read-only.
- Conversations are kept as plain text, one file per contact, in `data/threads/` (student data only, no model call).
- Connection requests now default to 15 a day and 80 a week. A student may raise either up to the ceilings of 20 and 100 after approving the change; a higher value is clamped and the clamp is logged. The daily digest shows the outreach sent this week.
- Review fixes: the outreach round now batches connection requests (a note while this week's free notes last, else none) and each contact's one follow-up on the channel of their last message, so every send kind has an item to approve. A first message that asks for a referral is flagged.
- `budget.mjs`: a nudge needs an earlier message and keeps the one-active-contact-per-company rule. Outreach checks and logs need `--target` and `--company` (exit 2 without). `switches.outreach` at `drafts` or `off` also stops outreach email, and `outreach-drafts.mjs` then writes `data/outreach/drafts-<date>.md` or nothing. `gmail.send --followup` runs the application follow-up rules and never goes to a declined contact's address. A batch item is spent only on its own target. A connect limit of 0 is a valid lowering.
- `lib/gmail-chrome.mjs` takes the address, subject and text from the approved item, logs `gmail.pending` before the Send click, logs the send only after Gmail confirms it, reports a failed log, closes the compose tab, and logs each reply it reads as `linkedin.reply`. `batch.mjs status` shows outreach items as sent.
- An application follow-up goes into a batch only with an address: one logged for the application, or a recruiter or hiring contact at the company in `data/contacts.tsv`. Otherwise the round lists it under "needs an address", and `outreach-drafts.mjs --followup-to <application or company> <email>` adds it to today's batch.
- An unconfirmed `gmail.pending` email counts as sent to that contact in the hygiene rules and in `outreach-state.mjs`. A reply read through Gmail is logged once per reply. Application follow-ups are batched whatever the outreach switch says.
- M-004 live-verify fixes: an application is never an outreach contact, so an applied company no longer gets a `connect <url>` line. `outreach-drafts.mjs --followup-to "<Company>" <email>` works from the command line. The drafts round, `--followup-to` and `batch.mjs approve` now end with Next / Type / Why, and flagged drafts get their own footer with the prompt to fix them.
- Outreach drafts, warm prose with a separate claim check: the model writes each message body as natural prose from cv.md (and article-digest.md when there is one); the script writes the greeting, an application follow-up's opening with title, company and date, and an email's closing thanks and sign-off, takes off a greeting, Subject line, sign-off or restated application the model wrote, fills the placeholders and puts the message together once. Plain-code checks catch only certain problems (a placeholder of any shape after filling, a Subject line, more than one blank line in a row, the length limits, an http, www or email address the student's data and the company name do not hold, a referral ask in a first message, an empty body), with one redraft naming the problem, then a flag; a connection note over the limit is never cut. Every message that passes goes to a separate check call (`outreach-verify`, mid tier, its own usage-ledger row) that compares every statement about the student with the resume and answers one JSON object with exactly the key `unsupported`; an unreadable answer gets one more check, then a flag, and listed claims get one redraft and a second check, then a flag that quotes them for the student. The check also reads a "known true" list the script builds from the student's records, never from model text and never with a contact's display name or a posting title (the application's company and date, the dated history with the reader from `data/action-log.tsv` and `data/contacts.tsv`, the sentences the script wrote), and the resume's job titles word for word, with a changed title or level counted as unsupported. Each block of its prompt sits in its own fence with a random tag (one per round for the resume, so that prefix can be cached; one per call for the rest), and the drafting prompt fences the contact, their message and the application. A contact name with a line break, a control character or over 80 characters is held with no model call. Each call has a 3-minute limit; a call that fails or times out writes a ledger row with its status and flags only that message, and the round goes on. The checked text is the stored and sent text. A LinkedIn profile view stays research and never creates a contact.

## v0.9.0 (2026-11-22)

- Merge branch 'claude/v2-p2'

### Details

- M-003 (P2 Find jobs): the daily triage now runs free job-text rules before any model call (`lib/jd-rules.mjs`: years of experience, degree when the optional `degree` config key is set, closed postings, US state location, never keywords), skips postings whose text has not changed (`data/triage-cache.tsv`) and drops duplicate URLs before fetching. Only what is left goes to the model.
- Fresh jobs: `scripts/fresh-scan.mjs` scans Greenhouse, Lever and Ashby boards every hour with no model calls. It adds only the newest `fresh_first_scan` (default 25) postings on a board's first scan, and with `chrome_in_schedule` set or `--linkedin` it reads one LinkedIn past-hour search through `chrome.mjs read --links`, at most once per clock hour. `schedule.mjs install` adds the hourly entry on macOS and Windows; each run writes `data/digest/fresh-<today>.md`. New mode `modes/fresh-jobs.md`.
- Easy Apply: `chrome.mjs submit --kind easy-apply` needs an item from an approved batch, and `budget.mjs` caps it at `easy_apply_per_day` 12.
- Scam and ghost check (`lib/posting-risk.mjs`, off by default): a posting fails when the student is asked to pay or buy equipment from the employer's vendor, when a fake-check pattern appears, when a chat app is the only contact, or when the application email is off the employer's domain. Stipends, reimbursements, discounts and benefit checks pass. A title reposted often over a long period fails as a likely ghost job, using the repost history in `data/fresh-seen.tsv`.
- Handshake: alert mail that has only click-tracking links now yields job ids. `inbox.mjs` resolves each tracking link with one no-cookie request and reads the job id from the redirect.
- Triage calls to claude pass `--output-format json`, and the usage ledger records the reported tokens.

## v0.8.0 (2026-11-21)

- Merge branch 'claude/v2-p1'

## v0.7.0 (2026-11-21)

- Merge branch 'claude/v2-p0'
- Support career-ops 1.40.0 (#42)

### Details

- Quality baseline harness: every agent call has a 6 minute timeout and one retry, `capture --resume` runs only the calls not yet recorded, Codex rows record the model id from the codex header, and a Codex arm that keeps failing is parked so the Claude arms, noise and freeze still finish.
- M-001 (P0 Chrome spike): `scripts/chrome.mjs open|status|read|close` drives a dedicated automation Chrome profile (`data/chrome-automation`, DevTools on 127.0.0.1 only) through `lib/cdp.mjs` on Node's built-in WebSocket; a browser slot command (`BROWSER_SLOT_CMD` or `browser.slot_cmd`) runs before every launch and any non-zero exit means wait (exit 4); `tools/schedule-probe.mjs` proves with a one-shot launchd or Task Scheduler job whether a scheduled run reaches that Chrome and records `chrome_in_schedule`; the probe writes its dated evidence line to `data/chrome-probe.log` and leaves `chrome_in_schedule` unset when the automation Chrome was not open; `close` waits until the Chrome it started has exited, and `open` names the profile when a Chrome it did not record holds it; config gains `chrome_in_schedule`, `browser.automation_profile` and `browser.slot_cmd`; `docs/chrome.md` and the spike record `docs/chrome-spike.md`.
- Support career-ops 1.40.0: `compat.json` upstream.max is 1.40.0 and `docs/preset-audit.md` is re-counted for every preset against it. MetLife has no readable board and is watch-only in accounting, finance-economics and statistics-math-actuarial; Shield AI moved to Ashby in software-cs and engineering-mech-elec.
- The canary opens its failure issue again when the test job fails, and the setup tests follow `compat.json` upstream.max instead of a fixed version.
- The daily triage reads robots.txt and keeps the same-host request gap (or a longer Crawl-delay) before career-ops 1.40.0's `fetch-jd.mjs` fetches a posting on a careers site that is not a public ATS board, and skips the fetch when robots.txt refuses or cannot be read; a posting `fetch-jd.mjs` reports closed (exit 3, `CLOSED_POSTING`) gets an EXPIRED verdict without an agent call, and a board the scan reports as `partial` no longer counts as failed in the digest.

## v0.6.1 (2026-11-11)

- Live sign-in proof fixes: drafts guide, drafts file, Handshake search (#41)

### Details

- 991: live sign-in proof fixes: the guide says "drafts only" only lowers the outreach switch, drafts mode writes `data/outreach/drafts-YYYY-MM-DD.md` instead of pointing at a temp path, and the Handshake step opens the student's own search results

## v0.6.0 (2026-11-10)

- Student pack v0.6.0: interview A-D, automatic job-source research for any major, scheduled inbox pass, EEO from profile, command guide (#40)

### Details

- W-031: the personalization interview is four batched Parts (sign-ins, job queue, application profile, schedule and switches) with a recommended answer and reason for every item; per-major job-source research (`research-sources.mjs`, `lib/robots.mjs`) vets boards and GitHub lists for any field before they reach the scan; `alert-plan.mjs` prints prefilled LinkedIn, Handshake, Simplify and Indeed alert steps; `first-run.mjs --queue` shows the raw queue; the scheduled inbox pass (`inbox-pass.mjs`, Gmail read tools only) stages alert jobs and reads replies each day, with `schedule.mjs verify`; saved application answers include the six EEO items (`profile-answers.mjs`) and apply mode fills forms from them; `docs/commands.md` is the one guide to what to say, checked against the files that handle each phrase; `github-lists` 1.3.2; SECURITY.md
- 959: research accepts Workday, Jobvite, SmartRecruiters, Workable, BambooHR, Recruitee, Teamtailor, Breezy, Personio, Pinpoint, JazzHR and iCIMS boards, names why an audit failed, and reads a Greenhouse board over 10 MB with `max_response_mb`; the interview scan stops after 2 slices and reads research boards and target employers first; triage FAILs a posting that needs a credential the student will not hold in time and scores every row on its own text
- 959: `github-lists` 1.4.0 asks for a 48 MiB body cap so the 13 MB SimplifyJobs listings.json is read (upstream capped a plugin response at 10 MiB), reads research-added lists first, records `deferred` and `already_queued` per list so 0 new rows is explained, and the interview's github-lists step runs it up to 6 times until every enabled list is read; the session rules offer no update during the interview
959: review fixes: the extra fetch research makes for a Greenhouse board over 10 MB now times out after 8 seconds, waits out the site's robots.txt crawl-delay and is skipped with "time limit reached" once the research deadline has passed; the session rules say the first message that is not "help" still runs the session start steps; a portals.yml saved with Windows line endings (CRLF) keeps its research block readable
- 959: `github-lists` 1.4.1 dates in local time like the pack (the Simplify lists that failed once were never retried because the plugin wrote the UTC date), retries failed lists before lists that only have deferred rows, caps one list's aggregator lookups at 3 seconds while others are unread, and never waits for a request slot past the deadline (the run reached the host's 15 second limit and the host dropped the rows of research lists); the github-lists step line names lists still unread or failed; Part C recommends the next summer term start for an internship or co-op track and the month after graduation for new grad
- 959: `github-lists` 1.4.2 cleans company names in every table list (edge emoji and decoration stripped, names like AT&T kept; the arrow cell that means "same company as above" inherits the previous row's company even with trailing emoji) and treats `useno.app` links as aggregator links, resolved at the employer's public board or kept with the unresolved note
- 959: `github-lists` 1.4.3 keeps the list's own company cell so Pending rows are named by it, not by the job-site address (Pnc, Bocusa); the github-lists step line counts each list once, keeps running passes while deferred rows shrink, and names the lists that still have rows waiting; the first-run queue view labels list rows by their list instead of "board"

## v0.5.1 (2026-11-10)

- W-030: one-prompt setup for Codex and Claude Code (#39)

### Details

- W-030: one-prompt setup. The README carries one prompt for Codex or Claude Code that installs everything into `career-ops` in the home folder (never a synced folder), grants permission for the setup commands up front, tells the student they can say "do it for me" for any step the agent would hand back, and starts the interview in the same chat.
- W-030: new `setup.mjs` runs every step after the two clones: refuses a folder that iCloud (including Desktop and Documents), OneDrive, Dropbox or Google Drive syncs, checks out the career-ops release `compat.json` names, runs `install.mjs`, copies the Codex project config (with the Gmail write-tool block) and the Claude Code allow list into the career-ops folder when missing, installs the Playwright browser and checks the result.

## v0.5.0 (2026-11-09)

- Fix pack for career-ops 1.39.0 (response cap, Apple provider, moved boards, 1.39.0 audit) (#38)
- W-028: stop review-app test writing a stray -p file (#36)

### Details

- W-028: a review-app test's fake runner no longer writes a stray `-p` file into the working directory when a call has no `-o` flag.
- W-029: career-ops 1.39.0 support. Tests no longer pin `upstream.max`, and the canary raises `compat.json` before its test job so it tests the tree it proposes.
- W-029: a seed may carry `max_response_mb` (a number above 0, at most 100) for a board over upstream 1.39.0's 10 MB response limit, and `preset-portals.mjs` writes it to `portals.yml`; OpenAI, SpaceX, Lucid Motors, Veeva, Shield AI and Anduril carry it. `update.mjs` adds the key to a matching entry already in a student's `portals.yml` without touching anything else in the file, and the monthly audit issue counts the size error on those seeds in one line instead of listing it.
- W-029: a seed may name the new upstream `apple` provider with `apple: {location, queries, teams}`; the Apple seed in supply-chain-operations is readable instead of watch-only and no longer prints an error on every scan. Shield AI moved to Lever, Sophos to Ashby and Zillow to Workday. `docs/preset-audit.md` re-counted for every preset against 1.39.0.

## v0.4.0 (2026-11-02)

- W-028: friend install fixes, preset audit #27-#33, watch_only seeds (#35)
- W-027: ATS text-layer check, posting guard, feed health, deadline tie-break, opt-in reviewer, research cache (#34)

### Details

- W-027: `check-resume.mjs` reads the resume PDF's text layer (new dependency `unpdf` 1.9.1, pure JS on macOS and Windows) and fails an image-only PDF, an email or phone from the source that is not text in the PDF, en or em dashes in date ranges, and words run together with no spaces (a text layer that reads "SoftwareEngineeringIntern"), with a hint to re-render with real spaces
- W-027: the daily triage cleans each fetched posting before the model reads it: hidden HTML, zero-width, bidi, Unicode tag and other invisible characters are removed and Cyrillic or Greek look-alikes inside Latin words are folded; a posting with a line that reads as an instruction to an AI is held as `ANOMALY:` with that line quoted, MARGINAL at most whatever the model says, and the triage digest gives the counts. New `scripts/posting-guard.mjs` does the same for a posting in a session (exit 1 when it flags a line). The triage prompt is unchanged, so the measured cost stands
- W-027: the daily digest has a Feed health section that flags a feed with no new rows after recent runs that had some, new rows with an empty or null company, and titles with raw HTML entities or tags; it uses no tokens and no network, keeps `data/feed-health.tsv`, and never fails the run
- W-027: `rank-queue.mjs` reads a `closes=YYYY-MM-DD` deadline: a row closing within 7 days wins ties on score and shows "closes in N days", and a row past its date is skipped and counted as closed. The usajobs and nyc-jobs feeds (both 1.1.0) record the close date from `ApplicationCloseDate` and `post_until`; re-pin them with `node plugins.mjs trust` after the update
- W-027: new opt-in `reviewer` key (default off) and `modes/review.md`: for 4.0+ applications a fresh-context reviewer with no tools checks the drafts against `cv.md`, the posting and the student's chat answers and returns exact edits plus a grounding audit; `scripts/review-app.mjs` builds the prompt and runs the call, and the fact gate still rules. `docs/usage-cost.md` prices one review at about $0.02 on Claude (measured) and $0.03 on codex (computed)
- W-027: new `scripts/research-cache.mjs` and `research_cache_days` key (default 30) keep company research notes in `data/research/` with their fetched date and refuse a stale one; the apply loop checks the cache first and re-verifies any claim it reuses
- W-028: a preset seed may carry `watch_only: true` (never beside a provider) for an employer with no readable board or one the robots and crawl-delay rules keep the pack off; the monthly audit issue counts those seeds in one line instead of listing them, still lists any that error or come back empty, and `watch_only` is never written to `portals.yml`.
- W-028: audit issues #27-#33 resolved: of 109 flagged employers across seven presets, 24 got a readable board (21 new board URLs, 3 Phenom providers), 83 are marked watch-only, 1 shut-down agency was removed and 1 intermittent board was kept; `docs/preset-audit.md` re-counted for those seven presets.
- W-028: fresh-clone install test: both README install blocks now check out the upstream release the pack was tested with (`git checkout -B main career-ops-v<max>`), and `bump-compat.mjs` moves that tag when the canary raises `upstream.max`; `update.mjs --dry-run` says "would copy" and "would trust again" for plugins; a stray empty file at the repo root was removed.

## v0.3.0 (2026-10-30)

- W-026: release moves the Unreleased lines into the new CHANGELOG section (#26)

### Details

- W-026: the release workflow moves the lines under `## Unreleased` into the new release section as `### Details` and leaves an empty `## Unreleased` on top; an empty or missing block adds no Details, and a rerun for a tag already in the file changes nothing. The W-025 lines now sit under v0.2.2, and the v0.2.1 and v0.2.0 detail headings read `### Details`

## v0.2.2 (2026-10-30)

- W-025: re-measure triage token cost on the fenced prompt (#25)

### Details

- W-025: the triage cost estimate is measured again on the fenced prompt with the `ANOMALY:` rule (Claude Code 2.1.310, codex-cli 0.166). Claude is now 3,500 fixed input tokens per call, 1,726 input and 75 output per row (was 3,600, 1,548 and 104); codex is 10,100 fixed, 1,189 and 31 per row (was 11,300, 1,038 and 31). A 20-row day stays about $0.09 on Claude and $0.07 on codex; 250 rows is about $1.14 and $0.93. `docs/usage-cost.md` lists every measured run; the vendor prices were checked again and have not changed

## v0.2.1 (2026-10-30)

- W-024: fix the W-023 review leftovers (#24)

### Details

- W-024: the W-023 review leftovers. Uninstall on Windows removes the daily task only when it runs this career-ops folder and says when none was registered (`schedule.mjs remove` exits 1 on a real Unregister failure), install and uninstall find `.git/info/exclude` through git so a worktree or `.git` file no longer crashes them (and skip the step when the folder is not the top of its own repository), and uninstall clears an upstream dismiss marker for a release outside the pack's range; the safety-tag gate refuses a `budget.mjs` change outside `CEILINGS`, a `CEILINGS` line that is not a plain entry and a `budgetSha256` that does not match, and never runs the tag's `budget.mjs` before those checks pass (`docs/maintenance.md`); the nursing preset drops pharmacy, physician, social work and staff program titles and narrows `clinical` to `clinical nurse`; the prefilter marks titles that start with vice president, VP, chief, professor or general counsel (after an optional Associate, Assistant, Deputy or Executive) as `senior title`, which parity explains; `sources_chosen: []` now keeps no GitHub lists (an absent field still keeps all, and apply-answers says so); `first-run.mjs --list-only` lists the rows for one more batch without rerunning the ingest; the codex triage comment and `docs/codex-spike.md` record a second live tool listing; tests cover the triage budget's effect on the scheduled timeout, the weekly calibration line, the price table and the legacy `--claude` plist

## v0.2.0 (2026-10-30)

- W-022: live Codex/Claude triage checks, USAJOBS feed, old-schedule notice (#23)
- W-023: review fixes for W-012 to W-021 (#22)
- W-021: NYC Jobs feed for policy-government (NYC Open Data, keyless) (#20)
- W-016: student-owned triage budget with estimated usage cost (#21)
- W-020: nursing preset (76 readable hospital boards) (#19)
- W-019: seeds can name an upstream provider (Phenom, Radancy, Jibe, IBM) (#18)
- W-018: drop low-yield jobright lists (#17)
- W-017: job sources per major (lists, seeds, policy robots cleanup) (#16)
- W-015: student-eye walkthrough fixes (uninstall, schedule time zone, presets, interview, e2e tier) (#15)
- W-014: refactor top-10 (timezone today, shared entry guard, lib seams) (#14)
- W-013: Codex support (AGENTS.override.md, agent choice, Codex triage, docs) (#13)
- W-012: student pack gap fixes, first run to a real top 10 (#12)
- W-011: audit issue reuse, single BYO coverage line, semver-only pickBase, parity node_modules link (#11)

### Details

- W-022: new `usajobs` plugin 1.0.0, off by default, reads federal student and recent-graduate postings from the USAJOBS search API with the student's own free key and email from `.env` (`USAJOBS_API_KEY`, `USAJOBS_EMAIL`); presets gain `sources.usajobs`, policy-government turns it on, the daily and first runs add a `usajobs` step when the student enabled it, and the interview offers it after NYC Jobs and never requests a key for the student
- W-022: `update.mjs` reads the installed macOS LaunchAgent or Windows scheduled task and says to run `node student/scripts/schedule.mjs install` again when a schedule from an older pack skips triage; `daily.mjs` run directly now always warns plus-triage students that triage needs `scheduled.mjs`, not only when it writes a log file
- W-022: the claude triage call also passes `--settings student/templates/triage-claude-settings.json`, which excludes CLAUDE.md, so career-ops' 88 KB AGENTS.md no longer adds about 33,000 input tokens to every call; a live 45-row run came within 7% of the estimate on input
- W-022: the codex triage call also disables image generation, goals and the image viewer, which a live tool listing still showed; an "Unknown feature flag" exit now says to update codex or the pack instead of to sign in
- W-022: `templates/codex-config.suggested.toml` keys the Gmail tools by the connector id and turns off all 11 that change mail; a live run showed only the 10 read tools; `docs/codex.md` describes the trust step as checked live, and the Codex triage is no longer a preview on macOS (Windows and the browser stay a preview)
- W-023: review fixes for W-012 to W-021. `github-lists` 1.3.1 stops retrying a 4xx list (except 429), sends a failed list to the back of the next run and passes the time left as `timeoutMs`; `nyc-jobs` 1.0.1 bounds the request and the body read by the host budget; the interview writes each seed's provider config to portals.yml, defaults `submission` to `user`, refuses a PDF or Word `cv_path`, runs field detection on the resume text and keeps student-owned config keys on a rerun; daily triage takes a lock, stops before the scheduled deadline, gives the agent a PATH that finds node, fences each posting and asks for `ANOMALY:` on text that addresses the model, runs claude in an empty folder and counts a prose answer as a failed chunk; the ledger and digest say rows sent; `triage-budget.mjs cost` takes `--spend-tier`; `schedule.mjs remove` works with a broken config and a real install refuses a foreign `--root`; uninstall keeps the ignore lines for files it keeps; session start names update failures that are not offline; apply-loop leaves sign-ins to the student; the nursing preset keeps Senior Nursing Student postings and presets reject unknown keys
- W-021: new `nyc-jobs` plugin 1.0.0 reads student and entry-level City of New York postings from the keyless NYC Open Data Jobs NYC Postings dataset; presets gain `sources.nyc_jobs`, policy-government turns it on, and the daily and first runs add a `nyc-jobs` step after `github-lists` when the student has enabled the plugin; the interview offers it to policy-government students behind its capability card and enables it only after a yes
- W-016: the triage budget moves from the `budget.mjs` ceiling to `triage_budget` in config/student.yml (default 20 rows a day and 60 on the first run, a whole number or "all") and a new `plan` key; `scripts/triage-budget.mjs` shows, prices, sets (only with `--confirm`) and logs it
- W-016: the daily triage sends rows in calls of 20, stops at the first failed call, counts every row sent in `data/triage-usage.tsv` and adds a cost line to the digest; the scheduled child timeout scales with the chunks; the claude call ignores user settings and MCP servers (`--setting-sources project --strict-mcp-config`)
- W-016: `docs/usage-cost.md` explains the estimates with measured tokens and dated first-party sources. This is a normal release (a loosening of `budget.mjs`), never a safety tag.
- W-020: new `nursing` preset for new-grad RN residencies and nursing externships, with 76 hospital and health-system boards upstream reads (76 ok in the 2026-10-30 audit); field detection proposes it for a nursing resume instead of `byo-employer-list`, and the nursing interview and goal-check fixtures use it
- W-019: a preset seed may carry an upstream `provider` (phenom, radancy, jibeapply or ibm) and only the config that provider reads, which `preset-portals.mjs` passes to `portals.yml`; Crowe, IBM and Trane Technologies are now readable in accounting, mis-business-analytics and engineering-mech-elec; EY and L3Harris stay watch-only because their robots.txt disallows search-jobs, and Eide Bailly because its crawl delay is not honored; `docs/preset-audit.md` ok and no-provider counts updated for those four presets
- W-018: jobright lists that matched fewer than 5 rows to employer boards are dropped (accounting intern, both finance account lists, all four MIS lists); the accounting new-grad list stays; the finance coverage note names its lists
- W-017: `github-lists` 1.3.0 reads markdown tables whose link sits in the title cell, which revives the jobright lists; new lists that match 5 or more rows to employer boards go into software-cs, finance-economics, engineering-mech-elec, mis-business-analytics, consulting, policy-government and marketing-business; seeds move to boards upstream reads, the 12 governmentjobs.com policy seeds are removed (its robots.txt disallows bots) and 15 policy boards are added; `docs/preset-audit.md` and `docs/goal-check.md` carry the 2026-10-30 counts
- W-013: Codex support: `AGENTS.override.md` is generated with the pack block first, config/student.yml gains an `agent` key, the daily triage can run as one read-only `codex exec` call, and `schedule.mjs install` passes `--agent` and `--agent-path` to `scheduled.mjs`, which still honours the older `--claude`
- W-013: session start tolerates an offline sandbox; interview fixtures carry the Phase 3 application profile
- W-013: `docs/codex.md`, `docs/codex-spike.md` and `templates/codex-config.suggested.toml` describe the Codex path, a preview until the live checks listed there are done
- W-011: audit issue reuse, single BYO coverage line, semver-only pickBase, parity node_modules link
- W-012: the interview takes over the template title and location filters, collects an application profile, reads Word resumes and proposes the field from the resume
- W-012: `first-run.mjs` brings in the first postings and lists rows to triage; `daily.mjs --dry-run` writes nothing
- W-012: `daily-triage.mjs` and `scheduled.mjs` give scheduled discovery plus triage an unattended path, capped by a `triage_daily` ceiling that W-016 replaced with the student's own `triage_budget`. A schedule installed earlier still starts `daily.mjs`: run `node student/scripts/schedule.mjs install` again to get daily triage.
- W-012: a scan that exits non-zero is run once more; `github-lists` 1.2.1 reads `ctx.dataRoot`, stops at 11 s, reads the least recently read sources first and logs deferred rows; priority companies stay out of `blacklist.md`; a "City, ST" answer also allows the bare city; a bad `portals.yml` is an `AnswersError`; `lib/text.mjs` holds the shared `oneLine`; goal-check yields to the event loop so SIGINT cleans up
- W-012: `install.mjs` installs the pack's packages and js-yaml is now a dependency; clearance and citizenship titles stay for US citizens; the inbox keeps interview mail that follows a receipt; the README covers setup from zero for macOS and Windows

## v0.1.0 (2026-10-29)

- Merge W-010: release workflow, safety-tag baseline fallback, unmaintained marker, upstream drafts
- W-008: parsing knobs and parity carry-over (#8)
- Merge W-009: five new presets, readable seed boards, preset audit, interview disclaimer
- Merge W-007: config knobs for fail-audit and rank-queue
- W-006: truthful parity harness verdicts, runnable fixture config (#6)
- W-005: CI on macOS and Windows, canary, preset audit, safety-tag (M-009) (#5)
- Merge W-004: interview, presets, parity harness, daily run and inbox (M-006, M-007, M-008)
- Merge W-003: pipeline scripts, installer and updater (M-004, M-005)
- Merge W-002: budget ceilings and GitHub-list feeds (M-002, M-003)
- Merge W-001: pack foundation (M-001)
- Bootstrap: license, README with pilot disclaimer, PII lint
