# Parity report

Counts and verdicts only. This file never holds a row, URL, company, title or filesystem path. The maintainer regenerates it with `node tools/parity.mjs --source <career-ops dir> --scratch <empty dir> --student-config <copied fixture yml outside the repo> --report docs/parity-report.md`, which runs on copies and deletes them when it finishes.

Date: 2026-10-29
Upstream version: 1.37.0
Pack commit: 646df47

| Stage | Baseline | Pack | Added | Missing | Explained | Verdict |
|---|---|---|---|---|---|---|
| cycle | 8 | 8 | 0 | 0 | 0 | pass |
| prefilter | 0 | 0 | 0 | 0 | 0 | pass |
| apply-triage | 3405 | 3405 | 0 | 0 | 0 | pass |
| merge-staging | 3405 | 3393 | 31 | 43 | 74 | explained |
| rank-queue | 706 | 691 | 23 | 38 | 61 | explained |
| fail-audit | 1246 | 1246 | 0 | 0 | 0 | pass |
| handshake-import | - | - | - | - | - | skipped |
| feed | - | - | - | - | - | not run |

Residual = Added + Missing - Explained. Explained counts differences that follow from by-design behavior (see docs/maintenance.md, Parity run). Overall fails on any error or any residual.

Warnings: prefilter had no input rows on either side; handshake-import had no TSV input; the feed stage was not requested.

Overall: explained
