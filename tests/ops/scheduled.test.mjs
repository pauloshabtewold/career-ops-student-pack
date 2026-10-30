// Assumed: scripts/scheduled.mjs exports scheduledRun({ root, packRoot, passThrough, claude, runner, out }). It reads
// config/student.yml from root, runs daily.mjs --via-scheduled and, only for scheduled-discovery-plus-triage,
// daily-triage.mjs, each as runner(process.execPath, [script, ...args], { cwd: root }). passThrough holds the flags
// to forward, for example ['--log-file', F]. It never rejects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { scheduledRun } from '../../scripts/scheduled.mjs';
import { makeRoot, PACK_ROOT, runScript } from '../helpers/script-harness.mjs';

async function run(automation, { fail = null, extra = { claude: '/opt/sample/bin/claude' } } = {}) {
  const r = makeRoot({ config: `automation: ${automation}\n` });
  const calls = [];
  const runner = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (fail && basename(args[0]) === fail) throw new Error('child failed');
    return '';
  };
  try {
    await scheduledRun({ root: r.root, packRoot: PACK_ROOT, passThrough: ['--log-file', '/tmp/sample/student-daily.log'], ...extra, runner, out: () => {} });
    return { r, calls };
  } finally {
    r.cleanup();
  }
}

// legacy-M-002-S10
test('legacy-M-002-S10 plus-triage runs daily.mjs and then daily-triage.mjs', async () => {
  const { calls } = await run('scheduled-discovery-plus-triage');
  assert.deepEqual(calls.map((c) => basename(c.args[0])), ['daily.mjs', 'daily-triage.mjs']);
});

// legacy-M-002-S10
test('legacy-M-002-S10 scheduled-discovery runs daily.mjs only', async () => {
  const { calls } = await run('scheduled-discovery');
  assert.deepEqual(calls.map((c) => basename(c.args[0])), ['daily.mjs']);
});

// legacy-M-002-S10
test('legacy-M-002-S10 a failing child does not make scheduledRun reject', async () => {
  await run('scheduled-discovery-plus-triage', { fail: 'daily.mjs' });
  await run('scheduled-discovery-plus-triage', { fail: 'daily-triage.mjs' });
});

// legacy-M-002-S29
test('legacy-M-002-S29 both children start with process.execPath in the career-ops root; daily gets --via-scheduled and the flags pass through', async () => {
  const { r, calls } = await run('scheduled-discovery-plus-triage');
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.cmd, process.execPath);
    assert.equal(c.opts.cwd, r.root);
    assert.equal(c.args[0], join(PACK_ROOT, 'scripts', basename(c.args[0])));
  }
  const [daily, triage] = calls;
  assert.ok(daily.args.includes('--via-scheduled'));
  assert.equal(daily.args[daily.args.indexOf('--log-file') + 1], '/tmp/sample/student-daily.log');
  assert.equal(triage.args[triage.args.indexOf('--claude') + 1], '/opt/sample/bin/claude');
  assert.equal(triage.args.includes('--via-scheduled'), false);
});

// legacy-M-002-S14
test('legacy-M-002-S14 scheduledRun passes --agent and --agent-path to daily-triage.mjs', async () => {
  const { calls } = await run('scheduled-discovery-plus-triage', { extra: { agent: 'codex', agentPath: '/opt/sample/bin/codex' } });
  const triage = calls.find((c) => basename(c.args[0]) === 'daily-triage.mjs');
  assert.equal(triage.args[triage.args.indexOf('--agent') + 1], 'codex');
  assert.equal(triage.args[triage.args.indexOf('--agent-path') + 1], '/opt/sample/bin/codex');
  assert.equal(triage.args.includes('--claude'), false);
  const daily = calls.find((c) => basename(c.args[0]) === 'daily.mjs');
  assert.equal(daily.args.includes('--agent'), false);
});

// legacy-M-002-S15
test('legacy-M-002-S15 a legacy claude input still yields --claude <path> and no --agent flags', async () => {
  const { calls } = await run('scheduled-discovery-plus-triage', { extra: { claude: '/opt/sample/bin/claude' } });
  const triage = calls.find((c) => basename(c.args[0]) === 'daily-triage.mjs');
  assert.equal(triage.args[triage.args.indexOf('--claude') + 1], '/opt/sample/bin/claude');
  assert.equal(triage.args.includes('--agent'), false);
  assert.equal(triage.args.includes('--agent-path'), false);
});

// legacy-M-002-S14
test('legacy-M-002-S14 with no agent path and no claude, daily-triage.mjs gets none of the agent flags', async () => {
  const { calls } = await run('scheduled-discovery-plus-triage', { extra: {} });
  const triage = calls.find((c) => basename(c.args[0]) === 'daily-triage.mjs');
  for (const f of ['--agent', '--agent-path', '--claude']) assert.equal(triage.args.includes(f), false, f);
});

// W-015-L1: the Codex walkthrough's launchd fire had no data/logs folder and daily-triage stopped with ENOENT.
test('W-015-L1 scheduled.mjs and daily-triage.mjs create a missing log folder instead of stopping', () => {
  const r = makeRoot({ config: 'automation: scheduled-discovery-plus-triage\n' });
  try {
    const log = join(r.root, 'data', 'logs', 'student-daily.log');
    const triage = runScript('daily-triage', ['--log-file', log, '--agent', 'claude', '--agent-path', join(r.root, 'no-such-claude')], r);
    assert.equal(triage.code, 0, triage.stderr);
    assert.doesNotMatch(triage.stdout + triage.stderr, /ENOENT[^\n]*logs|daily-triage: stopped/);
    assert.ok(r.exists('data/logs/student-daily.log'), 'daily-triage wrote its line to the log');
    rmSync(join(r.root, 'data', 'logs'), { recursive: true, force: true });
    const sched = runScript('scheduled', ['--log-file', log], r);
    assert.equal(sched.code, 0, sched.stderr);
    assert.doesNotMatch(sched.stdout, /ENOENT[^\n]*logs/);
    assert.ok(r.exists('data/logs/student-daily.log'), 'the daily run wrote its summary to the log');
  } finally {
    r.cleanup();
  }
});
