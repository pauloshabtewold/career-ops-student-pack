#!/usr/bin/env node
// Opt-in daily schedule: a launchd agent on macOS or a Task Scheduler task on Windows that runs
// student/scripts/scheduled.mjs, which runs the zero-token daily run and, for scheduled-discovery-plus-triage, the model
// triage. Only the personalization interview offers this; nothing installs on its own.
// Usage: schedule.mjs install|remove|status [--time HH:MM] [--dry-run] [--root R]
// A real install takes only the pack's own root: --root is for --dry-run, remove and status (assertOwnRoot).
// --time and the config time are read in the config time zone (timezone in config/student.yml).
// --dry-run prints the artifact and never starts launchctl or powershell, so tests can run it safely.
import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { resolveAgentPath, signInHint } from '../lib/agent.mjs';
import { createClock, zonedInstant } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { runResult } from '../lib/run.mjs';

export const LABEL = 'com.career-ops.student.daily';
export const TASK_NAME = 'career-ops-student-daily';
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function parseTime(time) {
  const m = TIME_RE.exec(String(time));
  if (!m) throw new UsageError(`--time expects HH:MM on a 24 hour clock, got "${time}"`);
  return { hour: Number(m[1]), minute: Number(m[2]), text: `${m[1].padStart(2, '0')}:${m[2]}` };
}

// launchd and Task Scheduler both fire on this computer's clock, while the student picks the time in the time zone of
// config/student.yml; the two differ for a student whose laptop is set to another zone. Converted with today's offsets,
// which holds until one of the two zones changes daylight saving time without the other.
export function machineTime(time, { timezone, machineZone, now = new Date() }) {
  const t = parseTime(time);
  const machine = machineZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timezone || timezone === machine) return { time: t.text, note: null };
  const today = createClock({ timezone, nowFn: () => now }).today();
  const local = createClock({ timezone: machine }).localTime(zonedInstant(today, timezone, t.hour, t.minute));
  const text = `${String(local.hour).padStart(2, '0')}:${String(local.minute).padStart(2, '0')}`;
  return { time: text, note: `time: ${t.text} ${timezone} is ${text} on this computer's clock (${machine})` };
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

// agentPath is the absolute path found for the agent at install time, or null; a scheduler has a bare PATH of its own.
// The legacy claude parameter is the same thing for agent claude.
export function buildPlist({ nodePath, root, time, agent = 'claude', agentPath = null, claude = null }) {
  const t = parseTime(time);
  const found = agentPath ?? claude;
  // launchd only runs on macOS, so plist paths stay POSIX even when built on Windows.
  const logs = posix.join(root, 'data', 'logs');
  const scheduled = posix.join(root, 'student', 'scripts', 'scheduled.mjs');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${xml(nodePath)}</string>`,
    `    <string>${xml(scheduled)}</string>`,
    '    <string>--log-file</string>',
    `    <string>${xml(posix.join(logs, 'student-daily.log'))}</string>`,
    ...(found ? ['    <string>--agent</string>', `    <string>${agent}</string>`, '    <string>--agent-path</string>', `    <string>${xml(found)}</string>`] : []),
    '  </array>',
    '  <key>WorkingDirectory</key>',
    `  <string>${xml(root)}</string>`,
    '  <key>StartCalendarInterval</key>',
    '  <dict>',
    '    <key>Hour</key>',
    `    <integer>${t.hour}</integer>`,
    '    <key>Minute</key>',
    `    <integer>${t.minute}</integer>`,
    '  </dict>',
    '  <key>StandardOutPath</key>',
    `  <string>${xml(posix.join(logs, 'student-daily.out.log'))}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xml(posix.join(logs, 'student-daily.err.log'))}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

// Windows counterpart of buildPlist: registers scheduled.mjs with the same arguments and the resolved agent path.
export function buildTaskScript({ nodePath, root, time, agent = 'claude', agentPath = null, claude = null }) {
  const t = parseTime(time);
  const logs = win32.join(root, 'data', 'logs');
  const scheduled = win32.join(root, 'student', 'scripts', 'scheduled.mjs');
  const logFile = win32.join(logs, 'student-daily.log');
  const found = agentPath ?? claude;
  const agentArg = found ? ` --agent ${agent} --agent-path "${found}"` : '';
  return [
    "$ErrorActionPreference = 'Stop'",
    `New-Item -ItemType Directory -Force -Path ${psq(logs)} | Out-Null`,
    `$action = New-ScheduledTaskAction -Execute ${psq(nodePath)} -Argument ${psq(`"${scheduled}" --log-file "${logFile}"${agentArg}`)} -WorkingDirectory ${psq(root)}`,
    `$trigger = New-ScheduledTaskTrigger -Daily -At ${psq(t.text)}`,
    '$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries',
    `Register-ScheduledTask -TaskName ${psq(TASK_NAME)} -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null`,
    '',
  ].join('\n');
}

const removeScript = () => `Unregister-ScheduledTask -TaskName ${psq(TASK_NAME)} -Confirm:$false\n`;
const statusScript = () => `Get-ScheduledTask -TaskName ${psq(TASK_NAME)} | Select-Object -ExpandProperty State\n`;

const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

export function tryRun(cmd, args) {
  const r = runResult(cmd, args);
  return { ok: !r.error, out: r.error ? String(r.error.stderr || r.error.message) : r.stdout };
}

