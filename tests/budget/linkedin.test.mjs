import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../scripts/budget.mjs';
import { DAY, at, shiftDate, row, liRow, many, baseConfig, makePack, readLog, run } from '../helpers/budget-harness.mjs';

const NOW = at(DAY, 15, 0);
const rng = () => 0.5;
const ev = (action, { args = {}, history = [], config = baseConfig(), now = NOW, session = 's1' } = {}) =>
  evaluate({ action, args, history, config, session, now, rng });
const connects = (n, day = DAY, startHour = 8, startMin = 30) =>
  many(n, (i) => liRow({ ts: at(day, startHour, startMin + i * 10), action: 'linkedin.connect', target: `ex-${day}-${i}`, company: `Example Co ${day}-${i}` }));
const connectArgs = { target: 'ex-new', company: 'Example Robotics', pending: 50 };

function assertRefused(res) {
  assert.equal(res.status, 'refused');
  assert.equal(typeof res.reason, 'string');
  assert.ok(res.reason.length > 0 && !res.reason.includes('\n'), 'one-line reason');
}

// M-002-S1
test('M-002-S1 linkedin.connect allows 19 connects today and refuses at 20', () => {
  assert.equal(ev('linkedin.connect', { args: connectArgs, history: connects(19) }).status, 'ok');
  assertRefused(ev('linkedin.connect', { args: connectArgs, history: connects(20) }));
});

test('M-002-S1 connects logged on a previous local day do not count toward today', () => {
  assert.equal(ev('linkedin.connect', { args: connectArgs, history: connects(20, shiftDate(DAY, -1)) }).status, 'ok');
});

// M-002-S1 (CLI)
test('M-002-S1 CLI connect check exits 0 at 19, exits 3 with one stdout line at 20 and logs one refusal row', async () => {
  const ok = await makePack({ rows: connects(19) });
  const full = await makePack({ rows: connects(20) });
  try {
    assert.equal(run(ok, ['check', 'linkedin.connect', '--target', 'ex-new', '--company', 'Example Robotics', '--pending', '50']).code, 0);
    const before = (await readLog(full)).length;
    const r = run(full, ['check', 'linkedin.connect', '--target', 'ex-new', '--company', 'Example Robotics', '--pending', '50']);
    assert.equal(r.code, 3);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    assert.equal((await readLog(full)).length, before + 1);
  } finally {
    ok.cleanup();
    full.cleanup();
  }
});

// M-002-S2
test('M-002-S2 100 connects in the rolling 7 days refuse even when today has none', () => {
  const days = [1, 2, 3, 4, 5].flatMap((d) => connects(20, shiftDate(DAY, -d), 12, 0));
  assert.equal(days.length, 100);
  assertRefused(ev('linkedin.connect', { args: connectArgs, history: days }));
  assert.equal(ev('linkedin.connect', { args: connectArgs, history: days.slice(1) }).status, 'ok');
});

test('M-002-S2 connects older than 7 days leave the rolling window', () => {
  const inWindow = [1, 2, 3, 4].flatMap((d) => connects(20, shiftDate(DAY, -d), 12, 0));
  const old = connects(20, shiftDate(DAY, -8), 12, 0);
  assert.equal(ev('linkedin.connect', { args: connectArgs, history: [...inWindow, ...old] }).status, 'ok');
});

// M-002-S3
test('M-002-S3 pending invites above 200 or missing refuse; 200 passes', () => {
  assertRefused(ev('linkedin.connect', { args: { ...connectArgs, pending: 201 } }));
  assertRefused(ev('linkedin.connect', { args: { target: 'ex-new', company: 'Example Robotics' } }));
  assert.equal(ev('linkedin.connect', { args: { ...connectArgs, pending: 200 } }).status, 'ok');
});

