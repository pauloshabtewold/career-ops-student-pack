// M-004-S10 keep: the LinkedIn connect and message ceilings and the 08:00 to 22:00 window stay as they are while P3 adds
// outreach rules. tests/budget/linkedin.test.mjs and tests/budget/ceilings-unchanged.test.mjs are locked by earlier
// milestones, so this file pins the P3 keep scenario on the same ceilings through CEILINGS and evaluate().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CEILINGS, evaluate } from '../../scripts/budget.mjs';
import { DAY, at, shiftDate, liRow, many, baseConfig } from '../helpers/budget-harness.mjs';

const NOW = at(DAY, 15, 0);
const rng = () => 0.5;
const ev = (action, { args = {}, history = [], now = NOW } = {}) => evaluate({ action, args, history, config: baseConfig(), session: 's1', now, rng }).status;
const sends = (action, n, day = DAY) => many(n, (i) => liRow({ ts: at(day, 8, 30 + i * 10), action, target: `ex-${action}-${day}-${i}`, company: `Example Co ${day}-${i}` }));
const connectArgs = { target: 'ex-new', company: 'Example Robotics', pending: 50 };

// M-004-S10-osdr
test('M-004-S10-osdr keep: existing connect and message ceilings and the LinkedIn time window stay unchanged', () => {
  const pick = (k) => ({ value: CEILINGS[k].value, tighten: CEILINGS[k].tighten });
  assert.deepEqual(pick('connect_per_day'), { value: 20, tighten: 'down' });
  assert.deepEqual(pick('connect_per_rolling_7d'), { value: 100, tighten: 'down' });
  assert.deepEqual(pick('message_per_day'), { value: 10, tighten: 'down' });
  assert.deepEqual(pick('window_start'), { value: '08:00', tighten: 'up' });
  assert.deepEqual(pick('window_end'), { value: '22:00', tighten: 'down' });

  assert.equal(ev('linkedin.connect', { args: connectArgs, history: sends('linkedin.connect', 19) }), 'ok');
  assert.equal(ev('linkedin.connect', { args: connectArgs, history: sends('linkedin.connect', 20) }), 'refused');
  const week = [1, 2, 3, 4, 5].flatMap((d) => sends('linkedin.connect', 20, shiftDate(DAY, -d)));
  assert.equal(ev('linkedin.connect', { args: connectArgs, history: week.slice(1) }), 'ok');
  assert.equal(ev('linkedin.connect', { args: connectArgs, history: week }), 'refused');
  const msgArgs = { target: 'ex-new', company: 'Example Robotics', length: 120 };
  assert.equal(ev('linkedin.message', { args: msgArgs, history: sends('linkedin.message', 9) }), 'ok');
  assert.equal(ev('linkedin.message', { args: msgArgs, history: sends('linkedin.message', 10) }), 'refused');
  const view = (now) => ev('linkedin.profile_view', { args: { target: 'ex-new' }, now });
  assert.equal(view(at(DAY, 7, 59)), 'refused');
  assert.equal(view(at(DAY, 8, 0)), 'ok');
  assert.equal(view(at(DAY, 21, 59)), 'ok');
  assert.equal(view(at(DAY, 22, 0)), 'refused');
});
