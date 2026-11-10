// Assumed (M-002): scripts/schedule.mjs exports
//   verifySchedule({ platform, root, time, label, readJob, runCheck }) -> { code, lines }. readJob() returns the installed job
//     as { args: [node, <scheduled.mjs path>, ...] } or null when none is installed; runCheck() returns { code, lines } for
//     `scheduled.mjs --check`, whose lines are echoed. Success prints 'schedule verified: <label> at HH:MM' and code 0;
//     any failure prints 'schedule check failed: <step>: <fix>' and code 1.
//   foreignOwner({ args, root, platform }) -> the other folder's root when args start another folder's
//     student/scripts/scheduled.mjs, else null.
//   `schedule.mjs install` reads the installed job first; another folder's job without --replace exits 1 with
//     'schedule owned by <other root>; run schedule.mjs remove there or pass --replace' and leaves the job unchanged.
// Nothing here loads a real schedule: a fake launchctl on PATH and a temp HOME stand in (the install tests run on macOS only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { buildPlist, foreignOwner, verifySchedule } from '../../scripts/schedule.mjs';
import { launchAgentPath } from '../../lib/schedule-check.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const NODE = '/opt/example node/bin/node';
const ROOT = '/Users/sample student/career-ops';
const OTHER = '/Users/sample student/other-ops';
const LABEL = 'com.career-ops.student.daily';
const scriptOf = (root) => join(root, 'student', 'scripts', 'scheduled.mjs');
const jobFor = (root) => ({ args: [NODE, scriptOf(root), '--agent', 'claude', '--agent-path', '/opt/sample/bin/claude'] });
const OK_LINES = ['check daily run: ok', 'check inbox pass: ok', 'check triage: ok'];
const textOf = (res) => (res.lines ?? []).join('\n');

const verify = (over = {}) => verifySchedule({
  platform: 'darwin', root: ROOT, time: '06:00', label: LABEL,
  readJob: () => jobFor(ROOT),
  runCheck: () => ({ code: 0, lines: OK_LINES }),
  ...over,
});

// M-002-S13-cdel
test('M-002-S13-cdel verify prints one ok line per enabled step and the verified line and exits 0', async () => {
  const res = await verify();
  assert.equal(res.code, 0, textOf(res));
  const text = textOf(res);
  assert.match(text, /daily run: ok/);
  assert.match(text, /inbox pass: ok/);
  assert.match(text, /triage: ok/);
  assert.match(text, /schedule verified: com\.career-ops\.student\.daily at 06:00/);
  assert.ok(!/failed/.test(text));
});

test('extra check: a step that is off prints its off line and still verifies', async () => {
  const res = await verify({ runCheck: () => ({ code: 0, lines: ['check daily run: ok', 'check inbox pass: off', 'check triage: ok'] }) });
  assert.equal(res.code, 0, textOf(res));
  assert.match(textOf(res), /inbox pass: off/);
});

// M-002-S14-cdel
test('M-002-S14-cdel verify exits 1 with a failed line when no job is installed', async () => {
  const res = await verify({ readJob: () => null });
  assert.equal(res.code, 1);
  assert.match(textOf(res), /schedule check failed: .+/);
  assert.ok(!/schedule verified/.test(textOf(res)));
});

test('extra check: verify exits 1 when the installed job starts another folder', async () => {
  const res = await verify({ readJob: () => jobFor(OTHER) });
  assert.equal(res.code, 1);
  assert.match(textOf(res), /schedule check failed: .+/);
  assert.ok(!/schedule verified/.test(textOf(res)));
});

test('extra check: verify exits 1 naming the inbox pass step and its fix when that check fails', async () => {
  const res = await verify({ runCheck: () => ({ code: 1, lines: ['check daily run: ok', 'check inbox pass: failed (no Gmail tools; connect Gmail (interview Part A))', 'check triage: ok'] }) });
  assert.equal(res.code, 1);
  const failed = textOf(res).split('\n').find((l) => /^schedule check failed:/.test(l));
  assert.ok(failed, textOf(res));
  assert.match(failed, /inbox pass/i);
  assert.ok(!/schedule verified/.test(textOf(res)));
});

// M-002-S22-cdel
test('M-002-S22-cdel foreignOwner names the other folder and is null for this folder', () => {
  for (const platform of ['darwin', 'win32']) {
    const other = foreignOwner({ args: [NODE, scriptOf(OTHER)], root: ROOT, platform });
    assert.ok(other && String(other).includes('other-ops'), `${platform}: ${other}`);
    assert.equal(foreignOwner({ args: [NODE, scriptOf(ROOT)], root: ROOT, platform }), null, platform);
  }
});

// A temp HOME with a LaunchAgents plist for the label, a fake launchctl on PATH that logs its calls, and a career-ops root.
function macSetup(ownerRoot) {
  const tmp = mkdtempSync(join(tmpdir(), 'sched-verify-'));
  const home = join(tmp, 'home');
  const bin = join(tmp, 'bin');
  const root = join(tmp, 'career-ops');
  const log = join(tmp, 'launchctl.log');
  for (const d of [home, bin, join(root, 'config'), join(home, 'Library', 'LaunchAgents')]) mkdirSync(d, { recursive: true });
  // A real install takes only a root whose student/ folder is this pack, so the scratch root links student/ to it.
  symlinkSync(PACK_ROOT, join(root, 'student'), 'dir');
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\nautomation: scheduled-discovery\n');
  writeFileSync(join(bin, 'launchctl'), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\nexit 0\n`);
  chmodSync(join(bin, 'launchctl'), 0o755);
  const plist = launchAgentPath(home);
  if (ownerRoot) writeFileSync(plist, buildPlist({ nodePath: NODE, root: ownerRoot, time: '06:00' }));
  const install = (...flags) => spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'schedule.mjs'), 'install', '--time', '07:30', '--root', root, ...flags], {
    cwd: PACK_ROOT, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: `${bin}${delimiter}${process.env.PATH}` },
  });
  return { tmp, root, plist, log, install, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}
const mac = {};

test('extra check: install exits 1 naming the other folder and leaves the job unchanged when another folder owns it', mac, () => {
  const s = macSetup(OTHER);
  try {
    const before = readFileSync(s.plist, 'utf8');
    const out = s.install();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stdout + out.stderr, /schedule owned by .*other-ops; run schedule\.mjs remove there or pass --replace/);
    assert.equal(readFileSync(s.plist, 'utf8'), before);
    assert.equal(existsSync(s.log), false, 'launchctl was never called');
  } finally {
    s.cleanup();
  }
});

test('extra check: install with --replace takes over the job for this folder', mac, () => {
  const s = macSetup(OTHER);
  try {
    const out = s.install('--replace');
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const after = readFileSync(s.plist, 'utf8');
    assert.ok(after.includes(join(s.root, 'student', 'scripts', 'scheduled.mjs')) || after.includes(s.root), after);
    assert.ok(!after.includes('other-ops'));
  } finally {
    s.cleanup();
  }
});

test('extra check: install with no job installed proceeds as before', mac, () => {
  const s = macSetup(null);
  try {
    const out = s.install();
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.ok(existsSync(s.plist));
  } finally {
    s.cleanup();
  }
});
