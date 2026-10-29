# Providers for big-tech careers sites

Status: draft, not posted

## Problem

Several large employers publish software roles on their own careers sites, and none of them runs on an applicant tracking system that upstream's scanner reads. Apple, AMD and TikTok are examples. Students targeting those employers have to watch each site by hand.

## Proposal

Add upstream providers for big-tech careers sites, one per site, each reading the public listing endpoint the site itself uses. A provider needs a stable public endpoint, a posting date, a location and a role family so the cycle filter can apply.

## Pack decision

No big-tech feed ships in the pack.

The pack has no vetted public list for big-tech roles. A survey on 2026-10-29 found no established list: only three small repositories, each under 5 stars and created this cycle, which are not named here. Big-tech roles already reach students through the six lists in the software-cs preset.

Vetting criteria for any list that is added later:

- Receives commits at least weekly through one full recruiting cycle (August to May).
- At least 100 stars.
- A format the github-lists plugin parses.
- Roles that are not already in the six software-cs lists.

Revisit when a list meets all four criteria, or when upstream merges providers; software-cs then needs no feed of its own.

## What the pack has

Nothing for this draft. The decision above is recorded so the question is not reopened without new evidence.

## Pack follow-up once merged

None. The table in [README.md](README.md) lists no pack files for this draft.
