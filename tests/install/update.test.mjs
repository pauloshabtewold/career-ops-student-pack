// Assumed: update.mjs is a CLI at the pack root, run as `node student/update.mjs [--safety-only] [--offline] [--dry-run] --root <checkout>`;
// the pack is <root>/student. Output goes to stdout, one line per action. Upstream is reached only through the
// stub CLIs in <root>; `update-system.mjs check` prints one JSON line {status, local, remote}.
// Exit 0 normally, 1 when student/ has local commits that block the fast-forward.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { makePack, checkJson, put } from './_pack-repo.mjs';

async function withPack(fn) {
  const p = makePack();
  try {
    await fn(p);
  } finally {
    p.cleanup();
  }
}
const upstreamCalls = (p, cli) => p.upstreamCalls().filter((c) => c.cli === cli);
const sysCalls = (p) => upstreamCalls(p, 'update-system.mjs');
const hasArg = (calls, word) => calls.some((c) => c.argv.includes(word));
const LOCAL_COMMITS = 'student/ has local commits; pack update skipped (fork-and-edit, see README)';

// M-005-S4
test('M-005-S4 an in-range release is applied with apply --confirm', () =>
  withPack((p) => {
    p.up.setOutput('update-system', checkJson('update-available', { remote: '1.38.0' }));
    const r = p.run('update.mjs');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const calls = sysCalls(p);
    assert.deepEqual(calls[0].argv, ['check']);
    assert.ok(calls.some((c) => c.argv[0] === 'apply' && c.argv.includes('--confirm')), JSON.stringify(calls));
    assert.ok(!hasArg(calls, '--force'));
  }));

// M-005-S5
test('M-005-S5 an out-of-range release is dismissed, never applied, never forced', () =>
  withPack((p) => {
    p.up.setOutput('update-system', checkJson('update-available', { remote: '1.39.0' }));
    const r = p.run('update.mjs');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const calls = sysCalls(p);
    assert.ok(calls.some((c) => c.argv[0] === 'dismiss' && c.argv[1] === '--version' && c.argv[2] === '1.39.0'), JSON.stringify(calls));
    assert.ok(!hasArg(calls, 'apply'), 'apply was called');
    for (const c of p.upstreamCalls()) assert.ok(!c.argv.includes('--force'), `--force passed to ${c.cli}`);
  }));

// M-005-S5
test('M-005-S5 a release below the minimum is also dismissed and not applied', () =>
  withPack((p) => {
    p.up.setOutput('update-system', checkJson('update-available', { remote: '1.37.9' }));
    const r = p.run('update.mjs');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const calls = sysCalls(p);
    assert.ok(calls.some((c) => c.argv[0] === 'dismiss' && c.argv[2] === '1.37.9'), JSON.stringify(calls));
    assert.ok(!hasArg(calls, 'apply'));
  }));

// M-005-S6
for (const status of ['offline', 'up-to-date', 'dismissed']) {
  test(`M-005-S6 check reporting ${status} makes no apply or dismiss call`, () =>
    withPack((p) => {
      p.up.setOutput('update-system', checkJson(status, status === 'offline' ? {} : { remote: '1.39.0' }));
      const r = p.run('update.mjs');
      assert.equal(r.code, 0, r.stdout + r.stderr);
      const calls = sysCalls(p);
      assert.ok(calls.length >= 1 && calls[0].argv[0] === 'check', 'check was not called');
      assert.ok(!hasArg(calls, 'apply') && !hasArg(calls, 'dismiss'), JSON.stringify(calls));
    }));
}