test('M-002-S3 CLI connect check without --pending exits 3', async () => {
  const p = await makePack();
  try {
    assert.equal(run(p, ['check', 'linkedin.connect', '--target', 'ex-new', '--company', 'Example Robotics']).code, 3);
  } finally {
    p.cleanup();
  }
});

// M-002-S4
test('M-002-S4 linkedin.message caps at 10 per day', () => {
  const msgs = (n) => many(n, (i) => liRow({ ts: at(DAY, 8, 30 + i * 10), action: 'linkedin.message', target: `ex-m${i}`, company: `Example Co m${i}` }));
  const args = { target: 'ex-new', company: 'Example Robotics', length: 120 };
  assert.equal(ev('linkedin.message', { args, history: msgs(9) }).status, 'ok');
  assertRefused(ev('linkedin.message', { args, history: msgs(10) }));
});

test('M-002-S4 linkedin.profile_view caps at 60 per day', () => {
  const views = (n) => many(n, (i) => liRow({ ts: at(DAY, 8, 0, i * 60), action: 'linkedin.profile_view', target: `ex-v${i}` }));
  assert.equal(ev('linkedin.profile_view', { args: { target: 'ex-new' }, history: views(59) }).status, 'ok');
  assertRefused(ev('linkedin.profile_view', { args: { target: 'ex-new' }, history: views(60) }));
});

test('M-002-S4 linkedin.search_page caps at 8 per session', () => {
  const pages = (n, session) => many(n, (i) => liRow({ ts: at(DAY, 9, i), action: 'linkedin.search_page', target: `search-${i}`, session }));
  assert.equal(ev('linkedin.search_page', { args: { search: 'search-x' }, history: pages(7, 's1') }).status, 'ok');
  assertRefused(ev('linkedin.search_page', { args: { search: 'search-x' }, history: pages(8, 's1') }));
  assert.equal(ev('linkedin.search_page', { args: { search: 'search-x' }, history: pages(8, 's0') }).status, 'ok');
});

// M-002-S5
test('M-002-S5 a check inside the drawn gap waits until next_allowed, then passes', () => {
  const last = at(DAY, 14, 59, 0);
  const nextAllowed = at(DAY, 15, 1, 20);
  const history = [row({ ts: last, action: 'linkedin.profile_view', target: 'ex-v', detail: `next_allowed=${nextAllowed.toISOString()}` })];
  const early = ev('linkedin.profile_view', { args: { target: 'ex-new' }, history, now: at(DAY, 15, 0, 30) });
  assert.equal(early.status, 'wait');
  assert.equal(new Date(early.earliest).getTime(), nextAllowed.getTime());
  assert.equal(ev('linkedin.profile_view', { args: { target: 'ex-new' }, history, now: at(DAY, 15, 1, 21) }).status, 'ok');
});

test('M-002-S5 the gap applies across LinkedIn action types', () => {
  const nextAllowed = at(DAY, 15, 1, 20);
  const history = [row({ ts: at(DAY, 14, 59), action: 'linkedin.search_page', target: 'search-1', detail: `next_allowed=${nextAllowed.toISOString()}` })];
  assert.equal(ev('linkedin.connect', { args: connectArgs, history, now: at(DAY, 15, 0, 30) }).status, 'wait');
});

test('M-002-S5 CLI inside the gap exits 4, prints the earliest time and logs no row; after the gap exits 0', async () => {
  const waiting = await makePack({
    rows: [row({ ts: at(DAY, 11, 59), action: 'linkedin.profile_view', target: 'ex-v', detail: `next_allowed=${at(DAY, 12, 0, 30).toISOString()}` })],
  });
  const clear = await makePack({
    rows: [row({ ts: at(DAY, 11, 57), action: 'linkedin.profile_view', target: 'ex-v', detail: `next_allowed=${at(DAY, 11, 58).toISOString()}` })],
  });
  try {
    const r = run(waiting, ['check', 'linkedin.profile_view', '--target', 'ex-new']);
    assert.equal(r.code, 4);
    assert.match(r.stdout, /(12|17):00:30/);
    assert.equal((await readLog(waiting)).length, 1);
    assert.equal(run(clear, ['check', 'linkedin.profile_view', '--target', 'ex-new']).code, 0);
  } finally {
    waiting.cleanup();
    clear.cleanup();
  }
});

