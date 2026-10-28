# Preset audit

Counts only. No company rows, no URLs. The audit is produced by running upstream `audit-portals` against each preset's seed list (see `docs/maintenance.md`); the monthly workflow updates this table.

Audit date: not yet run
Upstream version: not yet run

| Preset | Seeds | ok | small | empty | error | no-provider | removed |
|---|---|---|---|---|---|---|---|
| software-cs | 102 | - | - | - | - | - | - |
| mis-business-analytics | 68 | - | - | - | - | - | - |
| finance-economics | 95 | - | - | - | - | - | - |
| accounting | 76 | - | - | - | - | - | - |
| engineering-mech-elec | 80 | - | - | - | - | - | - |
| policy-government | 76 | - | - | - | - | - | - |
| byo-employer-list | 0 | - | - | - | - | - | - |

Meaning of the columns: `ok` returned postings, `small` returned very few, `empty` returned none, `error` failed to load, `no-provider` has a careers page upstream cannot read, `removed` was dropped from the preset after two failed audits.
