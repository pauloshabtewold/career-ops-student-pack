// W-027: the docs name the new keys, notes and scripts, and apply-loop wires the reviewer and the cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDoc } from '../helpers/doc-contract.mjs';

test('W-027-D1 usage.md documents closes=, reviewer, research_cache_days and the cache commands', () => {
  const usage = readDoc('docs/usage.md');
  for (const needle of ['closes=YYYY-MM-DD', 'closes in N days', '`reviewer`', '`research_cache_days`', 'review-app.mjs prompt', 'research-cache.mjs get', 'usage-cost.md#what-one-review-costs']) assert.ok(usage.includes(needle), needle);
});

test('W-027-D2 apply-loop wires the 4.0+ review only when reviewer is on, the cache check and closes=', () => {
  const loop = readDoc('modes/apply-loop.md');
  assert.match(loop, /4\.0 and up: full path\..*`reviewer` is `on`.*`modes\/review\.md`.*before the batch is shown/);
  assert.match(loop, /research-cache\.mjs get "<company>"/);
  assert.match(loop, /re-verify every claim you reuse/);
  assert.match(loop, /closes=YYYY-MM-DD/);
});

test('W-027-D3 the AGENTS.student.md mode table lists review.md and usage-cost.md has the review cost section', () => {
  assert.match(readDoc('AGENTS.student.md'), /\| `modes\/review\.md` \|/);
  const cost = readDoc('docs/usage-cost.md');
  assert.match(cost, /## What one review costs/);
  assert.match(cost, /opt-in/);
  assert.match(cost, /computed, not measured/);
});

test('W-027-D4 review.md restricts the reviewer to four inputs and keeps the fact gate', () => {
  const doc = readDoc('modes/review.md');
  assert.match(doc, /Only these four things/);
  assert.match(doc, /fact gate in `modes\/apply-loop\.md` still rules/);
  assert.match(doc, /review-app\.mjs run/);
});
