import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT, PARITY_CLI, makeSource, makeStudentConfig, makeStudentConfigText, snapshot, tmp, cleanupTmp } from './_source.mjs';

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

const TRACKS = 'tracks:\n  - kind: internship\n    graduation: 2029-05\n';

function exitsTwoBeforeScratch(configText, extraCheck) {
  const source = makeSource();
  const before = snapshot(source);
  const scratch = join(tmp(), 'work');
  const r = parity(['--source', source, '--scratch', scratch, '--student-config', makeStudentConfigText(configText)]);
  assert.equal(r.code, 2, r.stderr);
  assert.ok(!existsSync(scratch));
  assert.deepEqual(snapshot(source), before);
  if (extraCheck) extraCheck(r);
}

// M-004-S12
test('M-004-S12 a config with presets [] exits 2 and the scratch path does not exist', () => {
  exitsTwoBeforeScratch(`onboarding:\n  complete: true\npresets: []\n${TRACKS}`);
});

// M-004-S12
test('M-004-S12 a config with tracks [] exits 2 and the scratch path does not exist', () => {
  exitsTwoBeforeScratch('onboarding:\n  complete: true\npresets: [software-cs]\ntracks: []\n');
});

// M-004-S13
test('M-004-S13 a config with an unknown key exits 2 and the scratch path does not exist', () => {
  exitsTwoBeforeScratch(`onboarding:\n  complete: true\npresets: [software-cs]\n${TRACKS}bogus_setting: 1\n`);
});

// M-004-S20
test('M-004-S20 malformed YAML exits 2 naming the YAML problem and never echoing the marker', () => {
  exitsTwoBeforeScratch('presets: [SYNTH_MARKER_VALUE', (r) => {
    assert.ok(r.stderr.includes('--student-config is not valid YAML'), r.stderr);
    assert.ok(!r.stderr.includes('SYNTH_MARKER_VALUE'), r.stderr);
  });
});