test('M-002-S5 log of a LinkedIn action stores next_allowed between 45 and 120 seconds after the row', async () => {
  const p = await makePack();
  try {
    assert.equal(run(p, ['log', 'linkedin.profile_view', '--target', 'ex-new']).code, 0);
    const [logged] = await readLog(p);
    const m = /next_allowed=([^\s;,]+)/.exec(logged.detail);
    assert.ok(m, `detail carries next_allowed: ${logged.detail}`);
    const gap = (new Date(m[1]).getTime() - new Date(logged.ts).getTime()) / 1000;
    assert.ok(gap >= 45 && gap <= 120, `gap ${gap}`);
  } finally {
    p.cleanup();
  }
});

// M-002-S6
test('M-002-S6 the LinkedIn window is 08:00 inclusive to 22:00 exclusive local time', () => {
  const view = (now) => ev('linkedin.profile_view', { args: { target: 'ex-new' }, now }).status;
  assert.equal(view(at(DAY, 7, 59)), 'refused');
  assert.equal(view(at(DAY, 8, 0)), 'ok');
  assert.equal(view(at(DAY, 21, 59)), 'ok');
  assert.equal(view(at(DAY, 22, 0)), 'refused');
});

test('M-002-S6 a refused connect check refuses the next connect check the same day (refusal row rule)', async () => {
  const p = await makePack();
  try {
    assert.equal(run(p, ['check', 'linkedin.connect', '--target', 'ex-a', '--company', 'Example Robotics', '--pending', '500']).code, 3);
    assert.equal(run(p, ['check', 'linkedin.connect', '--target', 'ex-b', '--company', 'Example Robotics', '--pending', '50']).code, 3);
    assert.equal(run(p, ['check', 'linkedin.connect', '--target', 'ex-b', '--company', 'Example Robotics', '--pending', '50'], { today: shiftDate(DAY, 1) }).code, 0);
  } finally {
    p.cleanup();
  }
});

// M-002-S7
test('M-002-S7 a company with 3 contacted targets refuses a fourth connect', () => {
  const contacted = (n) => many(n, (i) => liRow({ ts: at(DAY, 9, i * 5), action: 'linkedin.connect', target: `ex-c${i}`, company: 'Example Robotics' }));
  assert.equal(ev('linkedin.connect', { args: connectArgs, history: contacted(2) }).status, 'ok');
  assertRefused(ev('linkedin.connect', { args: connectArgs, history: contacted(3) }));
  assert.equal(ev('linkedin.connect', { args: { ...connectArgs, company: 'Other Example Co' }, history: contacted(3) }).status, 'ok');
});

test('M-002-S7 a second nudge to the same target refuses', () => {
  const history = [
    liRow({ ts: at(shiftDate(DAY, -20), 12, 0), action: 'linkedin.message', target: 'ex-n', company: 'Example Robotics' }),
    liRow({ ts: at(shiftDate(DAY, -10), 12, 0), action: 'linkedin.nudge', target: 'ex-n', company: 'Example Robotics' }),
  ];
  assertRefused(ev('linkedin.nudge', { args: { target: 'ex-n', company: 'Example Robotics' }, history }));
});

test('M-002-S7 a nudge needs 5 days since the last message to the target', () => {
  const msg = (days) => [liRow({ ts: at(shiftDate(DAY, -days), 12, 0), action: 'linkedin.message', target: 'ex-n', company: 'Example Robotics' })];
  const args = { target: 'ex-n', company: 'Example Robotics' };
  assertRefused(ev('linkedin.nudge', { args, history: msg(4) }));
  assert.equal(ev('linkedin.nudge', { args, history: msg(6) }).status, 'ok');
});

