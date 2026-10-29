# Ingest plugin for public GitHub job lists

Status: draft, not posted

## Problem

Early-career postings are collected in public GitHub lists far faster than any single employer board. Upstream's scanner reads employer boards only, so a student gets none of those lists unless they copy rows by hand.

## Proposal

Add an ingest plugin that reads public job lists and keeps the postings that fit the student's cycle:

- Formats: a Simplify-style JSON listing, markdown tables, HTML tables, plain JSON arrays and CSV.
- A cycle filter: postings for terms or years outside the student's cycle are dropped (see the cycle logic draft).
- An allowed-hosts list in the plugin manifest, so the plugin fetches only the hosts it declares.
- Monthly discovery: probe new public repositories, promote useful trials, retire dead lists. It uses the unauthenticated search API at a paced rate, because students have no login for the gh CLI.
- Every posting is a candidate for a human to review; nothing is submitted.

## What the pack has

- [plugins/github-lists/index.mjs](../../plugins/github-lists/index.mjs): the ingest hook.
- [plugins/github-lists/manifest.json](../../plugins/github-lists/manifest.json): the manifest with its allowed hosts.
- [scripts/discover-github-lists.mjs](../../scripts/discover-github-lists.mjs): the monthly discovery.

## Tests to port

`tests/feeds/` holds parser tests for each format, eligibility tests for the cycle filter, ingest tests and discovery tests.

## Pack follow-up once merged

Delete the files listed for this draft in [README.md](README.md). Presets keep their `sources.github_lists` entries, which upstream would read through the same plugin.
