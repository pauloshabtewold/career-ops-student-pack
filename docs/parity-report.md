# Parity report

Date: 2026-10-29
Upstream version: 1.38.0
Pack commit: 3605bce
Prefilter input rows: 200

| Stage | Baseline | Pack | Added | Missing | Explained | Verdict |
|---|---|---|---|---|---|---|
| cycle | 8 | 8 | 0 | 0 | 0 | pass |
| prefilter | 1 | 40 | 40 | 1 | 41 | explained |
| apply-triage | 3405 | 3405 | 0 | 0 | 0 | pass |
| merge-staging | 3405 | 3393 | 30 | 42 | 72 | explained |
| rank-queue | 562 | 560 | 16 | 18 | 34 | explained |
| fail-audit | 1246 | 1246 | 0 | 0 | 0 | pass |
| handshake-import | - | - | - | - | - | skipped |
| feed | 0 | 0 | 0 | 0 | 0 | pass |

Warnings:
- handshake-import: no TSV input
- feed: no input rows on either side

Overall: explained
