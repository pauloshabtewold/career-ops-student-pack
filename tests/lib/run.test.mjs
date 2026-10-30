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
test('runResult returns code 0 and stdout for a succeeding child', () => {
  const r = runResult(NODE, ['-e', 'process.stdout.write("hello")']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'hello');
  assert.equal(r.stderr, '');
  assert.equal(r.error, null);
});

// M-003-S2 normal: gitRunner returns git stdout in a scratch repo
test('gitRunner returns git stdout for rev-parse in a scratch repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'run-git-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir, windowsHide: true });
    assert.equal(gitRunner(['rev-parse', '--is-inside-work-tree'], { cwd: dir }).trim(), 'true');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// M-003-S5 edge: child prints then exits 3
test('runResult keeps stdout when the child exits 3', () => {
  const r = runResult(NODE, ['-e', 'console.log("partial"); process.exit(3)']);
  assert.equal(r.code, 3);
  assert.equal(r.stdout, 'partial\n');
  assert.ok(r.error);
});

// M-003-S7 error: missing executable does not throw
test('runResult returns code 1 with error set for a missing executable', () => {
  let r;
  assert.doesNotThrow(() => {
    r = runResult('definitely-not-a-real-executable-m003', []);
  });
  assert.equal(r.code, 1);
  assert.ok(r.error);
});

// M-003-S9 error: runText throws an error carrying stderr
test('runText throws an error whose stderr holds the child stderr', () => {
  assert.throws(
    () => runText(NODE, ['-e', 'process.stderr.write("bad-news"); process.exit(2)']),
    (err) => String(err.stderr) === 'bad-news',
  );
});

// M-003-S10 keep: inbox defaultRunner resolves ok and does not wait on stdin
test('inbox defaultRunner resolves code 0 with stdout and does not wait on stdin', { timeout: 15000 }, async () => {
  const ok = await inboxRunner(['-e', 'console.log("ok")'], { cwd: process.cwd() });
  assert.deepEqual({ code: ok.code, stdout: ok.stdout }, { code: 0, stdout: 'ok\n' });
  const r = await inboxRunner(['-e', 'setTimeout(() => process.exit(9), 5000); process.stdin.resume(); process.stdin.on("end", () => process.exit(0))'], { cwd: process.cwd() });
  assert.equal(r.code, 0);
});

// M-003-S11 keep: exit 3 keeps stdout under both defaultRunners
test('inbox and liveness-sweep defaultRunner keep stdout when the child exits 3', async () => {
  for (const runner of [inboxRunner, livenessRunner]) {
    const r = await runner(['-e', 'console.log("line"); process.exit(3)'], { cwd: process.cwd() });
    assert.equal(r.code, 3);
    assert.equal(r.stdout, 'line\n');
  }
});

// M-003-S12 keep: schedule tryRun maps failure and success
test('schedule tryRun maps a failing and a succeeding child', () => {
  assert.deepEqual(tryRun(NODE, ['-e', 'process.stderr.write("boom"); process.exit(1)']), { ok: false, out: 'boom' });
  assert.deepEqual(tryRun(NODE, ['-e', 'process.stdout.write("fine")']), { ok: true, out: 'fine' });
});