const runPowershell = (script) => tryRun('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);

// Said at install time because the scheduled job cannot ask anyone: without an agent path every run skips triage.
export function triageNotes({ automation, agent = 'claude', agentPath = null }) {
  const lines = [`${agent}: ${agentPath ?? 'not found'}`];
  if (automation === 'scheduled-discovery-plus-triage' && !agentPath) {
    lines.push(`warning: ${agent} was not found, so every scheduled run will skip daily triage and say so in the digest; install ${agent}, ${signInHint(agent)}, then run schedule.mjs install again`);
  }
  return lines;
}

// Schedule commands for macOS (launchd).
function macCommand(command, { nodePath, root, time, dryRun, agent, agentPath, automation }) {
  const file = plistPath();
  const domain = `gui/${process.getuid()}`;
  if (command === 'install') {
    const xmlText = buildPlist({ nodePath, root, time, agent, agentPath });
    for (const line of triageNotes({ automation, agent, agentPath })) console.log(line);
    if (dryRun) {
      console.log(xmlText);
      console.log(`dry run: would write ${file} and run launchctl bootstrap ${domain} ${file}`);
      return 0;
    }
    mkdirSync(join(root, 'data', 'logs'), { recursive: true });
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
    writeFileSync(file, xmlText);
    tryRun('launchctl', ['bootout', domain, file]);
    const res = tryRun('launchctl', ['bootstrap', domain, file]);
    console.log(res.ok ? `installed ${LABEL} at ${time}` : `launchctl bootstrap failed: ${res.out.split('\n')[0]}`);
    return res.ok ? 0 : 1;
  }
  if (command === 'remove') {
    if (dryRun) {
      console.log(`dry run: would run launchctl bootout ${domain} ${file} and delete ${file}`);
      return 0;
    }
    tryRun('launchctl', ['bootout', domain, file]);
    rmSync(file, { force: true });
    console.log(`removed ${LABEL}`);
    return 0;
  }
  console.log(existsSync(file) ? `${LABEL} is installed (${file})` : `${LABEL} is not installed`);
  return 0;
}

// Schedule commands for Windows (Task Scheduler).
function winCommand(command, { nodePath, root, time, dryRun, agent, agentPath, automation }) {
  if (command === 'install') {
    const script = buildTaskScript({ nodePath, root, time, agent, agentPath });
    for (const line of triageNotes({ automation, agent, agentPath })) console.log(line);
    if (dryRun) {
      console.log(script);
      return 0;
    }
    const res = runPowershell(script);
    console.log(res.ok ? `installed ${TASK_NAME} at ${time}` : `Register-ScheduledTask failed: ${res.out.split('\n')[0]}`);
    return res.ok ? 0 : 1;
  }
  const script = command === 'remove' ? removeScript() : statusScript();
  if (dryRun) {
    console.log(script);
    return 0;
  }
  const res = runPowershell(script);
  if (command === 'remove') console.log(res.ok ? `removed ${TASK_NAME}` : `${TASK_NAME} was not registered`);
  else console.log(res.ok ? `${TASK_NAME}: ${res.out.trim()}` : `${TASK_NAME} is not registered`);
  return 0;
}

// A real install writes a job that runs <root>/student/scripts/scheduled.mjs every day, so it only takes a root whose
// student/ folder is this very pack. Without that, an injected `--root <dir>` could schedule any scheduled.mjs found under
// <dir>. --dry-run writes nothing and may name any root, which keeps the tests on scratch roots.
export function assertOwnRoot(root, packRoot) {
  const entry = (base) => {
    try {
      // native realpath resolves 8.3 short names; win32 paths compare case-insensitively (c:\ vs C:\)
      const real = realpathSync.native(join(base, 'scripts', 'scheduled.mjs'));
      return process.platform === 'win32' ? real.toLowerCase() : real;
    } catch {
      return null;
    }
  };
  const own = entry(packRoot);
  if (!own || entry(join(root, 'student')) !== own) {
    throw new UsageError(`--root ${root} is not the folder this pack is installed in; run install without --root (or add --dry-run to preview)`);
  }
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2), { commands: ['install', 'remove', 'status'], flags: { time: 'string' } });
  const paths = resolvePaths({ root: flags.root });
  if (command === 'install' && !flags.dryRun) assertOwnRoot(paths.root, paths.packRoot);
  // remove must work when config/student.yml is broken: a student who cannot fix it still needs the schedule gone.
  const config = command === 'remove' ? null : await loadStudentConfig({ root: paths.root });
  const t = machineTime(flags.time ?? config?.schedule?.time ?? '06:00', { timezone: config?.timezone });
  if (t.note && command === 'install') console.log(t.note);
  const agent = config?.agent ?? 'claude';
  const agentPath = command === 'install' ? resolveAgentPath(agent) : null;
  const ctx = { nodePath: process.execPath, root: paths.root, time: t.time, dryRun: Boolean(flags.dryRun), agent, agentPath, automation: config?.automation ?? 'manual' };
  const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' || ctx.dryRun ? 'darwin' : null;
  if (!platform) throw new UsageError('schedule.mjs supports macOS and Windows 11 only');
  return platform === 'win32' ? winCommand(command, ctx) : macCommand(command, ctx);
}

if (isMain(import.meta.url)) await runCli(main);
