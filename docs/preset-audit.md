# Preset audit

Counts only. No company rows, no URLs. The counts come from a manual authoritative audit run of upstream `audit-portals` against each preset's seed list (procedure in `docs/maintenance.md`). The monthly workflow opens issues and does not edit this file.

Audit date: 2026-11-02
Upstream version: 1.38.0

The software-cs, statistics-math-actuarial, marketing-business, cybersecurity and nursing rows are from the 2026-10-30 audit; those presets had no flagged boards and were not audited again.

| Preset | Seeds | ok | small | empty | error | no-provider | removed |
|---|---|---|---|---|---|---|---|
| software-cs | 101 | 100 | 1 | 0 | 0 | 0 | 0 |
| mis-business-analytics | 72 | 61 | 1 | 0 | 0 | 10 | 0 |
| finance-economics | 75 | 69 | 2 | 0 | 0 | 4 | 0 |
| accounting | 97 | 89 | 0 | 0 | 0 | 8 | 0 |
| engineering-mech-elec | 96 | 83 | 1 | 0 | 0 | 12 | 0 |
| policy-government | 97 | 37 | 17 | 0 | 0 | 43 | 1 |
| supply-chain-operations | 74 | 65 | 3 | 0 | 0 | 6 | 0 |
| statistics-math-actuarial | 96 | 96 | 0 | 0 | 0 | 0 | 0 |
| marketing-business | 82 | 76 | 6 | 0 | 0 | 0 | 0 |
| consulting | 50 | 39 | 2 | 0 | 0 | 9 | 0 |
| cybersecurity | 82 | 81 | 1 | 0 | 0 | 0 | 0 |
| nursing | 76 | 76 | 0 | 0 | 0 | 0 | 0 |
| byo-employer-list | 0 | - | - | - | - | - | - |

Meaning of the columns: `ok` returned postings, `small` returned very few, `empty` returned none, `error` failed to load, `no-provider` has a careers page upstream cannot read, `removed` was dropped from the preset during this audit because no readable board exists. Seeds with no provider are kept as manual-watch entries and carry `watch_only: true`; in every re-audited preset the no-provider count equals its watch-only count. Four boards that timed out in the 2026-10-30 batch run were audited again on their own and are counted as `ok`; one policy-government board that returned an intermittent 404 in the 2026-11-02 batch run returned postings on its own and is counted as `small`. The policy-government seed removed in the 2026-11-02 audit was an agency that has shut down. In the 2026-10-30 audit, 12 policy-government seeds pointed at a host whose robots.txt disallows bots and 2 accounting seeds were firms that merged into firms already listed; those were removed then.
