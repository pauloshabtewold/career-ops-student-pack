// Assumed API: scripts/ci/audit-issues.mjs exports auditIssues({ current, previous }) where current and previous map
// preset id -> audit-portals --json output shaped { boards: [{ name, status, postings }] } with status one of
// ok | small | empty | error | no-provider. Returns an array of { preset, title, body }, one entry per flagged preset,
// and [] when nothing is flagged. Boards whose postings fell by half or more against previous are "halved".
// Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditIssues } from '../../scripts/ci/audit-issues.mjs';

const b = (name, status, postings) => ({ name, status, postings });

test('M-009-S5 builds one issue per flagged preset listing no-provider, error, empty and halved boards', () => {
  const current = {
    'preset-one': { boards: [b('Board A', 'no-provider', 0), b('Board B', 'error', 0), b('Board C', 'empty', 0), b('Board D', 'ok', 10), b('Board E', 'ok', 40)] },
    'preset-two': { boards: [b('Board F', 'ok', 20)] },
    'preset-three': { boards: [b('Board G', 'error', 0)] },
  };
  const previous = {
    'preset-one': { boards: [b('Board D', 'ok', 20), b('Board E', 'ok', 42)] },
    'preset-two': { boards: [b('Board F', 'ok', 21)] },
    'preset-three': { boards: [b('Board G', 'ok', 5)] },
  };
  const issues = auditIssues({ current, previous });
  assert.equal(issues.length, 2);
  const one = issues.find((i) => i.preset === 'preset-one');
  assert.ok(one);
  assert.match(one.title, /preset-one/);
  for (const name of ['Board A', 'Board B', 'Board C', 'Board D']) assert.ok(one.body.includes(name), name);
  assert.ok(!one.body.includes('Board E'));
  assert.match(one.body, /no-provider/);
  assert.match(one.body, /error/);
  assert.match(one.body, /empty/);
  assert.match(one.body, /halved|half/i);
  assert.ok(issues.some((i) => i.preset === 'preset-three'));
  assert.ok(!issues.some((i) => i.preset === 'preset-two'));
});

test('M-009-S5 returns no issue when nothing is flagged', () => {
  const current = { 'preset-one': { boards: [b('Board A', 'ok', 10)] } };
  const previous = { 'preset-one': { boards: [b('Board A', 'ok', 12)] } };
  assert.deepEqual(auditIssues({ current, previous }), []);
});

test('M-009-S5 works without a previous baseline', () => {
  const issues = auditIssues({ current: { 'preset-one': { boards: [b('Board A', 'empty', 0)] } }, previous: {} });
  assert.equal(issues.length, 1);
  assert.ok(issues[0].body.includes('Board A'));
});
