// Assumed CLI: node scripts/ci/bump-compat.mjs <version> --file <compat.json>. Exit 0 on bump, 1 on refusal.
// The file is rewritten in place; only upstream.max changes. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const COMPAT = {
  upstream: { min: '1.38.0', max: '1.38.0', tag_prefix: 'career-ops-v' },
  budgetSha256: 'a'.repeat(64),
  pipelineSections: ['Pending'],
};

function run(version) {
  const dir = mkdtempSync(join(tmpdir(), 'bump-compat-'));
  try {
    const f = join(dir, 'compat.json');
    const before = `${JSON.stringify(COMPAT, null, 2)}\n`;
    writeFileSync(f, before);
    const out = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'ci', 'bump-compat.mjs'), version, '--file', f], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    return { code: out.status, before, after: readFileSync(f, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('M-009-S3 raises upstream.max and leaves budgetSha256 unchanged', () => {
  const r = run('1.40.2');
  assert.equal(r.code, 0);
  const after = JSON.parse(r.after);
  assert.equal(after.upstream.max, '1.40.2');
  assert.equal(after.upstream.min, '1.38.0');
  assert.equal(after.budgetSha256, COMPAT.budgetSha256);
  assert.deepEqual(after.pipelineSections, COMPAT.pipelineSections);
});

test('M-009-S3 compares versions numerically, not as strings', () => {
  const r = run('1.100.0');
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.after).upstream.max, '1.100.0');
});

test('M-009-S4 exits 1 without writing when the version equals upstream.max', () => {
  const r = run('1.38.0');
  assert.equal(r.code, 1);
  assert.equal(r.after, r.before);
});

test('M-009-S4 exits 1 without writing when the version is below upstream.max', () => {
  const r = run('1.9.0');
  assert.equal(r.code, 1);
  assert.equal(r.after, r.before);
});
