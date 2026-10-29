# Upstream offers

Generic pieces of the pack are offered to career-ops issue-first, so upstream decides whether it wants them before any pull request. The files in this folder are draft issue bodies kept in the pack. Automation never posts them; a maintainer posts each one by hand, replaces the status line, and records the issue link in the table below.

## Delete once merged

When upstream merges a piece, the pack files listed for it are deleted and its row is removed in the same pull request.

| Draft | Pack files to delete when upstream merges | Upstream issue | Status |
| --- | --- | --- | --- |
| [cycle-logic](cycle-logic.md) | `scripts/cycle.mjs`, `lib/cycle-file.mjs`, `tests/scripts/cycle.test.mjs` | <upstream-issue-url> | draft |
| [github-lists-plugin](github-lists-plugin.md) | `plugins/github-lists/`, `scripts/discover-github-lists.mjs`, `tests/feeds/` | <upstream-issue-url> | draft |
| [liveness-sweep](liveness-sweep.md) | `scripts/liveness-sweep.mjs`, `tests/scripts/liveness-sweep.test.mjs` | <upstream-issue-url> | draft |
| [aggregator-resolver](aggregator-resolver.md) | `plugins/github-lists/_resolve.mjs`, `tests/feeds/resolve.test.mjs` | <upstream-issue-url> | draft |
| [bigtech-providers](bigtech-providers.md) | none: no pack feed exists | <upstream-issue-url> | draft |

The github-lists row lists the whole plugin folder and the feeds tests, which include the aggregator resolver files named in the next row. If upstream merges the plugin without the resolver, keep those two files.
