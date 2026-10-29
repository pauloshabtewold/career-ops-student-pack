# Changelog

One section per pack release, newest first. The release workflow writes each section from the first-parent commit subjects since the previous release.

## Unreleased

- W-011: audit issue reuse, single BYO coverage line, semver-only pickBase, parity node_modules link
- W-012: the interview takes over the template title and location filters, collects an application profile, reads Word resumes and proposes the field from the resume
- W-012: `first-run.mjs` brings in the first postings and lists rows to triage; `daily.mjs --dry-run` writes nothing
- W-012: `daily-triage.mjs` and `scheduled.mjs` give scheduled discovery plus triage an unattended path, capped by the new `triage_daily` ceiling. A schedule installed earlier still starts `daily.mjs`: run `node student/scripts/schedule.mjs install` again to get daily triage.
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
