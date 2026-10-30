// Assumed: scripts/scheduled.mjs exports scheduledRun({ root, packRoot, passThrough, claude, runner, out }). It reads
// config/student.yml from root, runs daily.mjs --via-scheduled and, only for scheduled-discovery-plus-triage,
// daily-triage.mjs, each as runner(process.execPath, [script, ...args], { cwd: root }). passThrough holds the flags
// to forward, for example ['--log-file', F]. It never rejects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename, join } from 'node:path';
import { scheduledRun } from '../../scripts/scheduled.mjs';
import { makeRoot, PACK_ROOT } from '../helpers/script-harness.mjs';

async function run(automation, { fail = null } = {}) {
  const r = makeRoot({ config: `automation: ${automation}\n` });
  const calls = [];
  const runner = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (fail && basename(args[0]) === fail) throw new Error('child failed');
    return '';
  };
  try {
    await scheduledRun({ root: r.root, packRoot: PACK_ROOT, passThrough: ['--log-file', '/tmp/sample/student-daily.log'], claude: '/opt/sample/bin/claude', runner, out: () => {} });
    return { r, calls };
  } finally {
    r.cleanup();
  }
}

// M-002-S10
test('M-002-S10 plus-triage runs daily.mjs and then daily-triage.mjs', async () => {
  const { calls } = await run('scheduled-discovery-plus-triage');
  assert.deepEqual(calls.map((c) => basename(c.args[0])), ['daily.mjs', 'daily-triage.mjs']);
});

// M-002-S10
test('M-002-S10 scheduled-discovery runs daily.mjs only', async () => {
  const { calls } = await run('scheduled-discovery');
  assert.deepEqual(calls.map((c) => basename(c.args[0])), ['daily.mjs']);
});

// M-002-S10
test('M-002-S10 a failing child does not make scheduledRun reject', async () => {
  await run('scheduled-discovery-plus-triage', { fail: 'daily.mjs' });
  await run('scheduled-discovery-plus-triage', { fail: 'daily-triage.mjs' });
});

// M-002-S29
test('M-002-S29 both children start with process.execPath in the career-ops root; daily gets --via-scheduled and the flags pass through', async () => {
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
