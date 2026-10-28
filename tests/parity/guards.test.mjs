import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT, PARITY_CLI, makeSource, makeStudentConfig, snapshot, tmp, cleanupTmp } from './_source.mjs';

after(cleanupTmp);

function parity(args) {
  const r = spawnSync(process.execPath, [PARITY_CLI, ...args], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 60000 });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// M-007-S4
test('M-007-S4 scratch inside the pack repo exits 2 and creates nothing', () => {
  const source = makeSource();
  const before = snapshot(source);
  const scratch = join(PACK_ROOT, 'scratch-parity-guard-test');
  const r = parity(['--source', source, '--scratch', scratch, '--student-config', makeStudentConfig()]);
  assert.equal(r.code, 2);
  assert.ok(!existsSync(scratch));
  assert.deepEqual(snapshot(source), before);
});

// M-007-S4
test('M-007-S4 scratch inside the source exits 2 and creates nothing', () => {
  const source = makeSource();
  const before = snapshot(source);
  const scratch = join(source, 'inner-scratch');
  const r = parity(['--source', source, '--scratch', scratch, '--student-config', makeStudentConfig()]);
  assert.equal(r.code, 2);
  assert.ok(!existsSync(scratch));
  assert.deepEqual(snapshot(source), before);
});

// M-007-S4
test('M-007-S4 scratch equal to the source exits 2', () => {
  const source = makeSource();
  const r = parity(['--source', source, '--scratch', source, '--student-config', makeStudentConfig()]);
  assert.equal(r.code, 2);
});

// M-007-S4
test('M-007-S4 each missing required flag exits 2 before copying', () => {
  const source = makeSource();
  const scratch = join(tmp(), 'work');
  const config = makeStudentConfig();
  const full = { '--source': source, '--scratch': scratch, '--student-config': config };
  for (const omit of Object.keys(full)) {
    const args = Object.entries(full).filter(([k]) => k !== omit).flat();
    const r = parity(args);
    assert.equal(r.code, 2, `omitting ${omit}`);
    assert.ok(!existsSync(scratch), `omitting ${omit} created scratch`);
  }
});

// M-007-S8
test('M-007-S8 --keep exits 2 before copying', () => {
  const source = makeSource();
  const scratch = join(tmp(), 'work');
  const r = parity(['--source', source, '--scratch', scratch, '--student-config', makeStudentConfig(), '--keep']);
  assert.equal(r.code, 2);
  assert.ok(!existsSync(scratch));
});

// M-007-S8
test('M-007-S8 any unknown flag exits 2 before copying', () => {
  const source = makeSource();
  const scratch = join(tmp(), 'work');
  const r = parity(['--source', source, '--scratch', scratch, '--student-config', makeStudentConfig(), '--bogus']);
  assert.equal(r.code, 2);
  assert.ok(!existsSync(scratch));
});

// M-007-S8
test('M-007-S8 an existing non-empty scratch dir exits 2 and is left untouched', () => {
  const source = makeSource();
  const scratch = tmp('parity-existing-');
  writeFileSync(join(scratch, 'marker.txt'), 'keep me\n');
  const before = snapshot(scratch);
  const r = parity(['--source', source, '--scratch', scratch, '--student-config', makeStudentConfig()]);
  assert.equal(r.code, 2);
  assert.deepEqual(snapshot(scratch), before);
  assert.deepEqual(readdirSync(scratch), ['marker.txt']);
});

// M-007-S8
test('M-007-S8 refusal leaves a pre-existing empty scratch dir without a baseline copy', () => {
  const source = makeSource();
  const scratch = join(tmp(), 'work');
  mkdirSync(scratch);
  writeFileSync(join(scratch, 'x'), '1');
  const r = parity(['--source', source, '--scratch', scratch, '--student-config', makeStudentConfig(), '--keep']);
  assert.equal(r.code, 2);
  assert.ok(!existsSync(join(scratch, 'baseline')));
});
