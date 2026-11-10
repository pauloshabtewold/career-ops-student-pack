#!/usr/bin/env node
// Entry point the installed schedule starts. It runs the zero-token daily run first, then the inbox pass when
// mailbox.schedule is on, then, only for scheduled-discovery-plus-triage, the model triage, each as its own child process
// so one cannot stop the other. The inbox pass goes before triage so alert rows it stages are graded the same run.
// daily.mjs gets 60 minutes. The triage child gets a timeout that scales with the chunks the student's triage budget
// allows today and stays under run_lock_hours (triageChildTimeoutMs in daily-triage.mjs); it also gets that timeout as
// --deadline so it ends cleanly before the kill.
// Usage: scheduled.mjs [--root R] [--data-dir D] [--today YYYY-MM-DD] [--log-file F] [--agent claude|codex] [--agent-path PATH] [--claude PATH] [--check]
// --check starts nothing: it tests each enabled step (daily run dry run, inbox pass check, triage agent present), prints
// one 'check <step>: ok|off|failed (<reason>)' line per step and exits 1 when an enabled step failed. schedule.mjs verify uses it.
// Exit 0 always otherwise: a scheduler that sees a failure retries, and every step already reports its own problems.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { resolveAgentPath, AGENT_TIMEOUT_MS } from '../lib/agent.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { oneLine, stepErrorText } from '../lib/text.mjs';
import { defaultRunner } from '../lib/upstream.mjs';
import { effectiveLimits } from './budget.mjs';
import { plannedChunks, triageChildTimeoutMs } from './daily-triage.mjs';

const CHILD_TIMEOUT_MS = 60 * 60 * 1000;
// The inbox pass child gets the agent's own 15 minutes; its agent call ends at the --deadline passed to it.
const INBOX_TIMEOUT_MS = AGENT_TIMEOUT_MS;

// A schedule installed before the agent flags existed passes only --claude; it keeps working until reinstalled.
const agentFlagsFor = ({ agent, agentPath, claude }) => (agentPath ? ['--agent', agent, '--agent-path', agentPath] : claude ? ['--claude', claude] : []);

// Each script runs as its own child process, so a crash or timeout in the daily run cannot stop triage and the reverse.
// daily.mjs gets --via-scheduled so it knows this wrapper already starts triage.
export async function scheduledRun({ root, packRoot, passThrough, agent, agentPath, claude, dataDir = resolvePaths({ root }).dataDir, today, runner = defaultRunner, out = (s) => console.log(s) }) {
  const child = (script, extra = [], timeout = CHILD_TIMEOUT_MS) => {
    try {
      const text = runner(process.execPath, [join(packRoot, 'scripts', script), ...extra, ...passThrough], { cwd: root, timeout });
      if (String(text).trim()) out(String(text).trimEnd());
    } catch (err) {
      out(`scheduled: ${script} stopped (${stepErrorText(err)})`);
    }
  };
  child('daily.mjs', ['--via-scheduled']);
  let config = null;
  try {
    config = await loadStudentConfig({ root });
  } catch (err) {
    out(`scheduled: config unreadable (${oneLine(err.message)}); daily triage skipped`);
  }
  const agentFlags = agentFlagsFor({ agent, agentPath, claude });
  // inbox-pass.mjs reads --agent and --agent-path only, so a schedule with just --claude lets it use the configured agent.
  if (config?.mailbox?.schedule === 'on') child('inbox-pass.mjs', [...(agentPath ? agentFlags : []), '--deadline', String(Date.now() + AGENT_TIMEOUT_MS)], INBOX_TIMEOUT_MS);
  if (config?.automation === 'scheduled-discovery-plus-triage') {
    // The deadline is when this wrapper's timeout kills the child. daily-triage stops starting chunks it could not finish
    // by then, because a kill mid-call would lose that chunk's ledger row while the agent kept spending.
    const timeout = triageTimeout({ config, dataDir, today });
    child('daily-triage.mjs', [...agentFlags, '--deadline', String(Date.now() + timeout)], timeout);
  }
  return 0;
}