// M-002-S8
test('M-002-S8 free tier allows 2 notes in the rolling 7 days and refuses a third (note rows carry detail note=<length>)', () => {
  const notes = (n) =>
    many(n, (i) => {
      const day = shiftDate(DAY, -1 - i);
      return liRow({ ts: at(day, 12, 0), action: 'linkedin.connect', target: `ex-note${i}`, company: `Example Co note${i}`, detail: `note=100;next_allowed=${at(day, 12, 1).toISOString()}` });
    });
  const args = { ...connectArgs, length: 100 };
  assert.equal(ev('linkedin.connect', { args, history: notes(1) }).status, 'ok');
  assertRefused(ev('linkedin.connect', { args, history: notes(2) }));
  assert.equal(ev('linkedin.connect', { args, history: notes(2), config: baseConfig({ linkedin_tier: 'premium' }) }).status, 'ok');
});

test('M-002-S8 note length caps at 200 on free and 300 on premium', () => {
  const free = (length) => ev('linkedin.connect', { args: { ...connectArgs, length } }).status;
  const premium = (length) => ev('linkedin.connect', { args: { ...connectArgs, length }, config: baseConfig({ linkedin_tier: 'premium' }) }).status;
  assert.equal(free(200), 'ok');
  assert.equal(free(201), 'refused');
  assert.equal(premium(300), 'ok');
  assert.equal(premium(301), 'refused');
});

test('M-002-S8 a first message of 300 characters refuses and 299 passes', () => {
  const msg = (length) => ev('linkedin.message', { args: { target: 'ex-new', company: 'Example Robotics', length } }).status;
  assert.equal(msg(299), 'ok');
  assert.equal(msg(300), 'refused');
});

// M-002-S9
test('M-002-S9 a logged linkedin warning refuses every LinkedIn action until the next local day', async () => {
  const p = await makePack();
  try {
    assert.equal(run(p, ['warning', 'linkedin']).code, 0);
    assert.equal(run(p, ['check', 'linkedin.profile_view', '--target', 'ex-new']).code, 3);
    assert.equal(run(p, ['check', 'linkedin.search_page', '--search', 'search-1']).code, 3);
    assert.equal(run(p, ['check', 'linkedin.profile_view', '--target', 'ex-new'], { today: shiftDate(DAY, 1) }).code, 0);
  } finally {
    p.cleanup();
  }
});

test('M-002-S9 due-withdrawals lists connects older than 21 days with no accept or withdraw row', async () => {
  const old = shiftDate(DAY, -22);
  const p = await makePack({
    rows: [
      liRow({ ts: at(old, 10, 0), action: 'linkedin.connect', target: 'due-pending-aaa', company: 'Example Co a' }),
      liRow({ ts: at(old, 10, 10), action: 'linkedin.connect', target: 'due-accepted-bbb', company: 'Example Co b' }),
      liRow({ ts: at(shiftDate(DAY, -15), 10, 0), action: 'linkedin.accept', target: 'due-accepted-bbb', company: 'Example Co b' }),
      liRow({ ts: at(old, 10, 20), action: 'linkedin.connect', target: 'due-withdrawn-ccc', company: 'Example Co c' }),
      liRow({ ts: at(shiftDate(DAY, -1), 10, 0), action: 'linkedin.withdraw', target: 'due-withdrawn-ccc', company: 'Example Co c' }),
      liRow({ ts: at(shiftDate(DAY, -10), 10, 0), action: 'linkedin.connect', target: 'due-recent-ddd', company: 'Example Co d' }),
    ],
  });
  try {
    const r = run(p, ['due-withdrawals']);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /due-pending-aaa/);
    assert.doesNotMatch(r.stdout, /due-accepted-bbb|due-withdrawn-ccc|due-recent-ddd/);
  } finally {
    p.cleanup();
  }
});
