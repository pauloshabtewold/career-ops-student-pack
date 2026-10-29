# Parity report

Date: 2026-10-29
Upstream version: 1.38.0
Pack commit: 350b504
Prefilter input rows: 200

| Stage | Baseline | Pack | Added | Missing | Explained | Verdict |
|---|---|---|---|---|---|---|
| cycle | 8 | 8 | 0 | 0 | 0 | pass |
| prefilter | 1 | 40 | 40 | 1 | 0 | fail |
| apply-triage | 3405 | 3405 | 0 | 0 | 0 | pass |
| merge-staging | 3405 | 3393 | 30 | 42 | 72 | explained |
| rank-queue | 562 | 565 | 22 | 19 | 37 | fail |
| fail-audit | 1246 | 744 | 27 | 529 | 529 | fail |
| handshake-import | - | - | - | - | - | skipped |
| feed | 0 | 0 | 0 | 0 | 0 | pass |

Warnings:
- handshake-import: no TSV input
- feed: no input rows on either side

Overall: fail
