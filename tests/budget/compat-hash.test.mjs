import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PACK_ROOT } from '../helpers/budget-harness.mjs';

const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

// A scratch copy of the pack (without .git and node_modules) so edits never touch the real tree.
function scratchPack() {
  const dir = mkdtempSync(join(tmpdir(), 'pack-compat-'));
  cpSync(PACK_ROOT, dir, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules)([\\/]|$)/.test(src.slice(PACK_ROOT.length)) });
  symlinkSync(join(PACK_ROOT, 'node_modules'), join(dir, 'node_modules'));
  return dir;
}
const compat = (dir, ...args) => spawnSync(process.execPath, [join(dir, 'scripts', 'compat-hash.mjs'), ...args], { cwd: dir, encoding: 'utf8' });

// M-002-S21
test('M-002-S21 shipped compat.json carries the contract and the budget.mjs hash', () => {
  const c = JSON.parse(readFileSync(join(PACK_ROOT, 'compat.json'), 'utf8'));
  assert.deepEqual(c.upstream, { min: '1.38.0', max: '1.38.0', tag_prefix: 'career-ops-v' });
  assert.deepEqual(c.pipelineSections, ['Pending', 'Flagged', 'Skipped', 'Processed']);
  assert.deepEqual(c.lockProtocol, { suffix: '.lock', owner: 'owner.json', recover: '.lock.recover' });
  assert.deepEqual([...c.cliContracts['audit-portals']].sort(), ['--baseline', '--file', '--json', '--summary']);
  assert.deepEqual(
    { ...c.cliContracts, 'audit-portals': [] },
    {
      'check-liveness': ['--no-fallback', '--file', '--no-record'],
      'set-status': ['--note', '--dry-run'],
      'update-system': ['check', 'apply --confirm', 'dismiss --version'],
      doctor: ['--json'],
      'audit-portals': [],
      plugins: ['run', 'trust', 'enable'],
    },
  );
  assert.equal(c.budgetSha256, sha(join(PACK_ROOT, 'scripts', 'budget.mjs')));
});

test('M-002-S21 compat-hash --check passes on the shipped tree', () => {
  const r = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'compat-hash.mjs'), '--check'], { cwd: PACK_ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('M-002-S21 compat-hash --check exits 1 after a one-byte change to budget.mjs', () => {
  const dir = scratchPack();
  try {
    assert.equal(compat(dir, '--check').status, 0);
    appendFileSync(join(dir, 'scripts', 'budget.mjs'), ' ');
    assert.equal(compat(dir, '--check').status, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M-002-S21 compat-hash --write rewrites only budgetSha256, keeping key order and 2-space formatting', () => {
  const dir = scratchPack();
  try {
    const file = join(dir, 'compat.json');
    const before = readFileSync(file, 'utf8');
    appendFileSync(join(dir, 'scripts', 'budget.mjs'), '\n');
    assert.equal(compat(dir, '--write').status, 0);
    const after = readFileSync(file, 'utf8');
    const oldHash = JSON.parse(before).budgetSha256;
    const newHash = sha(join(dir, 'scripts', 'budget.mjs'));
    assert.notEqual(oldHash, newHash);
    assert.equal(after, before.replace(oldHash, newHash));
    assert.equal(JSON.parse(after).budgetSha256, newHash);
    assert.equal(compat(dir, '--check').status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
