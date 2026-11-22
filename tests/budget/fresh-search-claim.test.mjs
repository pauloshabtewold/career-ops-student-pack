// budget.mjs log linkedin.fresh_search is a compare-and-set under the action-log lock: the first log in an hour is
// written, a second one inside the hour is refused (exit 4) and writes no row, so a read logged before it starts counts
// even when the read then fails. Scratch packs only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makePack, readLog, run } from '../helpers/budget-harness.mjs';

test('a second fresh-search log inside the hour is refused and adds no row', async () => {
  const p = await makePack({ rows: [] });
  try {
    const first = run(p, ['log', 'linkedin.fresh_search', '--target', 'fresh-search']);
    assert.equal(first.code, 0, first.stdout + first.stderr);
    const second = run(p, ['log', 'linkedin.fresh_search', '--target', 'fresh-search']);
    assert.equal(second.code, 4, second.stdout + second.stderr);
    const rows = (await readLog(p)).filter((r) => r.action === 'linkedin.fresh_search');
    assert.equal(rows.length, 1);
    assert.match(rows[0].detail, /next_allowed=/);
  } finally {
    p.cleanup();
  }
});
