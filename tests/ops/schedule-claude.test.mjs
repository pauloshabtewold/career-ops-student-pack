// Assumed: buildPlist and buildTaskScript take { agent = 'claude', agentPath = null } (a legacy claude path maps to agent claude).
// They start student/scripts/scheduled.mjs and add `--agent <agent> --agent-path <path>` when a path is given. `schedule.mjs install --dry-run` finds
// claude on the PATH of the install process; under scheduled-discovery-plus-triage with no claude it still prints the
// artifact and a warning that scheduled runs will skip triage. Nothing here starts launchctl or powershell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { buildPlist, buildTaskScript } from '../../scripts/schedule.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const NODE = '/opt/example node/bin/node';
const ROOT = '/Users/sample student/career-ops';
const WIN_NODE = 'C:\\Program Files\\nodejs\\node.exe';
const WIN_ROOT = 'C:\\Users\\Sample Student\\career-ops';
const WIN_CLAUDE = 'C:\\Users\\Sample Student\\AppData\\Roaming\\npm\\claude.cmd';
const esc = (s) => s.replace(/[\\.[\](){}*+?^$|/]/g, '\\$&');

function dryRun({ config, withClaude }) {
  const tmp = mkdtempSync(join(tmpdir(), 'sched-claude-'));
  const bin = join(tmp, 'bin');
  const home = join(tmp, 'home');
  mkdirSync(bin);
  mkdirSync(home);
  mkdirSync(join(tmp, 'config'));
  writeFileSync(join(tmp, 'config', 'student.yml'), `timezone: America/Chicago\n${config}`);
  if (withClaude) {
    writeFileSync(join(bin, 'claude'), '#!/usr/bin/env node\nprocess.exit(0);\n');
    chmodSync(join(bin, 'claude'), 0o755);
    // which() on Windows matches only PATHEXT names, the way a real npm-global claude.cmd is found.
    writeFileSync(join(bin, 'claude.cmd'), '@echo off\r\nexit /b 0\r\n');
  }
  const out = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'schedule.mjs'), 'install', '--dry-run', '--time', '07:30', '--root', tmp], {
    cwd: PACK_ROOT,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, HOME: home, USERPROFILE: home, PATH: bin + (withClaude ? '' : delimiter + join(tmp, 'empty')) },
  });
  return { out, tmp, bin, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

// M-002-S11
test('M-002-S11 install --dry-run prints a job that starts student/scripts/scheduled.mjs', () => {
  const d = dryRun({ config: 'automation: scheduled-discovery\n', withClaude: false });
  try {
    assert.equal(d.out.status, 0, d.out.stderr);
    assert.match(d.out.stdout, /student[\\/]scripts[\\/]scheduled\.mjs/);
    assert.doesNotMatch(d.out.stdout, /scripts[\\/]daily\.mjs/);
    assert.equal(existsSync(join(d.tmp, 'home', 'Library', 'LaunchAgents')), false);
  } finally {
    d.cleanup();
  }
});

// M-002-S27
test('M-002-S27 buildPlist writes --agent claude --agent-path with the absolute claude path and omits them without claude', () => {
  const xml = buildPlist({ nodePath: NODE, root: ROOT, time: '07:30', agent: 'claude', agentPath: '/opt/sample bin/claude' });
  assert.match(xml, /<string>[^<]*student[\\/]scripts[\\/]scheduled\.mjs<\/string>/);
  assert.match(xml, /<string>--agent<\/string>\s*<string>claude<\/string>\s*<string>--agent-path<\/string>\s*<string>\/opt\/sample bin\/claude<\/string>/);
  assert.doesNotMatch(xml, /--claude/);
  // The legacy claude parameter (an older caller) must produce the same job as agentPath.
  const legacy = buildPlist({ nodePath: NODE, root: ROOT, time: '07:30', claude: '/opt/sample bin/claude' });
  assert.equal(legacy, xml);
  assert.match(legacy, /<string>--agent<\/string>\s*<string>claude<\/string>\s*<string>--agent-path<\/string>\s*<string>\/opt\/sample bin\/claude<\/string>/);
  assert.match(xml, new RegExp(`<key>WorkingDirectory</key>\\s*<string>${esc(ROOT)}</string>`));
  const none = buildPlist({ nodePath: NODE, root: ROOT, time: '07:30' });
  assert.doesNotMatch(none, /--claude|--agent/);
  assert.match(none, /scheduled\.mjs/);
});

// M-002-S27
test('M-002-S27 buildTaskScript starts scheduled.mjs and carries the claude path in the task action', () => {
  const ps = buildTaskScript({ nodePath: WIN_NODE, root: WIN_ROOT, time: '07:30', claude: WIN_CLAUDE });
  assert.match(ps, /scheduled\.mjs/);
  assert.doesNotMatch(ps, /daily\.mjs/);
  assert.match(ps, /--agent claude --agent-path\s+\S*"/);
  assert.doesNotMatch(ps, /--claude/);
  assert.ok(ps.includes(WIN_CLAUDE), 'absolute claude path is in the action');
  assert.match(ps, new RegExp(`-WorkingDirectory\\s+['"]${esc(WIN_ROOT)}['"]`));
  assert.doesNotMatch(buildTaskScript({ nodePath: WIN_NODE, root: WIN_ROOT, time: '07:30' }), /--claude|--agent/);
});

// M-002-S27
test('M-002-S27 install --dry-run with claude on PATH shows its resolved absolute path as --agent-path', () => {
  const d = dryRun({ config: 'automation: scheduled-discovery-plus-triage\n', withClaude: true });
  try {
    assert.equal(d.out.status, 0, d.out.stderr);
    assert.ok(d.out.stdout.includes('--agent'), d.out.stdout);
    assert.ok(d.out.stdout.includes('--agent-path'), d.out.stdout);
    assert.ok(d.out.stdout.includes(join(d.bin, 'claude')), 'resolved path shown');
    assert.doesNotMatch(d.out.stdout + d.out.stderr, /skip(ped)?[^\n]*triage|triage[^\n]*skip/i);
    assert.doesNotMatch(d.out.stdout + d.out.stderr, /warning:/);
  } finally {
    d.cleanup();
  }
});

// M-002-S28
test('M-002-S28 plus-triage with no claude on PATH still installs and prints the triage-skipped warning', () => {
  const d = dryRun({ config: 'automation: scheduled-discovery-plus-triage\n', withClaude: false });
  try {
    assert.equal(d.out.status, 0, d.out.stderr);
    assert.match(d.out.stdout, /scheduled\.mjs/, 'the job is still produced');
    const text = d.out.stdout + d.out.stderr;
    assert.match(text, /skip(ped)?[^\n]*triage|triage[^\n]*skip/i);
    assert.match(text, /claude/i, 'the warning names claude');
    assert.doesNotMatch(d.out.stdout, /--agent-path|--claude/);
  } finally {
    d.cleanup();
  }
});

// M-002-S28
test('M-002-S28 the warning appears only under plus-triage', () => {
  const d = dryRun({ config: 'automation: scheduled-discovery\n', withClaude: false });
  try {
    assert.equal(d.out.status, 0, d.out.stderr);
    assert.doesNotMatch(d.out.stdout + d.out.stderr, /skip(ped)?[^\n]*triage|triage[^\n]*skip/i);
  } finally {
    d.cleanup();
  }
});
