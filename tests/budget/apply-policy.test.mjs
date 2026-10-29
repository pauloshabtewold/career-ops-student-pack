// Assumed: budget.mjs treats apply.policy as an observed action: `log apply.policy` exits 0 and appends a row to
// data/action-log.tsv, while `check apply.policy` stays a usage error (exit 2). CEILINGS.triage_daily is down(20, count, day).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CEILINGS, effectiveLimits } from '../../scripts/budget.mjs';
import { makePack, readLog, run } from '../helpers/budget-harness.mjs';

// M-002-S12
test('M-002-S12 log apply.policy exits 0 and appends an apply.policy row; check apply.policy exits 2', async () => {
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

// M-002-S7
test('M-002-S7 the triage_daily ceiling is 20 per day and a configured value may only tighten it', () => {
  assert.equal(CEILINGS.triage_daily.value, 20);
  assert.equal(CEILINGS.triage_daily.tighten, 'down');
  assert.equal(effectiveLimits({}).values.triage_daily, 20);
  assert.equal(effectiveLimits({ limits: { triage_daily: 5 } }).values.triage_daily, 5);
  assert.equal(effectiveLimits({ limits: { triage_daily: 0 } }).values.triage_daily, 0);
  const loose = effectiveLimits({ limits: { triage_daily: 50 } });
  assert.equal(loose.values.triage_daily, 20);
  assert.deepEqual(loose.clamps, [{ key: 'triage_daily', configured: 50, ceiling: 20 }]);
});
