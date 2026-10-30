import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitRunner, runResult, runText } from '../../lib/run.mjs';
import { defaultRunner as inboxRunner } from '../../scripts/inbox.mjs';
import { defaultRunner as livenessRunner } from '../../scripts/liveness-sweep.mjs';
import { tryRun } from '../../scripts/schedule.mjs';

const NODE = process.execPath;

// M-003-S1 normal: runResult returns code 0 and the child's stdout
test('M-003-S1 runResult returns code 0 and stdout for a succeeding child', () => {
  const r = runResult(NODE, ['-e', 'process.stdout.write("hello")']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'hello');
  assert.equal(r.stderr, '');
  assert.equal(r.error, null);
});

// M-003-S2 normal: gitRunner returns git stdout in a scratch repo
test('M-003-S2 gitRunner returns git stdout for rev-parse in a scratch repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-git-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir, windowsHide: true });
    assert.equal(gitRunner(['rev-parse', '--is-inside-work-tree'], { cwd: dir }).trim(), 'true');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// M-003-S5 edge: child prints then exits 3
test('M-003-S5 runResult keeps stdout when the child exits 3', () => {
  const r = runResult(NODE, ['-e', 'console.log("partial"); process.exit(3)']);
  assert.equal(r.code, 3);
  assert.equal(r.stdout, 'partial\n');
  assert.ok(r.error);
});

// M-003-S7 error: missing executable does not throw
test('M-003-S7 runResult returns code 1 with error set for a missing executable', () => {
  let r;
  assert.doesNotThrow(() => {
    r = runResult('definitely-not-a-real-executable-m003', []);
  });
  assert.equal(r.code, 1);
  assert.ok(r.error);
});

// M-003-S9 error: runText throws an error carrying stderr
test('M-003-S9 runText throws an error whose stderr holds the child stderr', () => {
  assert.throws(
    () => runText(NODE, ['-e', 'process.stderr.write("bad-news"); process.exit(2)']),
    (err) => String(err.stderr) === 'bad-news',
  );
});

// M-003-S10 keep: inbox defaultRunner resolves ok child
test('M-003-S10 inbox defaultRunner resolves code 0 with stdout for a child printing ok', async () => {
  const r = await inboxRunner(['-e', 'console.log("ok")'], { cwd: process.cwd() });
  assert.deepEqual({ code: r.code, stdout: r.stdout }, { code: 0, stdout: 'ok\n' });
});

// M-003-S10 keep: stdin must not be waited on
test('M-003-S10 inbox defaultRunner returns for a child that reads stdin to EOF', { timeout: 15000 }, async () => {
  const r = await inboxRunner(['-e', 'setTimeout(() => process.exit(9), 5000); process.stdin.resume(); process.stdin.on("end", () => process.exit(0))'], { cwd: process.cwd() });
  assert.equal(r.code, 0);
});

// M-003-S11 keep: exit 3 keeps stdout under both defaultRunners
test('M-003-S11 inbox defaultRunner keeps stdout when the child exits 3', async () => {
  const r = await inboxRunner(['-e', 'console.log("line"); process.exit(3)'], { cwd: process.cwd() });
  assert.equal(r.code, 3);
  assert.equal(r.stdout, 'line\n');
});

test('M-003-S11 liveness-sweep defaultRunner keeps stdout when the child exits 3', async () => {
  const r = await livenessRunner(['-e', 'console.log("line"); process.exit(3)'], { cwd: process.cwd() });
  assert.equal(r.code, 3);
  assert.equal(r.stdout, 'line\n');
});

// M-003-S12 keep: schedule tryRun maps failure and success
test('M-003-S12 schedule tryRun returns ok false with stderr text for a failing child', () => {
  assert.deepEqual(tryRun(NODE, ['-e', 'process.stderr.write("boom"); process.exit(1)']), { ok: false, out: 'boom' });
});

test('M-003-S12 schedule tryRun returns ok true with stdout for a succeeding child', () => {
  assert.deepEqual(tryRun(NODE, ['-e', 'process.stdout.write("fine")']), { ok: true, out: 'fine' });
});
