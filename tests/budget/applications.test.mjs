import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../scripts/budget.mjs';
import { DAY, at, shiftDate, row, many, baseConfig } from '../helpers/budget-harness.mjs';

const rng = () => 0.5;
const ev = (action, { args = {}, history = [], config = baseConfig(), now = at(DAY, 15, 0), session = 's1' } = {}) =>
  evaluate({ action, args, history, config, session, now, rng });

// Submit rows carry the track in detail as track=<name>.
const submit = (o) => row({ action: 'apply.submit', detail: `track=${o.track ?? 'swe-intern'}`, ...o });
// The first logged submit is 60 days old so the first-week session cap is not in force.
const seasoned = [submit({ ts: at(shiftDate(DAY, -60), 12, 0), target: 'ex-old', company: 'Old Example Co', session: 's0' })];
const today = (n, session = 's1') =>
  many(n, (i) => submit({ ts: at(DAY, 9, i * 5), target: `ex-s${i}`, company: `Example Co s${i}`, session }));
const args = { target: 'ex-new', company: 'Example Robotics', track: 'swe-intern', score: 4.2, batch: 1 };
const refused = (res) => {
  assert.equal(res.status, 'refused');
  assert.ok(res.reason && !res.reason.includes('\n'));
};

// M-002-S10
test('M-002-S10 apply.submit caps at 10 per day', () => {
  assert.equal(ev('apply.submit', { args, history: [...seasoned, ...today(9)] }).status, 'ok');
  refused(ev('apply.submit', { args, history: [...seasoned, ...today(10)] }));
});

test('M-002-S10 apply.submit caps at 2 per company per day', () => {
  const same = (n) => many(n, (i) => submit({ ts: at(DAY, 9, i * 5), target: `ex-r${i}`, company: 'Example Robotics' }));
  assert.equal(ev('apply.submit', { args, history: [...seasoned, ...same(1)] }).status, 'ok');
  refused(ev('apply.submit', { args, history: [...seasoned, ...same(2)] }));
});

test('M-002-S10 a batch above 3 refuses', () => {
  assert.equal(ev('apply.submit', { args: { ...args, batch: 3 }, history: seasoned }).status, 'ok');
  refused(ev('apply.submit', { args: { ...args, batch: 4 }, history: seasoned }));
});

test('M-002-S10 a score below the floor refuses and the floor itself passes', () => {
  assert.equal(ev('apply.submit', { args: { ...args, score: 3.5 }, history: seasoned }).status, 'ok');
  refused(ev('apply.submit', { args: { ...args, score: 3.4 }, history: seasoned }));
});

test('M-002-S10 a configured floor above the ceiling raises the effective floor', () => {
  const config = baseConfig({ score_floor: 4.0 });
  refused(ev('apply.submit', { args: { ...args, score: 3.8 }, history: seasoned, config }));
  assert.equal(ev('apply.submit', { args: { ...args, score: 4.0 }, history: seasoned, config }).status, 'ok');
});

// M-002-S11
test('M-002-S11 within 7 days of the first submit a fourth submit in the session refuses', () => {
  refused(ev('apply.submit', { args, history: today(3) }));
  assert.equal(ev('apply.submit', { args, history: today(2) }).status, 'ok');
});

test('M-002-S11 the cap is per session and ends after the first week', () => {
  assert.equal(ev('apply.submit', { args, history: today(3, 's0'), session: 's1' }).status, 'ok');
  const weekOld = [submit({ ts: at(shiftDate(DAY, -8), 12, 0), target: 'ex-first', company: 'First Example Co', session: 's0' })];
  assert.equal(ev('apply.submit', { args, history: [...weekOld, ...today(3)] }).status, 'ok');
});

// M-002-S12
test('M-002-S12 a second track at one company needs the user and names the existing track', () => {
  const history = [...seasoned, submit({ ts: at(shiftDate(DAY, -3), 12, 0), target: 'ex-t1', company: 'Example Robotics', track: 'swe-intern', session: 's0' })];
  const res = ev('apply.submit', { args: { ...args, track: 'ml-newgrad' }, history });
  assert.equal(res.status, 'needs-user');
  assert.match(res.reason, /swe-intern/);
  assert.equal(ev('apply.submit', { args, history }).status, 'ok');
});

test('M-002-S12 an apply.track-confirm row for the company and track lets the second track through', () => {
  const history = [
    ...seasoned,
    submit({ ts: at(shiftDate(DAY, -3), 12, 0), target: 'ex-t1', company: 'Example Robotics', track: 'swe-intern', session: 's0' }),
    row({ ts: at(shiftDate(DAY, -2), 12, 0), action: 'apply.track-confirm', target: 'ex-t1', company: 'Example Robotics', session: 's0', detail: 'track=ml-newgrad' }),
  ];
  assert.equal(ev('apply.submit', { args: { ...args, track: 'ml-newgrad' }, history }).status, 'ok');
});

// M-002-S13
test('M-002-S13 an employer policy of N per period days refuses submits past N (policies arrive as config.employer_policies)', () => {
  const config = baseConfig({ employer_policies: [{ company: 'Example Robotics', max: 2, period_days: 30, source_url: 'https://example.com/policy' }] });
  const recent = (days, n) => many(n, (i) => submit({ ts: at(shiftDate(DAY, -days), 10, i), target: `ex-p${i}`, company: 'Example Robotics', session: 's0' }));
  refused(ev('apply.submit', { args, history: [...seasoned, ...recent(10, 2)], config }));
  assert.equal(ev('apply.submit', { args, history: [...seasoned, ...recent(10, 1)], config }).status, 'ok');
  assert.equal(ev('apply.submit', { args, history: [...seasoned, ...recent(31, 2)], config }).status, 'ok');
  assert.equal(ev('apply.submit', { args: { ...args, company: 'Other Example Co' }, history: [...seasoned, ...recent(10, 2)], config }).status, 'ok');
});

test('M-002-S13 apply.jd_browser caps at 10 per session', () => {
  const jds = (n, session) => many(n, (i) => row({ ts: at(DAY, 9, i), action: 'apply.jd_browser', target: `ex-jd${i}`, session }));
  assert.equal(ev('apply.jd_browser', { args: { target: 'ex-jd-new' }, history: jds(9, 's1') }).status, 'ok');
  refused(ev('apply.jd_browser', { args: { target: 'ex-jd-new' }, history: jds(10, 's1') }));
  assert.equal(ev('apply.jd_browser', { args: { target: 'ex-jd-new' }, history: jds(10, 's0') }).status, 'ok');
});
