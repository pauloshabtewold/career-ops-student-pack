// Assumed API: scripts/ci/audit-issues.mjs exports auditIssues({ current, previous }) where current and previous map
// preset id -> audit-portals --json output shaped { boards: [{ name, status, postings }] } with status one of
// ok | small | empty | error | no-provider. Returns an array of { preset, title, body }, one entry per flagged preset,
// and [] when nothing is flagged. Boards whose postings fell by half or more against previous are "halved".
// Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUDIT_TITLE, auditIssues, auditTitle, ghCommands, planIssues } from '../../scripts/ci/audit-issues.mjs';

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

// M-003-S15 normal: AUDIT_TITLE parses every auditTitle output back to its preset id
test('M-003-S15 AUDIT_TITLE captures the preset id from auditTitle output for 1 and 3 boards', () => {
  for (const n of [1, 3]) {
    const m = AUDIT_TITLE.exec(auditTitle('x', n));
    assert.ok(m, `no match for ${n}`);
    assert.equal(m[1], 'x');
  }
});

// M-003-S16 normal: auditTitle text is pinned and auditIssues titles come from it
test('M-003-S16 auditTitle text is pinned for one and several flagged boards', () => {
  assert.equal(auditTitle('x', 1), 'Preset audit: x has 1 flagged board');
  assert.equal(auditTitle('x', 3), 'Preset audit: x has 3 flagged boards');
});

test('M-003-S16 auditIssues titles equal auditTitle output for the fixture presets', () => {
  const current = {
    'preset-one': { boards: [b('Board A', 'empty', 0), b('Board B', 'error', 0)] },
    'preset-three': { boards: [b('Board G', 'error', 0)] },
  };
  const issues = auditIssues({ current, previous: {} });
  assert.equal(issues.length, 2);
  assert.equal(issues.find((i) => i.preset === 'preset-one').title, auditTitle('preset-one', 2));
  assert.equal(issues.find((i) => i.preset === 'preset-three').title, auditTitle('preset-three', 1));
});

// M-003-S20 keep: audit-issues titles and bodies stay unchanged
test('M-003-S20 auditIssues keeps its title and body text', () => {
  const current = { 'preset-one': { boards: [b('Board A', 'no-provider', 0), b('Board D', 'ok', 10)] } };
  const previous = { 'preset-one': { boards: [b('Board D', 'ok', 20)] } };
  const [issue] = auditIssues({ current, previous });
  assert.equal(issue.title, 'Preset audit: preset-one has 2 flagged boards');
  assert.ok(issue.body.startsWith('Monthly audit of the preset-one seed list found boards that need a look.'));
  assert.ok(issue.body.includes('## Status no-provider (1)'));
  assert.ok(issue.body.includes('- Board D (20 to 10)'));
});

// W-011-S1 a monthly run comments on the open audit issue for a preset instead of opening a duplicate. The title count
// changes month to month, so the match is on the preset id that AUDIT_TITLE captures.
test('W-011-S1 planIssues comments on an open audit issue for the same preset and creates one otherwise', () => {
  const issues = [
    { preset: 'preset-one', title: auditTitle('preset-one', 2), body: 'body one' },
    { preset: 'preset-two', title: auditTitle('preset-two', 1), body: 'body two' },
  ];
  const open = [
    { number: 7, title: auditTitle('preset-one', 5) },
    { number: 9, title: 'Unrelated issue about preset-two' },
  ];
  const plan = planIssues({ issues, open });
  assert.equal(plan.length, 2);
  const one = plan.find((p) => p.preset === 'preset-one');
  assert.equal(one.action, 'comment');
  assert.equal(one.number, 7);
  const two = plan.find((p) => p.preset === 'preset-two');
  assert.equal(two.action, 'create');
  const cmds = ghCommands(plan, 'owner/repo');
  assert.equal(cmds.filter((c) => c[0] === 'issue' && c[1] === 'create').length, 1);
  assert.ok(cmds.some((c) => c[1] === 'comment' && c[2] === '7' && c.includes('--repo') && c.includes('owner/repo')));
  assert.ok(cmds.some((c) => c[1] === 'edit' && c[2] === '7' && c.includes(auditTitle('preset-one', 2))));
});

test('W-011-S1 with several open issues for one preset the newest is reused', () => {
  const issues = [{ preset: 'preset-one', title: auditTitle('preset-one', 1), body: 'b' }];
  const open = [{ number: 3, title: auditTitle('preset-one', 1) }, { number: 12, title: auditTitle('preset-one', 4) }];
  const [p] = planIssues({ issues, open });
  assert.equal(p.action, 'comment');
  assert.equal(p.number, 12);
});

// W-028: watch-only seeds are expected to have no provider, so they are counted, not listed; other statuses still flag.
test('W-028 auditIssues counts watch-only no-provider seeds instead of listing them', () => {
  const current = {
    'preset-one': { boards: [b('Board A', 'no-provider', 0), b('Board B', 'no-provider', 0), b('Board C', 'error', 0)] },
    'preset-two': { boards: [b('Board D', 'no-provider', 0), b('Board E', 'ok', 5)] },
  };
  const watchOnly = { 'preset-one': ['Board A', 'Board C'], 'preset-two': ['Board D'] };
  const issues = auditIssues({ current, watchOnly });
  assert.equal(issues.length, 1);
  const [one] = issues;
  assert.equal(one.title, auditTitle('preset-one', 2));
  assert.ok(!one.body.includes('- Board A'));
  assert.ok(one.body.includes('- Board B'));
  assert.ok(one.body.includes('- Board C'), 'an erroring watch-only seed is still flagged');
  assert.ok(one.body.includes('1 watch-only seed with no provider not listed.'));
});

// W-029: audit-portals 1.39.0 ignores a portals.yml entry's max_response_mb, so a board over 10 MB always audits as an
// error even though scan.mjs reads it. Only that exact error is expected on a capped seed; any other status still flags.
test('W-029 auditIssues counts the response-cap error on a seed with max_response_mb instead of listing it', () => {
  const cap = 'HTTP body exceeded maxBytes of 10485760 (content-length 14357398)';
  const current = {
    'preset-one': {
      rows: [
        { name: 'Board A', verdict: 'error', count: null, detail: cap },
        { name: 'Board B', verdict: 'error', count: null, detail: cap },
        { name: 'Board C', verdict: 'error', count: null, detail: 'HTTP 404' },
        { name: 'Board D', verdict: 'ok', count: 30, detail: '30 postings' },
      ],
    },
    'preset-two': { rows: [{ name: 'Board E', verdict: 'error', count: null, detail: `greenhouse: ${cap}` }] },
  };
  const capped = { 'preset-one': ['Board A', 'Board C'], 'preset-two': ['Board E'] };
  const issues = auditIssues({ current, capped });
  assert.equal(issues.length, 1, 'preset-two has only an expected cap error');
  const [one] = issues;
  assert.equal(one.title, auditTitle('preset-one', 2));
  assert.ok(!one.body.includes('- Board A'));
  assert.ok(one.body.includes('- Board B'), 'a seed without max_response_mb is still flagged for the cap error');
  assert.ok(one.body.includes('- Board C'), 'a capped seed with another error is still flagged');
  assert.ok(one.body.includes('1 board over the 10 MB audit limit not listed: scan.mjs reads it with max_response_mb.'));
});
