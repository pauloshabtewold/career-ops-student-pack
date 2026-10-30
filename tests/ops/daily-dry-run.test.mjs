// Assumed: scripts/daily.mjs accepts --dry-run and --via-scheduled besides --log-file. A dry run prints the planned
// step names, takes no lock and writes no snapshot, digest or run-log file, and runs no upstream script.
// Digest lines for a missing --via-scheduled land in data/digest/student-<date>.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT, jobUrl, line, pipelineText } from '../helpers/script-harness.mjs';

const PLUS = 'automation: scheduled-discovery-plus-triage\n';

function setup(config = 'automation: scheduled-discovery\n') {
  const up = createFakeUpstream();
  writeFileSync(join(up.root, 'config', 'student.yml'), `timezone: America/Chicago\n${config}presets: []\n`);
  const data = join(up.root, 'data');
  writeFileSync(join(data, 'pipeline.md'), pipelineText({ pending: [line(jobUrl(1), 'Example Robotics', 'Data Intern', 'Remote', 'triage=4.0')] }));
  writeFileSync(join(data, 'applications.md'), '# Applications\n');
  return { up, data, cleanup: () => rmSync(up.root, { recursive: true, force: true }) };
}

const daily = (s, today, extra = []) =>
  spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'daily.mjs'), '--root', s.up.root, '--data-dir', s.data, '--today', today, ...extra], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 120000 });

// M-002-S4
test('M-002-S4 --dry-run prints the planned steps and leaves no lock, snapshot, digest or run-log behind', () => {
  const s = setup();
  try {
    const before = readdirSync(s.data).sort();
    const r = daily(s, '2026-10-27', ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    for (const step of ['snapshot', 'github-lists', 'scan', 'merge-post', 'prefilter']) assert.match(r.stdout, new RegExp(step), `plans ${step}`);
    assert.doesNotMatch(r.stdout, /liveness|audit-portals/, 'no Sunday or monthly steps on a mid-month Tuesday');
    assert.deepEqual(readdirSync(s.data).sort(), before);
    for (const name of ['.snapshots', 'digest', 'run-log.md', '.student-daily.lock']) assert.equal(existsSync(join(s.data, name)), false, name);
    assert.deepEqual(s.up.calls(), [], 'no upstream script ran');
  } finally {
    s.cleanup();
  }
});

// M-002-S4
test('M-002-S4 --dry-run on the first Sunday of a month also plans the monthly and Sunday steps', () => {
  const s = setup();
  try {
    const r = daily(s, '2026-11-01', ['--dry-run']);
    assert.equal(r.status, 0, r.stderr);
    for (const step of ['cycle', 'audit-portals', 'liveness']) assert.match(r.stdout, new RegExp(step), `plans ${step}`);
    assert.equal(existsSync(join(s.data, '.student-monthly')), false, 'the monthly marker is not written');
    assert.equal(existsSync(join(s.data, 'digest')), false);
    assert.deepEqual(s.up.calls(), []);
  } finally {
    s.cleanup();
  }
});

// M-002-S5
test('M-002-S5 a failing step without --dry-run still writes the digest with the failure and exits 0', () => {
  const s = setup();
  try {
    s.up.setOutput('scan', 'scan exploded\n', 1);
    const r = daily(s, '2026-10-27');
    assert.equal(r.status, 0, r.stderr);
    const digest = readFileSync(join(s.data, 'digest', 'student-2026-10-27.md'), 'utf8');
    assert.match(digest, /scan: FAILED/);
    assert.match(readFileSync(join(s.data, 'run-log.md'), 'utf8'), /END/);
  } finally {
    s.cleanup();
  }
});

// M-002-S32
test('M-002-S32 --dry-run with a malformed config/student.yml prints a planned config step and the error line', () => {
  const s = setup();
  try {
    writeFileSync(join(s.up.root, 'config', 'student.yml'), 'automation: [unclosed\n  presets: : :\n');
    const before = readdirSync(s.data).sort();
    const r = daily(s, '2026-10-27', ['--dry-run']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const mentions = r.stdout.split('\n').filter((l) => /config|student\.yml/i.test(l));
    assert.ok(mentions.length >= 2, `a config step line and an error line expected, got: ${r.stdout}`);
    assert.deepEqual(readdirSync(s.data).sort(), before);
    assert.equal(existsSync(join(s.data, 'run-log.md')), false);
  } finally {
    s.cleanup();
  }
});

// M-002-S30
test('M-002-S30 --log-file without --via-scheduled under plus-triage writes the run schedule.mjs install again digest line', () => {
  const s = setup(PLUS);
  const tmp = mkdtempSync(join(tmpdir(), 'daily-log-'));
  try {
    const r = daily(s, '2026-10-27', ['--log-file', join(tmp, 'student-daily.log')]);
    assert.equal(r.status, 0, r.stderr);
    const digest = readFileSync(join(s.data, 'digest', 'student-2026-10-27.md'), 'utf8');
    assert.match(digest, /schedule\.mjs install/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    s.cleanup();
  }
});

// M-002-S30
test('M-002-S30 --via-scheduled is accepted and no re-run line is written; other automation levels never get it', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'daily-log-'));
  const logFile = join(tmp, 'student-daily.log');
  const s = setup(PLUS);
  const t = setup('automation: scheduled-discovery\n');
  try {
    const viaScheduled = daily(s, '2026-10-27', ['--log-file', logFile, '--via-scheduled']);
    assert.equal(viaScheduled.status, 0, viaScheduled.stderr);
    assert.doesNotMatch(readFileSync(join(s.data, 'digest', 'student-2026-10-27.md'), 'utf8'), /schedule\.mjs install/);
    const discovery = daily(t, '2026-10-27', ['--log-file', logFile]);
    assert.equal(discovery.status, 0, discovery.stderr);
    assert.doesNotMatch(readFileSync(join(t.data, 'digest', 'student-2026-10-27.md'), 'utf8'), /schedule\.mjs install/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    s.cleanup();
    t.cleanup();
  }
});
