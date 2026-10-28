// Assumed: scripts/daily.mjs runs as a CLI: `daily.mjs --root R --data-dir D --today YYYY-MM-DD`.
// Upstream commands go through lib/upstream.mjs, so a fake upstream root records them in calls.jsonl.
// Pack steps (merge-post, prefilter, apply-triage, liveness-sweep) work on the same root's data directory.
// A step that fails is reported in the digest; the run still exits 0.
// Run files: data/run-log.md (START, END and ABORT lines), data/digest/student-<date>.md,
// data/.snapshots/<date>/{applications.md,pipeline.md}, lock directory data/.student-daily.lock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT, line, pipelineText, jobUrl } from '../helpers/script-harness.mjs';

const APPS = '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-10-10 | Example Robotics | Data Intern | 4.2/5 | Applied | no | none | |\n';

function setup() {
  const up = createFakeUpstream();
  writeFileSync(join(up.root, 'config', 'student.yml'), 'timezone: America/Chicago\nautomation: scheduled-discovery\npresets: []\n');
  const data = join(up.root, 'data');
  writeFileSync(join(data, 'applications.md'), APPS);
  const pending = [line(jobUrl(1), 'Example Robotics', 'Data Intern', 'Remote', 'triage=4.0')];
  writeFileSync(join(data, 'pipeline.md'), pipelineText({ pending }));
  return { up, data, cleanup: () => rmSync(up.root, { recursive: true, force: true }) };
}

function runDaily(up, today) {
  const argv = [join(PACK_ROOT, 'scripts', 'daily.mjs'), '--root', up.root, '--data-dir', join(up.root, 'data'), '--today', today];
  const out = spawnSync(process.execPath, argv, { cwd: PACK_ROOT, encoding: 'utf8', timeout: 120000 });
  return { code: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '' };
}

const idx = (calls, cli, pred = () => true) => calls.findIndex((c) => c.cli === cli && pred(c.argv));

// M-008-S4
test('M-008-S4 weekday run calls github-lists then scan, writes the digest and run-log lines', () => {
  const s = setup();
  try {
    const res = runDaily(s.up, '2026-10-27');
    assert.equal(res.code, 0, res.stderr);
    const calls = s.up.calls();
    const lists = idx(calls, 'plugins.mjs', (a) => a[0] === 'run' && a[1] === 'github-lists');
    const scan = idx(calls, 'scan.mjs');
    assert.ok(lists >= 0, 'plugins.mjs run github-lists was called');
    assert.ok(scan > lists, 'scan runs after github-lists');
    assert.equal(idx(calls, 'check-liveness.mjs'), -1, 'no liveness sweep on a Tuesday');
    assert.equal(idx(calls, 'audit-portals.mjs'), -1, 'no portal audit outside the first run of a month');
    const digest = readFileSync(join(s.data, 'digest', 'student-2026-10-27.md'), 'utf8');
    assert.match(digest, /github-lists/);
    assert.match(digest, /scan/);
    const log = readFileSync(join(s.data, 'run-log.md'), 'utf8');
    assert.match(log, /START/);
    assert.match(log, /END/);
    assert.ok(log.indexOf('START') < log.indexOf('END'));
    assert.equal(existsSync(join(s.data, '.student-daily.lock')), false, 'lock released');
  } finally {
    s.cleanup();
  }
});

// M-008-S4
test('M-008-S4 Sunday run adds the API-only liveness sweep after scan', () => {
  const s = setup();
  try {
    const res = runDaily(s.up, '2026-10-25');
    assert.equal(res.code, 0, res.stderr);
    const calls = s.up.calls();
    const live = idx(calls, 'check-liveness.mjs');
    assert.ok(live > idx(calls, 'scan.mjs'), 'liveness sweep runs after scan');
    assert.ok(calls[live].argv.includes('--no-fallback'), 'never the browser fallback');
    assert.equal(idx(calls, 'audit-portals.mjs'), -1);
  } finally {
    s.cleanup();
  }
});

// M-008-S4
test('M-008-S4 snapshots applications.md and pipeline.md and keeps only the newest 7 folders', () => {
  const s = setup();
  try {
    const snaps = join(s.data, '.snapshots');
    for (let d = 1; d <= 9; d++) {
      const dir = join(snaps, `2026-10-0${d}`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'applications.md'), 'old\n');
    }
    const res = runDaily(s.up, '2026-10-27');
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(readdirSync(snaps).sort(), ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-27']);
    assert.equal(readFileSync(join(snaps, '2026-10-27', 'applications.md'), 'utf8'), APPS);
    assert.ok(existsSync(join(snaps, '2026-10-27', 'pipeline.md')));
  } finally {
    s.cleanup();
  }
});

// M-008-S5
test('M-008-S5 a live lock younger than 12 hours gives an ABORT line, exit 0 and no step', () => {
  const s = setup();
  try {
    const lock = join(s.data, '.student-daily.lock');
    mkdirSync(lock);
    writeFileSync(join(lock, 'owner.json'), `${JSON.stringify({ pid: process.pid, token: 'held-by-test', started_at: new Date().toISOString(), pipeline: 'student-daily' })}\n`);
    const res = runDaily(s.up, '2026-10-27');
    assert.equal(res.code, 0, res.stderr);
    assert.match(readFileSync(join(s.data, 'run-log.md'), 'utf8'), /ABORT/);
    assert.deepEqual(s.up.calls(), [], 'no upstream step ran');
    assert.equal(existsSync(join(s.data, 'digest', 'student-2026-10-27.md')), false);
    assert.ok(existsSync(lock), 'the other holder keeps its lock');
  } finally {
    s.cleanup();
  }
});
