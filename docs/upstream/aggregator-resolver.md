# Resolve aggregator-only postings at the employer

Status: draft, not posted

## Problem

Many list rows link to a job aggregator, not to the employer. An aggregator link is only a pointer: the page may be stale, may sit behind a login or may not match the real posting. A student who applies there may never reach the employer's own application.

## Proposal

Add a resolver that confirms an aggregator-only posting on the employer's public board, or rejects it:

- Boards read: Greenhouse, Lever and Ashby public job APIs.
- When the same role is found there, the employer URL replaces the aggregator link.
- When it is not found, the row is dropped and written to an unresolved log for review.
- Only public GET requests go out, at most four in flight, and a forbidden-host list is honored; linkedin.com is never fetched.

## What the pack has

- [plugins/github-lists/_resolve.mjs](../../plugins/github-lists/_resolve.mjs): the resolver, used by the github-lists plugin.

## Tests to port

`tests/feeds/resolve.test.mjs` covers each board type, the concurrency cap, the forbidden hosts and the unresolved log.

## Pack follow-up once merged

Delete the files listed for this draft in [README.md](README.md).
