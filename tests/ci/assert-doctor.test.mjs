// Assumed CLI: node scripts/ci/assert-doctor.mjs <doctor.json>. Exit 0 or 1; on 1 every missing and unpersonalized
// entry name appears in stdout or stderr. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

function run(doctor) {
  const dir = mkdtempSync(join(tmpdir(), 'assert-doctor-'));
  try {
    const f = join(dir, 'doctor.json');
    writeFileSync(f, JSON.stringify(doctor));
    const out = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'ci', 'assert-doctor.mjs'), f], { cwd: dir, encoding: 'utf8', timeout: 30000 });
    return { code: out.status, text: `${out.stdout ?? ''}${out.stderr ?? ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('M-009-S1 passes when onboardingNeeded is false and unpersonalized is an empty array', () => {
  const r = run({ onboardingNeeded: false, unpersonalized: [] });
  assert.equal(r.code, 0, r.text);
});

test('M-009-S1 passes when unpersonalized is false', () => {
  const r = run({ onboardingNeeded: false, unpersonalized: false });
  assert.equal(r.code, 0, r.text);
});

test('M-009-S2 exits 1 and lists unpersonalized entries', () => {
  const r = run({ onboardingNeeded: false, unpersonalized: ['config/example-profile.yml', 'cv.md'] });
  assert.equal(r.code, 1);
  assert.match(r.text, /config\/example-profile\.yml/);
  assert.match(r.text, /cv\.md/);
});

test('M-009-S2 exits 1 when onboardingNeeded is true and lists the missing entries', () => {
  const r = run({ onboardingNeeded: true, missing: ['profile.yml'], unpersonalized: [] });
  assert.equal(r.code, 1);
  assert.match(r.text, /profile\.yml/);
});
