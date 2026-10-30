// Assumed: compat.json cliContracts lists every flag the pack passes to an upstream script. The daily run is the
// caller (directly and through lib/ingest.mjs), so a monthly Sunday run against recording stubs must pass only
// flags that are in the matching contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const read = (rel) => readFileSync(join(PACK_ROOT, rel), 'utf8');
const compat = () => JSON.parse(read('compat.json'));

// M-002-S18
test('M-002-S18 the audit-portals contract lists --summary and budgetSha256 equals the SHA-256 of scripts/budget.mjs', () => {
  const c = compat();
  assert.ok(c.cliContracts['audit-portals'].includes('--summary'));
  assert.equal(c.budgetSha256, createHash('sha256').update(readFileSync(join(PACK_ROOT, 'scripts', 'budget.mjs'))).digest('hex'));
});

// M-002-S18
test('M-002-S18 every flag a monthly Sunday daily run passes to an upstream script is in that script contract', () => {
  const up = createFakeUpstream();
  try {
    writeFileSync(join(up.root, 'config', 'student.yml'), 'timezone: America/Chicago\nautomation: scheduled-discovery\npresets: []\n');
    writeFileSync(join(up.root, 'data', 'applications.md'), '# Applications\n');
    const r = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'daily.mjs'), '--root', up.root, '--data-dir', join(up.root, 'data'), '--today', '2026-11-01'], {
      cwd: PACK_ROOT,
      encoding: 'utf8',
      timeout: 120000,
    });
    assert.equal(r.status, 0, r.stderr);
    const contracts = compat().cliContracts;
    const calls = up.calls();
    assert.ok(calls.some((x) => x.cli === 'audit-portals.mjs'), 'the monthly run called audit-portals');
    for (const call of calls) {
      const allowed = new Set((contracts[call.cli.replace(/\.mjs$/, '')] ?? []).flatMap((entry) => entry.split(/\s+/)));
      for (const flag of call.argv.filter((a) => a.startsWith('--'))) assert.ok(allowed.has(flag), `${call.cli} is passed ${flag} outside its contract`);
    }
  } finally {
    rmSync(up.root, { recursive: true, force: true });
  }
});

// M-002-S19
test('M-002-S19 package.json lists js-yaml 5.5.0 under dependencies and not under devDependencies', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies?.['js-yaml'], '5.5.0');
  assert.equal(pkg.devDependencies?.['js-yaml'], undefined);
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.packages[''].dependencies?.['js-yaml'], '5.5.0');
  assert.equal(lock.packages[''].devDependencies?.['js-yaml'], undefined);
});
