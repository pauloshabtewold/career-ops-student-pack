# Compute the recruiting cycle from graduation dates

Status: draft, not posted

## Problem

Upstream has no notion of a graduation window. A student looking for internships or new-grad roles needs to know which internship terms and which new-grad years are in play today, and nothing in career-ops computes that. Title filters and list ingest then either show everything or rely on the student to type the right years by hand.

## Proposal

Add a small cycle computation:

- Input: the student's graduation dates and a recruiting calendar for their field (term names and start months).
- Output: the internship terms and new-grad years in play for the run date, written to `data/student-cycle.json`.
- A validator for that file, so readers fail with a clear message on a malformed cycle.
- A marker-bounded text refresh: only the text between cycle markers in the brief, the custom mode file and `portals.yml` is rewritten, so a student's own edits elsewhere in those files are never touched.
- A simulation switch (`--today`) that is allowed only with a dry run, so a pinned date never reaches real files.

## What the pack has

- [scripts/cycle.mjs](../../scripts/cycle.mjs): the computation and the marker refresh.
- [lib/cycle-file.mjs](../../lib/cycle-file.mjs): the file shape and its validator.

## Tests to port

`tests/scripts/cycle.test.mjs` covers term selection around month boundaries, graduation dates in the past and the future, marker refresh idempotence and the dry-run rule for `--today`.

## Pack follow-up once merged

Delete the files listed for this draft in [README.md](README.md) and read the cycle through upstream's interface.
