# Goal check

Date: 2026-10-29
Upstream version: 1.38.0
Pack commit: 6c3ffe4
Feeds: live
Triage: stand-in scorer (PASS 4.2 or FAIL 1.0); rows 7 and 10 are proxies.

| Row | Deciding check | Verdict | Counts |
|---|---|---|---|
| Interview writes config, profile, portals and modes | files written and parse after apply-answers | met | 5/5 fixtures |
| Preset choice and honest coverage line | detect-field pick equals expected preset; coverage line printed | met | 5/5 fixtures |
| Correct cycle years | student-cycle.json equals expected years | met | 5/5 fixtures |
| Daily zero-token digest never fails | daily.mjs with a failing step exits 0, writes the digest, starts no claude | met | 5/5 fixtures |
| Prefilter, triage and rank | no senior, out-of-cycle or internship-only new-grad row in the ranked list | met | 5/5 fixtures |
| First run shows top-10 | first-run exits 0 and rank-queue --n 10 lists 10 rows | not met | 4/5 fixtures; failed fixtures: nursing; failed check: top list under 10 |
| Tailored materials and resume guard (PROXY) | check-resume passes one page, fails two; apply-loop names its flags | met | 5/5 fixtures |
| Inbox | interview after a receipt is interview; a conditional receipt is ignored | met | 5/5 fixtures |
| Outreach and apply gates | log apply.policy exits 0; a below-floor submit check is refused | met | 5/5 fixtures |
| Daily schedule installed (PROXY) | schedule install --dry-run starts scheduled.mjs; interview runs it after rank-queue | met | 5/5 fixtures |

- cs: top-list 10, new-grad rows 0, staged 0, pending 244, untriaged 244, passed 235, tagged rows in ranking 0
- finance: top-list 10, new-grad rows 0, staged 0, pending 247, untriaged 247, passed 150, tagged rows in ranking 0
- mechanical: top-list 10, new-grad rows 0, staged 0, pending 52, untriaged 52, passed 51, tagged rows in ranking 0
- mis: top-list 10, new-grad rows 2, staged 0, pending 66, untriaged 66, passed 26, tagged rows in ranking 0
- nursing: top-list 2, new-grad rows 0, staged 0, pending 32, untriaged 32, passed 32, tagged rows in ranking 0

Overall: not met

Notes: the run is the maintainer live run against an upstream 1.38.0 checkout with the real GitHub-list feed and scan, over the five synthetic fixtures. Triage used the stand-in scorer. Rows 7 and 10 are proxies: tailoring is upstream and in-session, and no real scheduler registration is made.

Causes found in the earlier live run, all fixed in pack code: the github-lists plugin read its registry from the career-ops root instead of its data folder, so the feed returned no rows; the upstream host drops an ingest hook after 15 seconds and keeps nothing, so the plugin now stops requesting at 11 seconds; priority companies were written into the do-not-apply list that upstream's scan skips; and a city answer such as "Boston, MA" did not match boards that write "Boston-MA".

The First run shows top-10 row is not met for the nursing fixture (employer-list preset). Its ten public employer boards held 32 rows that the filters keep in this run (65 in a separate run of that fixture alone, where the top list reached 7 over four employers). The pack lists at most 2 rows per company a day and new-grad nurse postings sit at a few hospitals, so this field does not reach 10 live rows today; the first run now says so plainly. The count is recorded as printed.
