# Changelog

One section per pack release, newest first. The release workflow writes each section from the first-parent commit subjects since the previous release.

## v0.2.2 (2026-10-30)

- W-025: re-measure triage token cost on the fenced prompt (#25)

## Unreleased

- W-025: the triage cost estimate is measured again on the fenced prompt with the `ANOMALY:` rule (Claude Code 2.1.310, codex-cli 0.166). Claude is now 3,500 fixed input tokens per call, 1,726 input and 75 output per row (was 3,600, 1,548 and 104); codex is 10,100 fixed, 1,189 and 31 per row (was 11,300, 1,038 and 31). A 20-row day stays about $0.09 on Claude and $0.07 on codex; 250 rows is about $1.14 and $0.93. `docs/usage-cost.md` lists every measured run; the vendor prices were checked again and have not changed

## v0.2.1 (2026-10-30)

- W-024: fix the W-023 review leftovers (#24)

### v0.2.1 details

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

### v0.2.0 details

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
