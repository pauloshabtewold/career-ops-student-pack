// Assumed: budget.mjs treats apply.policy as an observed action: `log apply.policy` exits 0 and appends a row to
// data/action-log.tsv, while `check apply.policy` stays a usage error (exit 2).
// Model-usage triage is the student's budget (lib/triage-budget.mjs), so CEILINGS has no triage_daily entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CEILINGS, effectiveLimits } from '../../scripts/budget.mjs';
import { makePack, readLog, run } from '../helpers/budget-harness.mjs';

// legacy-M-002-S12
test('legacy-M-002-S12 log apply.policy exits 0 and appends an apply.policy row; check apply.policy exits 2', async () => {
  const pack = await makePack();
  try {
    const logged = run(pack, ['log', 'apply.policy', '--target', 'example-robotics', '--company', 'Example Robotics']);
    assert.equal(logged.code, 0, logged.stdout + logged.stderr);
    const rows = (await readLog(pack)).filter((r) => r.action === 'apply.policy');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].target, 'example-robotics');
    assert.equal(rows[0].company, 'Example Robotics');
    const checked = run(pack, ['check', 'apply.policy']);
    assert.equal(checked.code, 2, checked.stdout + checked.stderr);
  } finally {
    pack.cleanup();
  }
});

// M-001-S1
test('M-001-S1 CEILINGS has no triage_daily key and effectiveLimits returns no triage_daily value and no clamp', () => {
  assert.equal('triage_daily' in CEILINGS, false);
  const none = effectiveLimits({});
  assert.equal('triage_daily' in none.values, false);
  assert.deepEqual(none.clamps, []);
  const legacy = effectiveLimits({ limits: { triage_daily: 50 } });
  assert.equal('triage_daily' in legacy.values, false);
  assert.deepEqual(legacy.clamps, []);
});