// M-005-S7
test('M-005-S7 a safety tag that passes the gate is fast-forwarded to with one line, before the release step', () =>
  withPack((p) => {
    p.up.setOutput('update-system', checkJson('up-to-date', { remote: '1.38.0' }));
    const safe = p.publish((o) => put(o, 'AGENTS.student.md', 'Pack rules, tightened.\n'), 'safety release', ['safety-1']);
    const rel = p.publish((o) => put(o, 'docs/note.md', 'Release note.\n'), 'release', ['v0.2.0']);
    const r = p.run('update.mjs', ['--safety-only']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(p.head(), safe, '--safety-only must stop at the safety tag, not the release tag');
    assert.equal(r.lines.filter((l) => l.includes('safety-1')).length, 1, r.lines.join('\n'));
    const full = p.run('update.mjs');
    assert.equal(full.code, 0, full.stdout + full.stderr);
    assert.equal(p.head(), rel);
  }));

// M-005-S7
test('M-005-S7 the safety-only run makes no upstream call', () =>
  withPack((p) => {
    p.up.setOutput('update-system', checkJson('up-to-date', { remote: '1.38.0' }));
    p.publish((o) => put(o, 'AGENTS.student.md', 'Pack rules, tightened.\n'), 'safety release', ['safety-1']);
    const r = p.run('update.mjs', ['--safety-only']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(sysCalls(p), []);
  }));

// M-005-S8
test('M-005-S8 a safety tag that fails the gate is refused, HEAD stays, one line names the tag', () =>
  withPack((p) => {
    p.up.setOutput('update-system', checkJson('up-to-date', { remote: '1.38.0' }));
    const before = p.head();
    p.publish((o) => put(o, 'lib/extra-behavior.mjs', 'export const x = 1;\n'), 'unsafe release', ['safety-bad']);
    const r = p.run('update.mjs', ['--safety-only']);
    assert.equal(p.head(), before);
    assert.equal(r.lines.filter((l) => l.includes('safety-bad')).length, 1, r.lines.join('\n'));
    assert.equal(existsSync(p.file('lib/extra-behavior.mjs')), false);
  }));

// M-005-S9
test('M-005-S9 an enabled plugin with an unchanged consent surface is re-copied and trusted', () =>
  withPack((p) => {
    p.up.setOutput('update-system', checkJson('up-to-date', { remote: '1.38.0' }));
    p.seedPlugin('github-lists', (m) => ({ ...m, version: '0.9.0' }));
    const r = p.run('update.mjs');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const copied = JSON.parse(readFileSync(join(p.root, 'plugins.local', 'github-lists', 'manifest.json'), 'utf8'));
    const shipped = JSON.parse(readFileSync(p.file('plugins/github-lists/manifest.json'), 'utf8'));
    assert.equal(copied.version, shipped.version);
    const trust = upstreamCalls(p, 'plugins.mjs').filter((c) => c.argv[0] === 'trust');
    assert.deepEqual(trust.map((c) => c.argv), [['trust', 'github-lists']]);
  }));

// M-005-S10
test('M-005-S10 a plugin whose allowedHosts changed is not trusted and a re-enable line is printed', () =>
  withPack((p) => {
    p.up.setOutput('update-system', checkJson('up-to-date', { remote: '1.38.0' }));
    p.seedPlugin('github-lists', (m) => ({ ...m, allowedHosts: m.allowedHosts.filter((h) => h !== 'jobright.ai') }));
    const r = p.run('update.mjs');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(upstreamCalls(p, 'plugins.mjs').filter((c) => c.argv[0] === 'trust'), []);
    const notice = r.lines.filter((l) => l.includes('re-enable github-lists'));
    assert.equal(notice.length, 1, r.lines.join('\n'));
    assert.match(notice[0], /permissions changed/);
  }));

const original = (p, rel) => readFileSync(p.file(rel), 'utf8');

// M-005-S11
test('M-005-S11 update restores an edited budget.mjs from HEAD and prints one line', () =>
  withPack((p) => {
    p.up.setOutput('update-system', checkJson('up-to-date', { remote: '1.38.0' }));
    const before = original(p, 'scripts/budget.mjs');
    appendFileSync(p.file('scripts/budget.mjs'), '\n// edited locally\n');
    const r = p.run('update.mjs');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(original(p, 'scripts/budget.mjs'), before);
    assert.equal(r.lines.filter((l) => /budget\.mjs/.test(l) && /restor/i.test(l)).length, 1, r.lines.join('\n'));
  }));

// M-005-S12
test('M-005-S12 update restores budget.mjs and compat.json after a hash-consistent edit of both', () =>
  withPack((p) => {
    p.up.setOutput('update-system', checkJson('up-to-date', { remote: '1.38.0' }));
    const [budget, compat] = [original(p, 'scripts/budget.mjs'), original(p, 'compat.json')];
    const raised = budget.replace('connect_per_day: down(20,', 'connect_per_day: down(999,');
    assert.notEqual(raised, budget);
    writeFileSync(p.file('scripts/budget.mjs'), raised);
    const c = JSON.parse(compat);
    c.budgetSha256 = createHash('sha256').update(raised).digest('hex');
    writeFileSync(p.file('compat.json'), `${JSON.stringify(c, null, 2)}\n`);
    const r = p.run('update.mjs');
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(original(p, 'scripts/budget.mjs'), budget);
    assert.equal(original(p, 'compat.json'), compat);
    assert.equal(p.git('status', '--porcelain', '--', 'scripts/budget.mjs', 'compat.json'), '');
  }));

// M-005-S16
test('M-005-S16 local commits in student/ block the fast-forward: one line, HEAD unchanged, exit 1', () =>
  withPack((p) => {
    p.up.setOutput('update-system', checkJson('up-to-date', { remote: '1.38.0' }));
    put(p.pack, 'my-notes.txt', 'local work\n');
    p.git('add', 'my-notes.txt');
    p.git('commit', '-q', '-m', 'local edit');
    const before = p.head();
    p.publish((o) => put(o, 'docs/note.md', 'Release note.\n'), 'release', ['v0.2.0']);
    const r = p.run('update.mjs');
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.equal(p.head(), before);
    assert.equal(r.lines.filter((l) => l === LOCAL_COMMITS).length, 1, r.lines.join('\n'));
    assert.equal(p.git('rev-list', '--merges', 'HEAD'), '');
    assert.equal(p.git('stash', 'list'), '');
    assert.ok(sysCalls(p).some((c) => c.argv[0] === 'check'), 'upstream step must still run');
  }));
