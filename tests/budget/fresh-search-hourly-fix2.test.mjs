// budget.mjs, second fix round: linkedin.fresh_search allows one read per local clock hour and at least 50 minutes after
// the last one, so the hourly scan's 0-10 minute jitter is never refused while the count per hour stays 1; a log of
// apply.easy_apply records the click even when the log lands at 22:00; status submits_today includes Easy Apply. Fake
// rows and scratch packs only; no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../scripts/budget.mjs';
import { DAY, at, baseConfig, liRow, makePack, row, run } from '../helpers/budget-harness.mjs';

const cfg = baseConfig();
const fresh = (ts) => liRow({ ts, action: 'linkedin.fresh_search', target: 'fresh-search' });
const check = (history, now) => evaluate({ action: 'linkedin.fresh_search', history, config: cfg, now }).status;

test('a jittered hourly read 55 minutes after the last one, in the next clock hour, is allowed', () => {
  assert.equal(check([fresh(at(DAY, 14, 8))], at(DAY, 15, 3)), 'ok');
  assert.equal(check([fresh(at(DAY, 14, 10))], at(DAY, 15, 0)), 'ok', '50 minutes is enough');
});

test('still at most one read per clock hour, and none within 50 minutes', () => {
  assert.equal(check([fresh(at(DAY, 14, 2))], at(DAY, 14, 58)), 'wait', 'same clock hour');
  assert.equal(check([fresh(at(DAY, 14, 20))], at(DAY, 15, 5)), 'wait', '45 minutes, next clock hour');
  const res = evaluate({ action: 'linkedin.fresh_search', history: [fresh(at(DAY, 14, 20))], config: cfg, now: at(DAY, 15, 5) });
  assert.equal(res.earliest, at(DAY, 15, 10).toISOString());
});

test('steady hourly runs with up to 10 minutes of jitter inside each clock hour are never refused', () => {
  const history = [];
  let refused = 0;
  const jitters = [10, 0, 10, 0, 7, 3, 9, 1, 10, 0, 5, 10, 2, 8];
  for (let h = 8; h < 22; h += 1) {
    const now = at(DAY, h, jitters[h - 8]);
    if (check(history, now) === 'ok') history.push(fresh(now));
    else refused += 1;
  }
  assert.equal(refused, 0);
  assert.equal(history.length, 14);
});

test('a log of apply.easy_apply at 22:00 records the click instead of a window refusal; a check at 22:00 is refused', () => {
  const approve = row({ ts: at(DAY, 9), action: 'batch.approve', approval: 'submit 1', detail: `batch=${DAY}-apply-1;items=1` });
  const pending = row({ ts: at(DAY, 21, 59), action: 'apply.pending', detail: `batch=${DAY}-apply-1;item=1` });
  const args = { target: 'ex-1', company: 'Example Robotics', batchId: `${DAY}-apply-1`, item: 1, score: 4.2 };
  const logged = evaluate({ action: 'apply.easy_apply', args: { ...args, recheck: true }, history: [approve, pending], config: cfg, now: at(DAY, 22, 0) });
  assert.equal(logged.status, 'ok', logged.reason);
  const checked = evaluate({ action: 'apply.easy_apply', args, history: [approve], config: cfg, now: at(DAY, 22, 0) });
  assert.equal(checked.status, 'refused');
  assert.match(checked.reason, /window/);
});

test('status submits_today counts Easy Apply submits', async () => {
  const p = await makePack({ rows: [row({ ts: at(DAY, 10), action: 'apply.submit' }), row({ ts: at(DAY, 11), action: 'apply.easy_apply' })] });
  try {
    const res = run(p, ['status', '--json']);
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.equal(JSON.parse(res.stdout).submits_today, 2);
  } finally {
    p.cleanup();
  }
});
