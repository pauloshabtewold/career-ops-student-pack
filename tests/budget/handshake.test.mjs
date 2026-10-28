import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../../scripts/budget.mjs';
import { DAY, at, row, many, baseConfig, makePack, run } from '../helpers/budget-harness.mjs';

const rng = () => 0.5;
const ev = (action, { args = {}, history = [], config = baseConfig(), now = at(DAY, 15, 0), session = 's1' } = {}) =>
  evaluate({ action, args, history, config, session, now, rng });
// Handshake page rows carry the search id both as target and as detail search=<id>.
const pages = (n, search, session = 's1') =>
  many(n, (i) => row({ ts: at(DAY, 9, i), action: 'handshake.page', target: search, session, detail: `search=${search}` }));

// M-002-S14
test('M-002-S14 handshake.page caps at 4 per search per session', () => {
  assert.equal(ev('handshake.page', { args: { search: 'search-1' }, history: pages(3, 'search-1') }).status, 'ok');
  assert.equal(ev('handshake.page', { args: { search: 'search-1' }, history: pages(4, 'search-1') }).status, 'refused');
});

test('M-002-S14 the cap is per search and per session', () => {
  const other = pages(4, 'search-2');
  assert.equal(ev('handshake.page', { args: { search: 'search-1' }, history: [...pages(3, 'search-1'), ...other] }).status, 'ok');
  assert.equal(ev('handshake.page', { args: { search: 'search-1' }, history: pages(4, 'search-1', 's0') }).status, 'ok');
});

test('M-002-S14 the handshake switch off refuses handshake.page', () => {
  const config = baseConfig({ switches: { handshake: 'off' } });
  assert.equal(ev('handshake.page', { args: { search: 'search-1' }, config }).status, 'refused');
});

test('M-002-S14 handshake is independent of the LinkedIn window', () => {
  assert.equal(ev('handshake.page', { args: { search: 'search-1' }, now: at(DAY, 23, 30) }).status, 'ok');
  assert.equal(ev('linkedin.profile_view', { args: { target: 'ex-new' }, now: at(DAY, 23, 30) }).status, 'refused');
});

test('M-002-S14 a handshake warning stops handshake for the day and leaves LinkedIn alone', async () => {
  const p = await makePack();
  try {
    assert.equal(run(p, ['warning', 'handshake']).code, 0);
    assert.equal(run(p, ['check', 'handshake.page', '--search', 'search-1']).code, 3);
    assert.equal(run(p, ['check', 'linkedin.profile_view', '--target', 'ex-new']).code, 0);
  } finally {
    p.cleanup();
  }
});

test('M-002-S14 CLI handshake.page exits 3 when config switches handshake off', async () => {
  const p = await makePack({ config: 'switches:\n  handshake: "off"\n' });
  try {
    assert.equal(run(p, ['check', 'handshake.page', '--search', 'search-1']).code, 3);
  } finally {
    p.cleanup();
  }
});

// M-002-S15
test('M-002-S15 outreach drafts or off refuse connect, message and nudge sends', () => {
  const calls = {
    'linkedin.connect': { target: 'ex-new', company: 'Example Robotics', pending: 50 },
    'linkedin.message': { target: 'ex-new', company: 'Example Robotics', length: 100 },
    'linkedin.nudge': { target: 'ex-n', company: 'Example Robotics' },
  };
  const history = [row({ ts: at('2026-02-01', 12, 0), action: 'linkedin.message', target: 'ex-n', company: 'Example Robotics' })];
  for (const outreach of ['drafts', 'off']) {
    for (const [action, args] of Object.entries(calls)) {
      const res = ev(action, { args, history, config: baseConfig({ switches: { outreach } }) });
      assert.equal(res.status, 'refused', `${action} with outreach ${outreach}`);
    }
  }
  assert.equal(ev('linkedin.nudge', { args: calls['linkedin.nudge'], history }).status, 'ok');
});

test('M-002-S15 outreach drafts still allows profile views', () => {
  assert.equal(ev('linkedin.profile_view', { args: { target: 'ex-new' }, config: baseConfig({ switches: { outreach: 'drafts' } }) }).status, 'ok');
});
