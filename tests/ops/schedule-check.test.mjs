// Assumed: scheduleNotice reads the installed schedule (plist under an injected HOME, or Task Scheduler through an
// injected runner) and returns one line when it predates scheduled.mjs or lacks the configured agent, else null.
// Nothing here touches the real LaunchAgents folder, Task Scheduler or launchctl.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlist } from '../../scripts/schedule.mjs';
import { launchAgentPath, scheduleNotice } from '../../lib/schedule-check.mjs';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

// The v0.1.0 buildPlist, with synthetic paths: it starts daily.mjs and passes no flags.
const V010_PLIST = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<plist version="1.0">',
  '<dict>',
  '  <key>Label</key>',
  '  <string>com.career-ops.student.daily</string>',
  '  <key>ProgramArguments</key>',
  '  <array>',
  '    <string>/usr/local/bin/node</string>',
  '    <string>/work/career-ops/student/scripts/daily.mjs</string>',
  '  </array>',
  '</dict>',
  '</plist>',
  '',
].join('\n');

const OLD_NOTICE = 'schedule: installed by an older pack, so the daily run skips triage. Run `node student/scripts/schedule.mjs install` again.';

function setup(automation = 'scheduled-discovery-plus-triage', agent = 'claude') {
  const up = createFakeUpstream();
  writeFileSync(join(up.root, 'config', 'student.yml'), `timezone: America/Chicago\nautomation: ${automation}\nagent: ${agent}\npresets: []\n`);
  const home = mkdtempSync(join(tmpdir(), 'sched-home-'));
  const putPlist = (text) => {
    const file = launchAgentPath(home);
    mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
    writeFileSync(file, text);
  };
  return { root: up.root, home, putPlist, cleanup: () => { rmSync(up.root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); } };
}
const mac = (s, extra = {}) => scheduleNotice({ root: s.root, platform: 'darwin', home: s.home, ...extra });
const win = (s, runner) => scheduleNotice({ root: s.root, platform: 'win32', home: s.home, runner });
const current = (agentPath) => buildPlist({ nodePath: '/usr/local/bin/node', root: '/work/career-ops', time: '06:00', agent: 'claude', agentPath });

test('v0.1.0 plist with plus-triage gives the older-pack notice', async () => {
  const s = setup();
  try {
    s.putPlist(V010_PLIST);
    assert.equal(await mac(s), OLD_NOTICE);
  } finally { s.cleanup(); }
});

test('v0.1.0 plist without plus-triage gives the short notice', async () => {
  const s = setup('scheduled-discovery');
  try {
    s.putPlist(V010_PLIST);
    assert.equal(await mac(s), 'schedule: installed by an older pack. Run `node student/scripts/schedule.mjs install` again.');
  } finally { s.cleanup(); }
});

test('current plist with the configured agent gives no notice', async () => {
  const s = setup();
  try {
    s.putPlist(current('/opt/bin/claude'));
    assert.equal(await mac(s), null);
  } finally { s.cleanup(); }
});

test('scheduled.mjs plist without an agent path, plus-triage: names the missing agent', async () => {
  const s = setup();
  try {
    s.putPlist(current(null));
    assert.match(await mac(s), /installed without the claude path, so the daily run skips triage/);
  } finally { s.cleanup(); }
});

test('current plist for a different agent than configured gives a notice', async () => {
  const s = setup('scheduled-discovery-plus-triage', 'codex');
  try {
    s.putPlist(current('/opt/bin/claude'));
    assert.match(await mac(s), /without the codex path/);
  } finally { s.cleanup(); }
});

test('missing plist gives no notice', async () => {
  const s = setup();
  try {
    assert.equal(await mac(s), null);
  } finally { s.cleanup(); }
});

test('Linux gives no notice and never calls the runner', async () => {
  const s = setup();
  try {
    assert.equal(await scheduleNotice({ root: s.root, platform: 'linux', home: s.home, runner: () => { throw new Error('called'); } }), null);
  } finally { s.cleanup(); }
});

test('Windows task arguments from an older pack give the notice', async () => {
  const s = setup();
  try {
    const calls = [];
    const runner = (cmd, args) => { calls.push([cmd, args]); return { ok: true, out: '"C:\\work\\career-ops\\student\\scripts\\daily.mjs" --log-file "C:\\work\\data\\logs\\student-daily.log"\r\n' }; };
    assert.equal(await win(s, runner), OLD_NOTICE);
    assert.equal(calls[0][0], 'powershell.exe');
    assert.match(calls[0][1].at(-1), /Get-ScheduledTask -TaskName 'career-ops-student-daily'/);
  } finally { s.cleanup(); }
});

test('Windows task arguments from the current pack give no notice', async () => {
  const s = setup();
  try {
    const out = '"C:\\work\\career-ops\\student\\scripts\\scheduled.mjs" --log-file "C:\\work\\data\\logs\\student-daily.log" --agent claude --agent-path "C:\\bin\\claude.exe"\r\n';
    assert.equal(await win(s, () => ({ ok: true, out })), null);
  } finally { s.cleanup(); }
});

test('runner failure, an empty answer or a throw gives no notice and no crash', async () => {
  const s = setup();
  try {
    assert.equal(await win(s, () => ({ ok: false, out: 'task not found' })), null);
    assert.equal(await win(s, () => ({ ok: true, out: '' })), null);
    assert.equal(await win(s, () => { throw new Error('boom'); }), null);
  } finally { s.cleanup(); }
});

test('daily.mjs run directly with plus-triage and no --log-file writes the triage note in the digest', () => {
  const up = createFakeUpstream();
  try {
    writeFileSync(join(up.root, 'config', 'student.yml'), 'timezone: America/Chicago\nautomation: scheduled-discovery-plus-triage\npresets: []\n');
    const argv = [join(PACK_ROOT, 'scripts', 'daily.mjs'), '--root', up.root, '--data-dir', join(up.root, 'data'), '--today', '2026-10-27'];
    const out = spawnSync(process.execPath, argv, { cwd: PACK_ROOT, encoding: 'utf8', timeout: 120000 });
    assert.equal(out.status, 0, out.stderr);
    const digest = readFileSync(join(up.root, 'data', 'digest', 'student-2026-10-27.md'), 'utf8');
    assert.match(digest, /this run did not triage: .*run node student\/scripts\/schedule\.mjs install again/);
    const via = spawnSync(process.execPath, [...argv, '--via-scheduled'], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 120000 });
    assert.equal(via.status, 0, via.stderr);
    assert.doesNotMatch(readFileSync(join(up.root, 'data', 'digest', 'student-2026-10-27.md'), 'utf8'), /this run did not triage/);
  } finally { rmSync(up.root, { recursive: true, force: true }); }
});

test('a legacy --claude PATH install still counts as having the claude path', async () => {
  const s = setup();
  try {
    s.putPlist(V010_PLIST.replace('student/scripts/daily.mjs</string>', 'student/scripts/scheduled.mjs</string>\n    <string>--claude</string>\n    <string>/opt/bin/claude</string>'));
    assert.equal(await mac(s), null);
  } finally { s.cleanup(); }
});

test('a root path that merely contains scheduled.mjs does not hide a daily.mjs schedule', async () => {
  const s = setup();
  try {
    s.putPlist(V010_PLIST.replace('/work/career-ops/', '/work/scheduled.mjs-copy/career-ops/'));
    assert.equal(await mac(s), OLD_NOTICE);
  } finally { s.cleanup(); }
});
