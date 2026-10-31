// W-023 review fixes in scripts/schedule.mjs and the suggested allowlist: remove works without a readable config
// (A2-3), a real install refuses a root that is not this pack's own parent (A6-2). Everything runs with a temp HOME and
// fake launchctl and powershell binaries that only write a marker, so nothing real is scheduled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { assertOwnRoot } from '../../scripts/schedule.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

function sandbox(config) {
  const tmp = mkdtempSync(join(tmpdir(), 'sched-w023-'));
  const bin = join(tmp, 'bin');
  const home = join(tmp, 'home');
  const marker = join(tmp, 'spawned.txt');
  mkdirSync(bin);
  mkdirSync(home);
  mkdirSync(join(tmp, 'config'));
  if (config !== undefined) writeFileSync(join(tmp, 'config', 'student.yml'), config);
  for (const name of ['launchctl', 'powershell', 'powershell.exe', 'pwsh']) {
    writeFileSync(join(bin, name), `#!/bin/sh\necho ${name} >> "${marker}"\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const run = (...argv) => spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'schedule.mjs'), ...argv], {
    cwd: PACK_ROOT,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: `${bin}${delimiter}${process.env.PATH}` },
  });
  return { tmp, home, marker, run, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

test('W-023-A2-3 remove --dry-run succeeds when config/student.yml is unparsable or invalid', () => {
  for (const config of ['agent: [unclosed\n', 'agent: gemini\n']) {
    const s = sandbox(config);
    try {
      const out = s.run('remove', '--dry-run', '--root', s.tmp);
      assert.equal(out.status, 0, `${config}${out.stderr}`);
      assert.match(out.stdout, /dry run: would run launchctl bootout|Unregister-ScheduledTask/);
    } finally {
      s.cleanup();
    }
  }
});

test('W-023-A2-3 install still reports an invalid config instead of scheduling', () => {
  const s = sandbox('agent: gemini\n');
  try {
    const out = s.run('install', '--dry-run', '--root', s.tmp);
    assert.notEqual(out.status, 0);
    assert.match(out.stdout + out.stderr, /agent/);
  } finally {
    s.cleanup();
  }
});

test('W-023-A6-2 a real install with a --root that is not this pack\'s parent writes nothing and starts nothing', () => {
  const s = sandbox('timezone: America/Chicago\n');
  try {
    const out = s.run('install', '--root', s.tmp);
    assert.notEqual(out.status, 0);
    assert.match(out.stdout + out.stderr, /--root/);
    assert.equal(existsSync(join(s.home, 'Library', 'LaunchAgents')), false);
    assert.equal(existsSync(s.marker), false, 'no launchctl or powershell process was started');
  } finally {
    s.cleanup();
  }
});

test('W-023-A6-2 assertOwnRoot accepts the root whose student/ folder is this pack, even through a symlink, and refuses others', { skip: process.platform === 'win32' && 'symlinks need elevation on Windows' }, () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sched-root-'));
  try {
    mkdirSync(join(tmp, 'ok'));
    symlinkSync(PACK_ROOT, join(tmp, 'ok', 'student'));
    mkdirSync(join(tmp, 'other', 'student', 'scripts'), { recursive: true });
    writeFileSync(join(tmp, 'other', 'student', 'scripts', 'scheduled.mjs'), '// a different copy\n');
    assert.doesNotThrow(() => assertOwnRoot(join(tmp, 'ok'), PACK_ROOT));
    assert.throws(() => assertOwnRoot(join(tmp, 'other'), PACK_ROOT), /--root/);
    assert.throws(() => assertOwnRoot(join(tmp, 'missing'), PACK_ROOT), /--root/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('W-023-A6-2 the suggested allowlist pre-approves schedule.mjs status only', () => {
  const allow = JSON.parse(readFileSync(join(PACK_ROOT, 'templates', 'claude-settings.suggested.json'), 'utf8')).permissions.allow;
  const schedule = allow.filter((a) => a.includes('schedule.mjs'));
  assert.deepEqual(schedule, ['Bash(node student/scripts/schedule.mjs status:*)']);
});
