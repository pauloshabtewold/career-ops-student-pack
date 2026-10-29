# Weekly API-only liveness sweep for Pending rows

Status: draft, not posted

## Problem

Postings in a student's Pending list close while the student is busy. Checking liveness in a browser is slow and needs a display, so stale rows stay in the queue and the student spends time on roles that are already gone.

## Proposal

Add a weekly sweep over Pending rows that calls the liveness check with `--no-fallback`, so no browser ever opens:

- Only an EXPIRED result moves a row (to Skipped).
- An uncertain result never closes a row; the posting stays Pending.
- A row limit and a dry-run switch keep a run small and inspectable.

## What the pack has

- [scripts/liveness-sweep.mjs](../../scripts/liveness-sweep.mjs): the sweep.

## Tests to port

`tests/scripts/liveness-sweep.test.mjs` covers the EXPIRED-only rule, the uncertain case, the limit and the dry run.

## Pack follow-up once merged

Delete the files listed for this draft in [README.md](README.md) and schedule upstream's sweep in the weekly slot.
