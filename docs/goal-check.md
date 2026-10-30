# Goal check

Date: 2026-10-29
Upstream version: 1.38.0
Pack commit: b535e93
Feeds: live
Triage: stand-in scorer (PASS 4.2 or FAIL 1.0); rows 7 and 10 are proxies.

| Row | Deciding check | Verdict | Counts |
|---|---|---|---|
| Interview writes config, profile, portals and modes | files written and parse after apply-answers | met | 5/5 fixtures |
| Preset choice and honest coverage line | detect-field pick equals expected preset; coverage line printed | met | 5/5 fixtures |
| Correct cycle years | student-cycle.json equals expected years | met | 5/5 fixtures |
| Daily zero-token digest never fails | daily.mjs with a failing step exits 0, writes the digest, starts no claude | met | 5/5 fixtures |
| Prefilter, triage and rank | no senior, out-of-cycle or internship-only new-grad row in the ranked list | met | 5/5 fixtures |
| First run shows top-10 | first-run exits 0 and rank-queue --n 10 lists 10 rows | met | 5/5 fixtures |
| Tailored materials and resume guard (PROXY) | check-resume passes one page, fails two; apply-loop names its flags | met | 5/5 fixtures |
| Inbox | interview after a receipt is interview; a conditional receipt is ignored | met | 5/5 fixtures |
| Outreach and apply gates | log apply.policy exits 0; a below-floor submit check is refused | met | 5/5 fixtures |
| Daily schedule installed (PROXY) | schedule install --dry-run starts scheduled.mjs; interview runs it after rank-queue | met | 5/5 fixtures |

- cs: top-list 10, new-grad rows 0, staged 0, pending 234, untriaged 234, passed 225, tagged rows in ranking 0
- finance: top-list 10, new-grad rows 0, staged 0, pending 247, untriaged 247, passed 150, tagged rows in ranking 0
- mechanical: top-list 10, new-grad rows 0, staged 0, pending 62, untriaged 62, passed 61, tagged rows in ranking 0
- mis: top-list 10, new-grad rows 1, staged 0, pending 63, untriaged 63, passed 24, tagged rows in ranking 0
- nursing: top-list 10, new-grad rows 0, staged 0, pending 143, untriaged 143, passed 113, tagged rows in ranking 0

Overall: met

Notes: the run is the maintainer live run against an upstream 1.38.0 checkout with the real GitHub-list feed and scan, over the five synthetic fixtures in one run. Triage used the stand-in scorer. Rows 7 and 10 are proxies: tailoring is upstream and in-session, and no real scheduler registration is made.

Causes found and fixed in pack code: the github-lists plugin read its registry from the career-ops root and not from its data folder, so the feed returned no rows; the upstream host drops an ingest hook after 15 seconds and keeps nothing, so the plugin now stops requesting at 11 seconds; priority companies were written into the do-not-apply list that upstream's scan skips; a city answer such as "Boston, MA" did not match boards that write "Boston-MA"; and a scan that exits non-zero because one board fetch ended mid-run ("terminated", seen in 3 of 3 standalone scans, 1 or 2 boards each) is now run a second time. The one run where the nursing fixture fell to a top list of 2 lost its Workday boards to such failures; a standalone rerun of that fixture gave the full list.

The nursing fixture lists 11 public hospital and clinic boards. Without the clinic's rows its first run held 10 ranked rows over 6 employers, at 2 rows per company a day.
