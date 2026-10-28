// Assumed: lib/integrity.mjs exports async-or-sync verifyAndRestore({ packRoot, runner }) -> { ok, restored, message },
// with message a single line when something was restored. runner is optional; tests use real git in a scratch repo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyAndRestore } from '../../lib/integrity.mjs';
import { git, put } from './_pack-repo.mjs';

const sha = (t) => createHash('sha256').update(t).digest('hex');
const BUDGET = 'export const CEILINGS = Object.freeze({ connect_per_day: { value: 20 } });\n';
const compatFor = (budget) => `${JSON.stringify({ upstream: { min: '1.38.0', max: '1.38.0' }, budgetSha256: sha(budget) }, null, 2)}\n`;

function scratch({ commitCompat = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pack-integrity-'));
  git(root, 'init', '-q');
  put(root, 'scripts/budget.mjs', BUDGET);
  put(root, 'compat.json', compatFor(BUDGET));
  put(root, 'README.md', 'Readme.\n');
  git(root, 'add', commitCompat ? '-A' : 'scripts/budget.mjs');
  git(root, 'commit', '-q', '-m', 'base');
  return root;
}
async function withRepo(opts, fn) {
  const root = scratch(opts);
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const read = (root, rel) => readFileSync(join(root, rel), 'utf8');

// M-005-S11
test('M-005-S11 a clean tree is left untouched', () =>
  withRepo({}, async (root) => {
    const res = await verifyAndRestore({ packRoot: root });
    assert.equal(res.ok, true);
    assert.equal(res.restored, false);
    assert.equal(read(root, 'scripts/budget.mjs'), BUDGET);
  }));

// M-005-S11
test('M-005-S11 an edited budget.mjs is restored from HEAD with a one-line message', () =>
  withRepo({}, async (root) => {
    appendFileSync(join(root, 'scripts/budget.mjs'), '// tampered\n');
    const res = await verifyAndRestore({ packRoot: root });
    assert.equal(res.ok, true);
    assert.equal(res.restored, true);
    assert.equal(read(root, 'scripts/budget.mjs'), BUDGET);
    assert.equal(typeof res.message, 'string');
    assert.ok(res.message.length > 0 && !res.message.includes('\n'));
  }));

// M-005-S12
test('M-005-S12 a consistent edit of budget.mjs and compat.json is still restored from HEAD', () =>
  withRepo({}, async (root) => {
    const raised = BUDGET.replace('20', '999');
    writeFileSync(join(root, 'scripts/budget.mjs'), raised);
    writeFileSync(join(root, 'compat.json'), compatFor(raised));
    const res = await verifyAndRestore({ packRoot: root });
    assert.equal(res.restored, true);
    assert.equal(read(root, 'scripts/budget.mjs'), BUDGET);
    assert.equal(read(root, 'compat.json'), compatFor(BUDGET));
  }));

// M-005-S11
test('M-005-S11 a compat.json hash that disagrees with budget.mjs triggers a restore', () =>
  withRepo({}, async (root) => {
    const c = JSON.parse(read(root, 'compat.json'));
    c.budgetSha256 = sha('something else');
    writeFileSync(join(root, 'compat.json'), `${JSON.stringify(c, null, 2)}\n`);
    const res = await verifyAndRestore({ packRoot: root });
    assert.equal(res.restored, true);
    assert.equal(read(root, 'compat.json'), compatFor(BUDGET));
  }));

// M-005-S11
test('M-005-S11 a restore that cannot complete is reported as not ok', () =>
  withRepo({ commitCompat: false }, async (root) => {
    put(root, 'compat.json', compatFor(BUDGET));
    appendFileSync(join(root, 'scripts/budget.mjs'), '// tampered\n');
    const res = await verifyAndRestore({ packRoot: root });
    assert.equal(res.ok, false);
    assert.equal(res.restored, false);
  }));
