# Preset audit

Counts only. No company rows, no URLs. The counts come from a manual authoritative audit run of upstream `audit-portals` against each preset's seed list (procedure in `docs/maintenance.md`). The monthly workflow opens issues and does not edit this file.

Audit date: 2026-10-29
Upstream version: 1.38.0

| Preset | Seeds | ok | small | empty | error | no-provider | removed |
|---|---|---|---|---|---|---|---|
| software-cs | 101 | 100 | 1 | 0 | 0 | 0 | 22 |
| mis-business-analytics | 72 | 56 | 0 | 0 | 0 | 16 | 15 |
| finance-economics | 74 | 64 | 2 | 0 | 0 | 8 | 45 |
| accounting | 99 | 78 | 0 | 0 | 0 | 21 | 18 |
| engineering-mech-elec | 96 | 74 | 1 | 0 | 0 | 21 | 10 |
| policy-government | 95 | 36 | 6 | 0 | 0 | 53 | 8 |
| supply-chain-operations | 74 | 62 | 1 | 0 | 0 | 11 | 0 |
| statistics-math-actuarial | 96 | 96 | 0 | 0 | 0 | 0 | 0 |
| marketing-business | 82 | 76 | 6 | 0 | 0 | 0 | 0 |
| consulting | 50 | 36 | 2 | 0 | 0 | 12 | 0 |
| cybersecurity | 82 | 81 | 1 | 0 | 0 | 0 | 0 |
| byo-employer-list | 0 | - | - | - | - | - | - |

Meaning of the columns: `ok` returned postings, `small` returned very few, `empty` returned none, `error` failed to load, `no-provider` has a careers page upstream cannot read, `removed` was dropped from the preset during this audit because no readable board exists. Seeds with no provider are kept as manual-watch entries.
