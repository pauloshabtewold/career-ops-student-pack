# M0 spike results

Facts recorded on 2026-10-27 against a scratch clone of upstream career-ops (1.37.0 updated to 1.38.0). No personal data was used.

| # | Question | Result |
|---|---|---|
| 1 | Does `update-system.mjs apply --confirm` (1.37.0 to 1.38.0) leave `student/`, `CLAUDE.local.md` and `plugins.local/` alone? | PASS: all three byte-identical after the update |
| 2 | Does `dismiss --version X` block an update? | NO. It writes `.update-dismissed` and `check` then reports `dismissed`, but `apply --confirm` ignores the file and `check --force` bypasses it. The pack enforces its own version range in `update.mjs`. |
| 3 | Does Claude Code load `CLAUDE.local.md` and follow its import of `student/AGENTS.student.md`? | PASS: a headless run echoed the marker line from the imported file |
| 4 | Does ingest through upstream's writer work? | YES from upstream 1.38.0 with `jobPostings: true` in the plugin manifest. Blacklist, title filter, scan-history and dedup apply. The compat minimum is therefore 1.38.0. |
| 5 | What does `plugins.lock` pin? | The plugin file hashes. A changed plugin without a manifest version bump is skipped with exit 0 until `node plugins.mjs trust <id>` runs. |
| 6 | Does upstream ship a lockfile? | No. CI uses `npm install` with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`. |
| 7 | Does upstream's `.gitignore` cover pack files? | No. `CLAUDE.local.md`, `student/` and `config/student.yml` are added to `.git/info/exclude` by `install.mjs`. |
| 8 | Windows 11 doctor check | Carried by the windows-latest upstream-install CI job (clone at the compat pin, `npm install`, install the pack, `node doctor.mjs --json`). |
| 9 | Codex checks | Skipped: Codex support is deferred. |

## Handshake terms

The student terms (last updated 2025-07-22) ban third-party bulk collection by automated scripts and profile crawling or scraping. Nothing in them targets a student's own read-only, user-watched, four-page pass. Rating: AMBIGUOUS.

The M0 read recommended shipping the Handshake pass off. The maintainer's binding decision keys default-off only on terms that BAR the pass, so the pass ships on by default with the switch `stop handshake`, read-only, interactive sessions only, and a hard cap of 4 result pages per search per session enforced by `scripts/budget.mjs`.
