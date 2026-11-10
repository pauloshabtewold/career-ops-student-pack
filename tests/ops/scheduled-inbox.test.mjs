// Assumed (M-002): scheduledRun({ root, packRoot, passThrough, agent, agentPath, claude, runner, out }) reads config/student.yml.
// With mailbox.schedule on it starts inbox-pass.mjs as its own child, between daily.mjs and daily-triage.mjs, as
// runner(process.execPath, [script, ...args], { cwd, timeout }) with --agent, --agent-path and --deadline <epoch ms>.
// A child that throws prints 'scheduled: inbox-pass.mjs stopped (<reason>)' through out and the run goes on. It never rejects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename, join } from 'node:path';
import { scheduledRun } from '../../scripts/scheduled.mjs';
import { makeRoot, PACK_ROOT } from '../helpers/script-harness.mjs';

const MAILBOX_ON = 'mailbox:\n  backend: connector\n  schedule: on\n';
const MAILBOX_OFF = 'mailbox:\n  backend: connector\n  schedule: off\n';
const names = (calls) => calls.map((c) => basename(c.args[0]));

async function run(config, { fail = null, failWith = () => new Error('child failed'), extra = { agent: 'claude', agentPath: '/opt/sample/bin/claude' } } = {}) {
  const r = makeRoot({ config });
  const calls = [];
  const lines = [];
  const runner = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (fail && basename(args[0]) === fail) throw failWith();
    return '';
  };
  try {
    await scheduledRun({ root: r.root, packRoot: PACK_ROOT, passThrough: ['--log-file', '/tmp/sample/student-daily.log'], ...extra, runner, out: (l) => lines.push(String(l)) });
    return { r, calls, lines, text: lines.join('\n') };
  } finally {
    r.cleanup();
  }
}

// M-002-S10-cdel
test('M-002-S10-cdel mailbox.schedule on runs daily.mjs, then inbox-pass.mjs, then daily-triage.mjs', async () => {
  const { calls } = await run(`automation: scheduled-discovery-plus-triage\n${MAILBOX_ON}`);
  assert.deepEqual(names(calls), ['daily.mjs', 'inbox-pass.mjs', 'daily-triage.mjs']);
});

// M-002-S10-cdel
test('extra check: the inbox pass starts with node in the career-ops folder, the agent flags and a --deadline', async () => {
  const { r, calls } = await run(`automation: scheduled-discovery-plus-triage\n${MAILBOX_ON}`, { extra: { agent: 'codex', agentPath: '/opt/sample/bin/codex' } });
  const inbox = calls.find((c) => basename(c.args[0]) === 'inbox-pass.mjs');
  assert.equal(inbox.cmd, process.execPath);
  assert.equal(inbox.opts.cwd, r.root);
  assert.equal(inbox.args[0], join(PACK_ROOT, 'scripts', 'inbox-pass.mjs'));
  assert.equal(inbox.args[inbox.args.indexOf('--agent') + 1], 'codex');
  assert.equal(inbox.args[inbox.args.indexOf('--agent-path') + 1], '/opt/sample/bin/codex');
  const deadline = Number(inbox.args[inbox.args.indexOf('--deadline') + 1]);
  assert.ok(Number.isFinite(deadline) && deadline > Date.now(), 'a deadline in epoch ms, still ahead');
  assert.ok(deadline <= Date.now() + 16 * 60 * 1000, 'within about 15 minutes');
  assert.ok(inbox.opts.timeout > 0 && inbox.opts.timeout <= 15 * 60 * 1000, 'a child timeout of at most 15 minutes');
});

// M-002-S10-cdel
test('extra check: mailbox.schedule on with scheduled-discovery runs daily.mjs then inbox-pass.mjs and no triage', async () => {
  const { calls } = await run(`automation: scheduled-discovery\n${MAILBOX_ON}`);
  assert.deepEqual(names(calls), ['daily.mjs', 'inbox-pass.mjs']);
});

// M-002-S11-cdel
test('M-002-S11-cdel with mailbox.schedule absent scheduled runs daily.mjs and triage only', async () => {
  for (const mailbox of ['', 'mailbox:\n  backend: connector\n']) {
    const plus = await run(`automation: scheduled-discovery-plus-triage\n${mailbox}`);
    assert.deepEqual(names(plus.calls), ['daily.mjs', 'daily-triage.mjs'], JSON.stringify(mailbox));
    const only = await run(`automation: scheduled-discovery\n${mailbox}`);
    assert.deepEqual(names(only.calls), ['daily.mjs'], JSON.stringify(mailbox));
  }
});

// M-002-AC11
test('extra check: mailbox.schedule off runs daily.mjs and triage only', async () => {
  const plus = await run(`automation: scheduled-discovery-plus-triage\n${MAILBOX_OFF}`);
  assert.deepEqual(names(plus.calls), ['daily.mjs', 'daily-triage.mjs']);
  const only = await run(`automation: scheduled-discovery\n${MAILBOX_OFF}`);
  assert.deepEqual(names(only.calls), ['daily.mjs']);
});

// M-002-S12-cdel
test('M-002-S12-cdel an inbox-pass child that throws prints a stopped line, daily triage still runs and scheduledRun resolves', async () => {
  const { calls, text } = await run(`automation: scheduled-discovery-plus-triage\n${MAILBOX_ON}`, { fail: 'inbox-pass.mjs' });
  assert.deepEqual(names(calls), ['daily.mjs', 'inbox-pass.mjs', 'daily-triage.mjs']);
  assert.match(text, /scheduled: inbox-pass\.mjs stopped/);
});

// M-002-S12-cdel
test('extra check: an inbox-pass child that times out is handled the same way', async () => {
  const timeout = () => Object.assign(new Error('spawnSync node ETIMEDOUT'), { code: 'ETIMEDOUT' });
  const { calls, text } = await run(`automation: scheduled-discovery-plus-triage\n${MAILBOX_ON}`, { fail: 'inbox-pass.mjs', failWith: timeout });
  assert.deepEqual(names(calls), ['daily.mjs', 'inbox-pass.mjs', 'daily-triage.mjs']);
  assert.match(text, /scheduled: inbox-pass\.mjs stopped/);
});
