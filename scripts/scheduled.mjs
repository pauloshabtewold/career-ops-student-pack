#!/usr/bin/env node
// Entry point the installed schedule starts. It runs the zero-token daily run first, then the inbox pass when
// mailbox.schedule is on, then, only for scheduled-discovery-plus-triage, the model triage, each as its own child process
// so one cannot stop the other. The inbox pass goes before triage so alert rows it stages are graded the same run.
// daily.mjs gets 60 minutes. The triage child gets a timeout that scales with the chunks the student's triage budget
// allows today and stays under run_lock_hours (triageChildTimeoutMs in daily-triage.mjs); it also gets that timeout as
// --deadline so it ends cleanly before the kill.
// Usage: scheduled.mjs [--root R] [--data-dir D] [--today YYYY-MM-DD] [--log-file F] [--agent claude|codex] [--agent-path PATH] [--claude PATH] [--check] [--fresh]
// --fresh is the hourly entry: it runs only the zero-token fresh-scan.mjs and nothing else.
// A paused schedule (data/.schedule-paused, set by schedule.mjs pause) exits 0 and starts nothing. Each run is recorded in
// data/student-runs.tsv; missed daily slots since the last success are written to data/.missed-runs.txt for the digest,
// and the daily steps run once, followed by the autopilot (scripts/autopilot.mjs).
// --check starts nothing: it tests each enabled step (daily run dry run, inbox pass check, triage agent present), prints
// one 'check <step>: ok|off|failed (<reason>)' line per step and exits 1 when an enabled step failed. schedule.mjs verify uses it.
// Exit 0 always otherwise: a scheduler that sees a failure retries, and every step already reports its own problems.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { resolveAgentPath, AGENT_TIMEOUT_MS } from '../lib/agent.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { lastSuccess, missedLine, missedSlots, readRuns, recordRun } from '../lib/run-ledger.mjs';
import { oneLine, stepErrorText } from '../lib/text.mjs';
import { defaultRunner } from '../lib/upstream.mjs';
import { effectiveLimits } from './budget.mjs';
import { plannedChunks, triageChildTimeoutMs } from './daily-triage.mjs';
import { PAUSE_FILE } from './schedule.mjs';

const CHILD_TIMEOUT_MS = 60 * 60 * 1000;
// The inbox pass child gets the agent's own 15 minutes; its agent call ends at the --deadline passed to it.
const INBOX_TIMEOUT_MS = AGENT_TIMEOUT_MS;
// The child's own deadline falls this much before the wrapper's kill, so a timed-out agent call still writes its digest line.
const INBOX_DEADLINE_MARGIN_MS = 60 * 1000;

// A schedule installed before the agent flags existed passes only --claude; it keeps working until reinstalled.
const agentFlagsFor = ({ agent, agentPath, claude }) => (agentPath ? ['--agent', agent, '--agent-path', agentPath] : claude ? ['--claude', claude] : []);

export const MISSED_FILE = '.missed-runs.txt';

// Writes the missed-slots line the digest reads, or removes a stale one; a first run has nothing missed. A ledger that
// cannot be read counts as nothing missed, so the run itself still goes ahead.
async function catchUp({ dataDir, config, kind, start, out }) {
  const file = join(dataDir, MISSED_FILE);
  try {
    const missed = missedSlots({ lastSuccess: lastSuccess(await readRuns(dataDir), kind), now: new Date(start), tz: config?.timezone, kind });
    const line = missedLine(missed);
    if (line) writeFileSync(file, `${line}\n`);
    else rmSync(file, { force: true });
  } catch (err) {
    rmSync(file, { force: true });
    out(`scheduled: run ledger unreadable (${oneLine(err.message)}); missed runs not counted`);
  }
}

// Each script runs as its own child process, so a crash or timeout in the daily run cannot stop triage and the reverse.
// daily.mjs gets --via-scheduled so it knows this wrapper already starts triage.
export async function scheduledRun({ root, packRoot, passThrough, agent, agentPath, claude, dataDir = resolvePaths({ root }).dataDir, today, runner = defaultRunner, out = (s) => console.log(s) }) {
  if (existsSync(join(dataDir, PAUSE_FILE))) {
    out('scheduled: paused (node student/scripts/schedule.mjs resume turns it back on)');
    return 0;
  }
  const start = new Date().toISOString();
  mkdirSync(dataDir, { recursive: true });
  const early = await loadStudentConfig({ root }).catch(() => null);
  await catchUp({ dataDir, config: early, kind: 'daily', start, out });
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
  if (config?.mailbox?.schedule === 'on') child('inbox-pass.mjs', [...(agentPath ? agentFlags : []), '--deadline', String(Date.now() + INBOX_TIMEOUT_MS - INBOX_DEADLINE_MARGIN_MS)], INBOX_TIMEOUT_MS);
  if (config?.automation === 'scheduled-discovery-plus-triage') {
    // The deadline is when this wrapper's timeout kills the child. daily-triage stops starting chunks it could not finish
    // by then, because a kill mid-call would lose that chunk's ledger row while the agent kept spending.
    const timeout = triageTimeout({ config, dataDir, today });
    child('daily-triage.mjs', [...agentFlags, '--deadline', String(Date.now() + timeout)], timeout);
  }
  // The autopilot starts once setup has recorded whether a scheduled run reaches Chrome (tools/schedule-probe.mjs), since
  // every Chrome step depends on that answer; before then the schedule runs the discovery and triage steps only.
  if (config && config.automation !== 'manual' && ['yes', 'no'].includes(config.chrome_in_schedule)) child('autopilot.mjs');
  try {
    await recordRun(dataDir, { start, end: new Date().toISOString(), kind: 'daily', status: 'ok' });
  } catch (err) {
    out(`scheduled: run not recorded (${oneLine(err.message)})`);
  }
  return 0;
}

// The hourly entry: one child, the fresh-jobs scan, which makes no model call. It exits 0 without work while paused.
export function freshRun({ root, packRoot, passThrough, dataDir = resolvePaths({ root }).dataDir, runner = defaultRunner, out = (s) => console.log(s) }) {
  if (existsSync(join(dataDir, PAUSE_FILE))) return 0;
  try {
    const text = runner(process.execPath, [join(packRoot, 'scripts', 'fresh-scan.mjs'), ...passThrough], { cwd: root, timeout: CHILD_TIMEOUT_MS });
    if (String(text).trim()) out(String(text).trimEnd());
  } catch (err) {
    out(`scheduled: fresh-scan.mjs stopped (${stepErrorText(err)})`);
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
  const { flags } = parseArgs(process.argv.slice(2), { flags: { agent: 'string', 'agent-path': 'string', claude: 'string', 'log-file': 'string', check: 'boolean', fresh: 'boolean' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  // The schedule points --log-file at data/logs, which a student may have deleted since install; both children append to it.
  if (flags.logFile) mkdirSync(dirname(flags.logFile), { recursive: true });
  const passThrough = [
    '--root', paths.root,
    '--data-dir', paths.dataDir,
    ...(flags.today ? ['--today', flags.today] : []),
    ...(flags.logFile ? ['--log-file', flags.logFile] : []),
  ];
  if (flags.fresh) return freshRun({ root: paths.root, packRoot: paths.packRoot, passThrough, dataDir: paths.dataDir });
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
