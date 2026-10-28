import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate } from '../../scripts/budget.mjs';
import { DAY, TZ, at, shiftDate, liRow, many, baseConfig, makePack, readLog, run } from '../helpers/budget-harness.mjs';

const rng = () => 0.5;
const ev = (action, { args = {}, history = [], config = baseConfig() } = {}) =>
  evaluate({ action, args, history, config, session: 's1', now: at(DAY, 15, 0), rng });
const connects = (n) => many(n, (i) => liRow({ ts: at(DAY, 8, 30 + i * 10), action: 'linkedin.connect', target: `ex-${i}`, company: `Example Co ${i}` }));
const connectArgs = { target: 'ex-new', company: 'Example Robotics', pending: 50 };

// M-002-S17
test('M-002-S17 a looser max limit is clamped to the ceiling', () => {
  const config = baseConfig({ limits: { connect_per_day: 50 } });
  assert.equal(ev('linkedin.connect', { args: connectArgs, history: connects(20), config }).status, 'refused');
  assert.equal(ev('linkedin.connect', { args: connectArgs, history: connects(19), config }).status, 'ok');
});

test('M-002-S17 a looser min limit is clamped to the ceiling', () => {
  // nudge_min_days tightens upward, so a configured 2 is looser than the ceiling of 5.
  const config = baseConfig({ limits: { nudge_min_days: 2 } });
  const history = [liRow({ ts: at(shiftDate(DAY, -4), 12, 0), action: 'linkedin.message', target: 'ex-n', company: 'Example Robotics' })];
  assert.equal(ev('linkedin.nudge', { args: { target: 'ex-n', company: 'Example Robotics' }, history, config }).status, 'refused');
});

test('M-002-S17 CLI logs one clamp row per distinct configured value and session-start prints it', async () => {
  const p = await makePack({ config: 'limits:\n  connect_per_day: 50\n' });
  const clampRows = async (needle) => (await readLog(p)).filter((r) => r.detail.includes(needle));
  const check = () => run(p, ['check', 'linkedin.connect', '--target', 'ex-new', '--company', 'Example Robotics', '--pending', '50']);
  try {
    assert.equal(check().code, 0);
    const start = run(p, ['session-start']);
    assert.equal(start.code, 0);
    assert.match(start.stdout, /connect_per_day/);
    assert.match(start.stdout, /50/);
    assert.ok(existsSync(join(p.dataDir, '.student-session.json')));
    check();
    run(p, ['session-start']);
    assert.equal((await clampRows('connect_per_day=50')).length, 1);

    writeFileSync(join(p.root, 'config', 'student.yml'), `timezone: ${TZ}\nlimits:\n  connect_per_day: 40\n`);
    check();
    run(p, ['session-start']);
    assert.equal((await clampRows('connect_per_day=40')).length, 1);
    assert.equal((await clampRows('connect_per_day=50')).length, 1);
  } finally {
    p.cleanup();
  }
});

test('M-002-S17 CLI enforces the ceiling when config holds a looser limit', async () => {
  const p = await makePack({ config: 'limits:\n  connect_per_day: 50\n', rows: connects(20) });
  try {
    assert.equal(run(p, ['check', 'linkedin.connect', '--target', 'ex-new', '--company', 'Example Robotics', '--pending', '50']).code, 3);
  } finally {
    p.cleanup();
  }
});

// M-002-S18
test('M-002-S18 a tighter max limit is enforced as configured', () => {
  const config = baseConfig({ limits: { connect_per_day: 5 } });
  assert.equal(ev('linkedin.connect', { args: connectArgs, history: connects(4), config }).status, 'ok');
  assert.equal(ev('linkedin.connect', { args: connectArgs, history: connects(5), config }).status, 'refused');
});

test('M-002-S18 a tighter min limit is enforced as configured', () => {
  const config = baseConfig({ limits: { nudge_min_days: 7 } });
  const msg = (days) => [liRow({ ts: at(shiftDate(DAY, -days), 12, 0), action: 'linkedin.message', target: 'ex-n', company: 'Example Robotics' })];
  const args = { target: 'ex-n', company: 'Example Robotics' };
  assert.equal(ev('linkedin.nudge', { args, history: msg(6), config }).status, 'refused');
  assert.equal(ev('linkedin.nudge', { args, history: msg(8), config }).status, 'ok');
});

test('M-002-S18 CLI enforces a tighter configured limit', async () => {
  const p = await makePack({ config: 'limits:\n  connect_per_day: 5\n', rows: connects(5) });
  try {
    assert.equal(run(p, ['check', 'linkedin.connect', '--target', 'ex-new', '--company', 'Example Robotics', '--pending', '50']).code, 3);
  } finally {
    p.cleanup();
  }
});
