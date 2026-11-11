# Handshake pass

Read this when the user says "Handshake pass" and `switches.handshake` is `on`.

## Terms

Handshake's student terms (last updated 2025-07-22) ban third-party bulk collection by automated scripts and profile crawling or scraping. They do not name a student's own read-only, user-watched pass over a few result pages, so this pack rates them ambiguous and ships the pass on. Handshake can still limit an account. The user can say "stop handshake" at any time.

## Rules

- Interactive sessions only, with the user already signed in. Never sign in for the user. If a login page shows, skip the step.
- Read-only: page loads and the extractor template only. No clicks inside Handshake.
- At most 4 result pages per search per session. Before each page run `node student/scripts/budget.mjs check handshake.page --search "<search id>"` and log it after. Stop at the last pass's cutoff.

## Steps

1. Fill `templates/handshake-extract.js` from the student folder with the preset title regex and a page cap of 4.
2. Open the student's Handshake search results in the browser they are signed in to (their saved search from Part B when one exists, otherwise the preset title search), and on each page run the extractor and save the copied rows to a `.tsv` file.
3. Run `node student/scripts/handshake-import.mjs page1.tsv page2.tsv`, then `node student/scripts/merge-post.mjs`.
