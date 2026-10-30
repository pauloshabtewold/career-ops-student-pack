// Assumed: with agent codex in config/student.yml, `schedule.mjs install --dry-run` finds codex on the PATH of the install
// process and prints `--agent codex --agent-path <path>` in the launchd plist and the Task Scheduler script. Under
// scheduled-discovery-plus-triage with no codex it still prints the artifact plus a warning naming codex.
// buildPlist, buildTaskScript and triageNotes are pure; nothing here starts launchctl or powershell. HOME and USERPROFILE
// point at a temp dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { buildPlist, buildTaskScript, triageNotes } from '../../scripts/schedule.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const NODE = '/opt/example node/bin/node';
const ROOT = '/Users/sample student/career-ops';
const WIN_NODE = 'C:\\Program Files\\nodejs\\node.exe';
const WIN_ROOT = 'C:\\Users\\Sample Student\\career-ops';
const WIN_CODEX = 'C:\\Users\\Sample Student\\AppData\\Roaming\\npm\\codex.cmd';
const BUNDLE = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const bundleInstalled = process.platform === 'darwin' && existsSync(BUNDLE);

function dryRun({ config, withCodex }) {
  const tmp = mkdtempSync(join(tmpdir(), 'sched-codex-'));
  const bin = join(tmp, 'bin');
  const home = join(tmp, 'home');
  mkdirSync(bin);
  mkdirSync(home);
  mkdirSync(join(tmp, 'config'));
  writeFileSync(join(tmp, 'config', 'student.yml'), `timezone: America/Chicago\n${config}`);
  if (withCodex) {
    writeFileSync(join(bin, 'codex'), '#!/usr/bin/env node\nprocess.exit(0);\n');
    chmodSync(join(bin, 'codex'), 0o755);
    writeFileSync(join(bin, 'codex.cmd'), '@echo off\r\nexit /b 0\r\n');
  }
  const out = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'schedule.mjs'), 'install', '--dry-run', '--time', '07:30', '--root', tmp], {
    cwd: PACK_ROOT,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: bin + (withCodex ? '' : delimiter + join(tmp, 'empty')) },
  });
  return { out, tmp, bin, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

// triageNotes may return its text or print it; collect both.
function notesOf(opts) {
  const printed = [];
  const orig = { log: console.log, error: console.error, warn: console.warn };
  console.log = console.error = console.warn = (...a) => printed.push(a.join(' '));
  let returned;
  try {
    returned = triageNotes(opts);
  } finally {
    Object.assign(console, orig);
  }
  const ret = Array.isArray(returned) ? returned.join('\n') : returned == null ? '' : String(returned);
  return [ret, ...printed].filter(Boolean).join('\n');
}

// M-002-S12
test('M-002-S12 install --dry-run with agent codex and codex on PATH prints --agent codex --agent-path <resolved path>', () => {
  const d = dryRun({ config: 'agent: codex\nautomation: scheduled-discovery-plus-triage\n', withCodex: true });
  try {
    assert.equal(d.out.status, 0, d.out.stderr);
    assert.match(d.out.stdout, /<string>--agent<\/string>\s*<string>codex<\/string>\s*<string>--agent-path<\/string>\s*<string>[^<]*codex(\.cmd)?<\/string>|--agent codex --agent-path/);
    assert.ok(d.out.stdout.includes(d.bin), `resolved path under the fake bin shown: ${d.out.stdout}`);
    assert.doesNotMatch(d.out.stdout, /--agent claude|--claude/);
    assert.doesNotMatch(d.out.stdout + d.out.stderr, /skip(ped)?[^\n]*triage|triage[^\n]*skip/i);
    assert.equal(existsSync(join(d.tmp, 'home', 'Library', 'LaunchAgents')), false);
  } finally {
    d.cleanup();
  }
});

// M-002-S12
test('M-002-S12 buildPlist writes --agent codex --agent-path as separate string elements', () => {
  const xml = buildPlist({ nodePath: NODE, root: ROOT, time: '07:30', agent: 'codex', agentPath: '/opt/sample bin/codex' });
  assert.match(xml, /<string>--agent<\/string>\s*<string>codex<\/string>\s*<string>--agent-path<\/string>\s*<string>\/opt\/sample bin\/codex<\/string>/);
  assert.doesNotMatch(xml, /--claude/);
  assert.doesNotMatch(buildPlist({ nodePath: NODE, root: ROOT, time: '07:30', agent: 'codex' }), /--agent/);
});

// M-002-S12
test('M-002-S12 buildTaskScript quotes the Windows codex.cmd path after --agent codex --agent-path', () => {
  const ps = buildTaskScript({ nodePath: WIN_NODE, root: WIN_ROOT, time: '07:30', agent: 'codex', agentPath: WIN_CODEX });
  assert.match(ps, /scheduled\.mjs/);
  assert.match(ps, /--agent codex --agent-path/);
  assert.ok(ps.includes(`"${WIN_CODEX}"`), 'codex.cmd path is double-quoted');
  assert.doesNotMatch(ps, /--claude/);
  assert.doesNotMatch(buildTaskScript({ nodePath: WIN_NODE, root: WIN_ROOT, time: '07:30', agent: 'codex' }), /--agent/);
});

// M-002-S13
test('M-002-S13 triageNotes under plus-triage with no codex path warns and names codex and its sign-in step', () => {
  const text = notesOf({ automation: 'scheduled-discovery-plus-triage', agent: 'codex', agentPath: null });
  assert.match(text, /codex: not found/);
  assert.match(text, /warn[^\n]*codex|codex[^\n]*skip|skip[^\n]*codex/i);
  assert.match(text, /run codex once in a terminal to sign in/);
});

// M-002-S12
test('M-002-S12 triageNotes shows "codex: <path>" and no warning when the path is set', () => {
  const text = notesOf({ automation: 'scheduled-discovery-plus-triage', agent: 'codex', agentPath: '/opt/sample/bin/codex' });
  assert.match(text, /codex: \/opt\/sample\/bin\/codex/);
  assert.doesNotMatch(text, /not found|skip/i);
});

// M-002-S13
test('M-002-S13 triageNotes warns only under plus-triage', () => {
  const text = notesOf({ automation: 'scheduled-discovery', agent: 'codex', agentPath: null });
  assert.doesNotMatch(text, /sign in|skip(ped)?[^\n]*triage|triage[^\n]*skip/i);
});

// M-002-S13
test('M-002-S13 install --dry-run under plus-triage with no codex still prints the job and a warning naming codex', { skip: bundleInstalled && 'a ChatGPT.app codex bundle on this machine is always found' }, () => {
  const d = dryRun({ config: 'agent: codex\nautomation: scheduled-discovery-plus-triage\n', withCodex: false });
  try {
    assert.equal(d.out.status, 0, d.out.stderr);
    assert.match(d.out.stdout, /scheduled\.mjs/);
    const text = d.out.stdout + d.out.stderr;
    assert.match(text, /codex/i);
    assert.match(text, /skip(ped)?[^\n]*triage|triage[^\n]*skip/i);
    assert.doesNotMatch(d.out.stdout, /--agent-path/);
  } finally {
    d.cleanup();
  }
});
