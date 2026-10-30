# Preset audit

Counts only. No company rows, no URLs. The counts come from a manual authoritative audit run of upstream `audit-portals` against each preset's seed list (procedure in `docs/maintenance.md`). The monthly workflow opens issues and does not edit this file.

Audit date: 2026-10-30
Upstream version: 1.38.0

| Preset | Seeds | ok | small | empty | error | no-provider | removed |
|---|---|---|---|---|---|---|---|
| software-cs | 101 | 100 | 1 | 0 | 0 | 0 | 0 |
| mis-business-analytics | 72 | 58 | 1 | 0 | 0 | 13 | 0 |
| finance-economics | 75 | 67 | 2 | 0 | 0 | 6 | 0 |
| accounting | 97 | 86 | 0 | 0 | 0 | 11 | 2 |
| engineering-mech-elec | 96 | 74 | 1 | 0 | 0 | 21 | 0 |
| policy-government | 98 | 33 | 14 | 0 | 0 | 51 | 12 |
| supply-chain-operations | 74 | 62 | 3 | 0 | 0 | 9 | 0 |
| statistics-math-actuarial | 96 | 96 | 0 | 0 | 0 | 0 | 0 |
| marketing-business | 82 | 76 | 6 | 0 | 0 | 0 | 0 |
| consulting | 50 | 37 | 2 | 0 | 0 | 11 | 0 |
| cybersecurity | 82 | 81 | 1 | 0 | 0 | 0 | 0 |
| nursing | 76 | 76 | 0 | 0 | 0 | 0 | 0 |
| byo-employer-list | 0 | - | - | - | - | - | - |

Meaning of the columns: `ok` returned postings, `small` returned very few, `empty` returned none, `error` failed to load, `no-provider` has a careers page upstream cannot read, `removed` was dropped from the preset during this audit because no readable board exists. Seeds with no provider are kept as manual-watch entries. Four boards that timed out in the batch run were audited again on their own and are counted as `ok`. The 12 policy-government seeds removed in this audit pointed at a host whose robots.txt disallows bots; the 2 accounting seeds were firms that merged into firms already listed.
