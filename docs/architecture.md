# Architecture

Why the pack is built the way it is. Usage is in [usage.md](usage.md); release and CI duties are in [maintenance.md](maintenance.md).

## Two checkouts, no shared files

The pack (cloned into a folder named student inside career-ops) and career-ops are independent git checkouts. career-ops updates through its own `update-system.mjs`; the pack updates through its own update script. Neither writes a file the other owns. Anything in the pack that writes into career-ops' system layer is a bug.

The pack attaches through four places only:

| Hook | Effect |
| --- | --- |
| `CLAUDE.local.md` | imports the pack rules file, `AGENTS.student.md` |
| upstream's local-paths list in its config folder | names the pack folder and `CLAUDE.local.md` so career-ops updates leave them alone |
| upstream's local plugins folder | holds full copies of the pack plugins |
| `.git/info/exclude` | hides pack entries from career-ops' git status |

Student data lives in career-ops' user layer plus a student settings file in the config folder and the pack's own data files.

## Why not a fork

`update-system.mjs` pulls only from the canonical repo, and updates erase hooks added to `AGENTS.md` or `CLAUDE.md`. A fork would conflict weekly in ways students cannot resolve.

## CLI-only boundary

Pack code calls career-ops scripts as child processes and never imports its modules. `scripts/lint-imports.mjs` enforces this; `js-yaml` is the only bare import allowed. The cost is duplicated logic: `lib/dir-lock.mjs` reimplements the upstream pipeline lock (a `<pipeline>.lock` directory holding `owner.json`) so pack writes and upstream writes exclude each other. The weekly canary and the pins in `compat.json` catch drift.

## Ingest sidecar

Upstream's ingest keeps only title, URL, company, location and salary. Note tokens that the pack relies on are dropped, so the pack keeps a URL-keyed sidecar (a TSV file in the data folder) and joins it to pipeline rows.

## Plugin trust

`plugins.lock` pins plugin file hashes. A feed change without a manifest version bump is skipped silently with exit 0 until `node plugins.mjs trust <id>` runs. Every file change in a plugin directory therefore bumps the manifest version, and `scripts/check-plugin-versions.mjs` checks it. Plugin directories are self-contained copies, which costs a trust re-pin per update but keeps upstream's consent model intact.

## Version range

`compat.json` sets the supported career-ops range, with a minimum of 1.38.0, the first release whose ingest path accepts `jobPostings: true`. `update-system.mjs` ignores a dismissal when `apply --confirm` runs and `check --force` bypasses it, so the update script enforces the range itself and never applies a release outside it.

## Budget ceilings

`scripts/budget.mjs` is security-critical. Its constants are the limits on LinkedIn messages, applications and page loads. Settings can only tighten a limit. A maximum (daily caps, rolling caps, ceilings) can be set lower; a minimum (score floor, minimum gap between actions, nudge wait days) can be set higher. Values that would loosen a limit are clamped and logged to the action log in the data folder, and no flag, environment variable or argument loosens one. A refusal ends that action type for the period.

`compat.json` holds the SHA-256 of `budget.mjs`. The update script and `scripts/session-start.mjs` compare it and restore an edited file with a git checkout of `scripts/budget.mjs` inside the pack. A ceiling change needs the hash bump in the same commit.

Pacing answers with a wait, not a refusal. The agent cannot see the random gap, so it checks more often; that cost is accepted.

A `safety-*` release may only tighten values (lower a maximum, raise a minimum) or switch defaults off, and may touch only `budget.mjs`, `compat.json`, the defaults file and the pack rules. `scripts/check-safety-tag.mjs` fails a tag that breaks this.

LinkedIn sending and the Handshake pass are on by default. A student turns them off with "stop outreach" or "stop handshake".

## Inbox

Mail is untrusted input, so the inbox step changes the tracker for two outcomes only. A message from an assessment domain runs `set-status` to Assessment; a plain reply from a tracked company sets Responded. Rejection, interview and scheduling mail is always a proposal that the student decides. Two messages from one company on the same day conflict only when one is an Assessment and the other a Responded; the step then proposes a manual check. `--propose-only` changes no tracker row and marks no message as seen, so the same mail is read again on the next run.

## Feeds

GitHub job lists are churny bot repos. Discovery admits a list only with a push in the last 14 days, retires it after 30 days without a push or without unique rows, or after 3 failed parses, and polls daily when a list's posting window is 7 days. Each registry entry carries `last_push`, `last_unique` and `failed_parses`. A list with no recorded `last_push` or `last_unique` is not retired for staleness, so a fresh list survives until its first ingest sets them. The `github-lists` plugin is at version 1.0.1. Feeds keep company, title, location, date and employer URL. Vendor apply links resolve to the employer through the aggregator resolver, and `linkedin.com` is never fetched.

## Coverage outside tech

Coverage equals the quality of the preset's seed employer list. Interview phase 3 states the coverage line per field and never implies automation for a discovery-only preset. Six presets ship; other fields use the bring-your-own-list preset. A monthly job audits the seed lists with upstream `audit-portals.mjs`.

## Parity and CI

`tools/parity.mjs` runs the baseline stage scripts and the pack stage scripts on copies of a frozen data set kept outside the repo. Baseline stage scripts resolve from the clone's local/ directory first, then the checkout root, then `scripts/`. A missing script, a nonzero exit or malformed output is a stage error: it fails the run, and the report names the stage with a fixed note, never the cause text. The pack cycle output is written to the install's data/student-cycle.json before prefilter runs, while the baseline prefilter computes its own cycle for the same date. Cycle compares a normalized subset of both schemas, rank-queue and fail-audit run at a limit no real queue reaches so the compare measures which URLs are picked (the URL set), not their order (score formulas differ by design), and other stages compare section-keyed rows. Differences that follow from by-design behavior listed in docs/maintenance.md (Parity run) are explained, the allowance is derived from the run's own outputs, and any residual fails. Skipped and zero-input stages are listed under Warnings and do not change the verdict. Feeds are compared statistically because live lists change. Stages run asynchronously so signals are handled: SIGINT exits 130 and SIGTERM exits 143, running children are killed before the copy is removed, and the copy is removed on success, on stage failure, on either signal and on an uncaught exception; there is no keep flag. The report holds counts and a verdict, never rows. The fail-audit explanation applies the same reason predicate as the pick (keywords, match mode and exclusion patterns), built from the run's student config.

`scripts/ci/upstream-setup.mjs` builds the throwaway career-ops checkout for CI; `--resume <file>` names the synthetic resume copied to `cv.md` before doctor runs.

CI runs `windows-latest` as the stand-in for a Windows 11 machine: it clones career-ops at the compat pin, installs the pack and runs `doctor.mjs --json`.
