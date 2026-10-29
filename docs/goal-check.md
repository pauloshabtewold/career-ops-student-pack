# Goal check

Date: 2026-10-29
Upstream version: 1.38.0
Pack commit: 350b504
Feeds: live
Triage: stand-in scorer (PASS 4.2 or FAIL 1.0); rows 7 and 10 are proxies.

| Row | Deciding check | Verdict | Counts |
|---|---|---|---|
| Interview writes config, profile, portals and modes | files written and parse after apply-answers | met | 5/5 fixtures |
| Preset choice and honest coverage line | detect-field pick equals expected preset; coverage line printed | met | 5/5 fixtures |
| Correct cycle years | student-cycle.json equals expected years | met | 5/5 fixtures |
| Daily zero-token digest never fails | daily.mjs with a failing step exits 0, writes the digest, starts no claude | met | 5/5 fixtures |
| Prefilter, triage and rank | no senior, out-of-cycle or internship-only new-grad row in the ranked list | met | 5/5 fixtures |
| First run shows top-10 | first-run exits 0 and rank-queue --n 10 lists at least 1 row | not met | 4/5 fixtures; failed fixtures: nursing; failed check: top list empty |
| Tailored materials and resume guard (PROXY) | check-resume passes one page, fails two; apply-loop names its flags | met | 5/5 fixtures |
| Inbox | interview after a receipt is interview; a conditional receipt is ignored | met | 5/5 fixtures |
| Outreach and apply gates | log apply.policy exits 0; a below-floor submit check is refused | met | 5/5 fixtures |
| Daily schedule installed (PROXY) | schedule install --dry-run starts scheduled.mjs; interview runs it after rank-queue | met | 5/5 fixtures |

- cs: top-list 7, new-grad rows 0, staged 0, pending 12, untriaged 12, passed 7, tagged rows in ranking 0
- finance: top-list 10, new-grad rows 0, staged 0, pending 109, untriaged 109, passed 64, tagged rows in ranking 0
- mechanical: top-list 6, new-grad rows 0, staged 0, pending 11, untriaged 11, passed 11, tagged rows in ranking 0
- mis: top-list 3, new-grad rows 1, staged 0, pending 4, untriaged 4, passed 3, tagged rows in ranking 0
- nursing: top-list 0, new-grad rows 0, staged 0, pending 0, untriaged 0, passed 0, tagged rows in ranking 0

Overall: not met

Notes: the run is the maintainer live run against an upstream 1.38.0 checkout with the real GitHub-list feed and scan, over the five synthetic fixtures. Triage used the stand-in scorer. Rows 7 and 10 are proxies: tailoring is upstream and in-session, and no real scheduler registration is made. The First run shows top-10 row is not met because the nursing fixture (employer-list preset, no include terms) received 0 Pending rows from the live feeds that day; this is feed variance, not a pack code failure, and it is recorded as printed.