// Tests each enabled step without running it: the daily run through its own --dry-run, the inbox pass through its --check
// (one real Gmail search), the triage agent by looking for its binary. Returns the report lines and whether any failed.
export async function scheduledCheck({ root, packRoot, passThrough, agent, agentPath, claude, runner = defaultRunner }) {
  const lines = [];
  const probe = (script, extra) => {
    try {
      return { ok: true, text: String(runner(process.execPath, [join(packRoot, 'scripts', script), ...extra, ...passThrough], { cwd: root, timeout: INBOX_TIMEOUT_MS })) };
    } catch (err) {
      return { ok: false, text: String(err.stdout ?? ''), reason: stepErrorText(err) };
    }
  };
  const daily = probe('daily.mjs', ['--dry-run']);
  lines.push(daily.ok ? 'check daily run: ok' : `check daily run: failed (${daily.reason})`);
  let config = null;
  try {
    config = await loadStudentConfig({ root });
  } catch (err) {
    lines.push(`check config: failed (${oneLine(err.message)})`);
  }
  const flags = agentFlagsFor({ agent, agentPath, claude });
  if (config?.mailbox?.schedule !== 'on') lines.push('check inbox pass: off');
  else {
    const inbox = probe('inbox-pass.mjs', ['--check', ...(agentPath ? flags : [])]);
    const failed = /inbox pass check: failed \((.*)\)/.exec(inbox.text);
    lines.push(inbox.ok ? 'check inbox pass: ok' : `check inbox pass: failed (${failed?.[1] ?? inbox.reason})`);
  }
  if (config?.automation !== 'scheduled-discovery-plus-triage') lines.push('check triage: off');
  else {
    const configured = config.agent ?? 'claude';
    const found = agentPath ?? claude ?? resolveAgentPath(configured);
    lines.push(found ? 'check triage: ok' : `check triage: failed (${configured} not found)`);
  }
  return { lines, failed: lines.some((l) => /: failed \(/.test(l)) };
}

// A throw while sizing the run (an unreadable ledger or pipeline) falls back to the 60-minute timeout every child had.
function triageTimeout({ config, dataDir, today }) {
  try {
    const day = today ?? createClock({ timezone: config.timezone }).today();
    return triageChildTimeoutMs({ chunks: plannedChunks({ config, dataDir, today: day }), runLockHours: effectiveLimits(config).values.run_lock_hours });
  } catch {
    return CHILD_TIMEOUT_MS;
  }
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { agent: 'string', 'agent-path': 'string', claude: 'string', 'log-file': 'string', check: 'boolean' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  // The schedule points --log-file at data/logs, which a student may have deleted since install; both children append to it.
  if (flags.logFile) mkdirSync(dirname(flags.logFile), { recursive: true });
  const passThrough = [
    '--root', paths.root,
    '--data-dir', paths.dataDir,
    ...(flags.today ? ['--today', flags.today] : []),
    ...(flags.logFile ? ['--log-file', flags.logFile] : []),
  ];
  if (flags.check) {
    const report = await scheduledCheck({ root: paths.root, packRoot: paths.packRoot, passThrough, agent: flags.agent, agentPath: flags.agentPath, claude: flags.claude });
    for (const line of report.lines) console.log(line);
    return report.failed ? 1 : 0;
  }
  try {
    return await scheduledRun({ root: paths.root, packRoot: paths.packRoot, passThrough, agent: flags.agent, agentPath: flags.agentPath, claude: flags.claude, dataDir: paths.dataDir, today: flags.today });
  } catch (err) {
    if (err instanceof UsageError) throw err;
    console.log(`scheduled: stopped (${oneLine(err.message)})`);
    return 0;
  }
}

if (isMain(import.meta.url)) await runCli(main);
