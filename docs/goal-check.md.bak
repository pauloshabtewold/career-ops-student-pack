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

## Source counts per preset (W-017)

Date: 2026-10-30
Upstream version: 1.38.0

Counts only. Before is the pack at main a698221, after is the W-017 branch. Each column counts one early-career cycle (Summer 2027 internships and 2027 new-grad roles) under the preset title rules. List rows count only once they link to an employer board, directly or after the resolver matches the company. Unique postings join the list rows and the board postings by link.

| Preset | Seeds before | Seeds after | Readable boards before | Readable boards after | List rows matched before | List rows matched after | Unique postings before | Unique postings after |
|---|---|---|---|---|---|---|---|---|
| software-cs | 101 | 101 | 101 | 100 | 6444 | 7020 | 6537 | 6968 |
| mis-business-analytics | 72 | 72 | 56 | 59 | 1144 | 1164 | 1382 | 1399 |
| finance-economics | 74 | 75 | 66 | 68 | 0 | 1041 | 130 | 1092 |
| accounting | 99 | 97 | 78 | 86 | 0 | 19 | 2520 | 2781 |
| engineering-mech-elec | 96 | 96 | 74 | 75 | 3042 | 3689 | 3638 | 3963 |
| policy-government | 95 | 98 | 42 | 48 | 0 | 5 | 172 | 211 |
| supply-chain-operations | 74 | 74 | 63 | 65 | 5 | 5 | 305 | 303 |
| statistics-math-actuarial | 96 | 96 | 96 | 94 | 6 | 6 | 130 | 137 |
| marketing-business | 82 | 82 | 82 | 82 | 2 | 15 | 241 | 259 |
| consulting | 50 | 50 | 38 | 39 | 0 | 12 | 722 | 784 |
| cybersecurity | 82 | 82 | 82 | 81 | 169 | 169 | 192 | 186 |

Board fetches that timed out: 1 before and 5 after, counted as unreadable in that run. Board postings move day to day, so a small drop on an unchanged preset is drift, not a regression.
