#!/usr/bin/env node
// Opt-in daily schedule: a launchd agent on macOS or a Task Scheduler task on Windows that runs
// student/scripts/scheduled.mjs, which runs the zero-token daily run and, for scheduled-discovery-plus-triage, the model
// triage. Only the personalization interview offers this; nothing installs on its own.
// Usage: schedule.mjs install|remove|status [--time HH:MM] [--dry-run] [--root R]
// --dry-run prints the artifact and never starts launchctl or powershell, so tests can run it safely.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, runCli } from '../lib/args.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { which } from '../lib/which.mjs';

export const LABEL = 'com.career-ops.student.daily';
export const TASK_NAME = 'career-ops-student-daily';
const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function parseTime(time) {
  const m = TIME_RE.exec(String(time));
  if (!m) throw new UsageError(`--time expects HH:MM on a 24 hour clock, got "${time}"`);
  return { hour: Number(m[1]), minute: Number(m[2]), text: `${m[1].padStart(2, '0')}:${m[2]}` };
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

// claude is the absolute path found on the installing user's PATH, or null; a scheduler has a bare PATH of its own.
export function buildPlist({ nodePath, root, time, claude = null }) {
  const t = parseTime(time);
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
    ...(claude ? ['    <string>--claude</string>', `    <string>${xml(claude)}</string>`] : []),
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

// Windows counterpart of buildPlist: registers scheduled.mjs with the same arguments and the resolved claude path.
export function buildTaskScript({ nodePath, root, time, claude = null }) {
  const t = parseTime(time);
  const logs = win32.join(root, 'data', 'logs');
  const scheduled = win32.join(root, 'student', 'scripts', 'scheduled.mjs');
  const logFile = win32.join(logs, 'student-daily.log');
  const claudeArg = claude ? ` --claude "${claude}"` : '';
  return [
    "$ErrorActionPreference = 'Stop'",
    `New-Item -ItemType Directory -Force -Path ${psq(logs)} | Out-Null`,
    `$action = New-ScheduledTaskAction -Execute ${psq(nodePath)} -Argument ${psq(`"${scheduled}" --log-file "${logFile}"${claudeArg}`)} -WorkingDirectory ${psq(root)}`,
    `$trigger = New-ScheduledTaskTrigger -Daily -At ${psq(t.text)}`,
    '$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries',
    `Register-ScheduledTask -TaskName ${psq(TASK_NAME)} -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null`,
    '',
  ].join('\n');
}

const removeScript = () => `Unregister-ScheduledTask -TaskName ${psq(TASK_NAME)} -Confirm:$false\n`;
const statusScript = () => `Get-ScheduledTask -TaskName ${psq(TASK_NAME)} | Select-Object -ExpandProperty State\n`;

const plistPath = () => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

function tryRun(cmd, args) {
  try {
    return { ok: true, out: execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { ok: false, out: String(err.stderr || err.message) };
  }
}

const runPowershell = (script) => tryRun('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);

// Said at install time because the scheduled job cannot ask anyone: without a claude path every run skips triage.
function triageNotes({ automation, claude }) {
  const lines = [`claude: ${claude ?? 'not found on PATH'}`];
  if (automation === 'scheduled-discovery-plus-triage' && !claude) {
    lines.push('warning: claude was not found on PATH, so every scheduled run will skip daily triage and say so in the digest; install claude, run it once to sign in, then run schedule.mjs install again');
  }
  return lines;
}

// Schedule commands for macOS (launchd).
function macCommand(command, { nodePath, root, time, dryRun, claude, automation }) {
  const file = plistPath();
  const domain = `gui/${process.getuid()}`;
  if (command === 'install') {
    const xmlText = buildPlist({ nodePath, root, time, claude });
    for (const line of triageNotes({ automation, claude })) console.log(line);
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
function winCommand(command, { nodePath, root, time, dryRun, claude, automation }) {
  if (command === 'install') {
    const script = buildTaskScript({ nodePath, root, time, claude });
    for (const line of triageNotes({ automation, claude })) console.log(line);
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

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2), { commands: ['install', 'remove', 'status'], flags: { time: 'string' } });
  const paths = resolvePaths({ root: flags.root });
  const config = await loadStudentConfig({ root: paths.root });
  const t = parseTime(flags.time ?? config?.schedule?.time ?? '06:00');
  const claude = command === 'install' ? which('claude') : null;
  const ctx = { nodePath: process.execPath, root: paths.root, time: t.text, dryRun: Boolean(flags.dryRun), claude, automation: config?.automation ?? 'manual' };
  const platform = process.platform === 'win32' ? 'win32' : process.platform === 'darwin' || ctx.dryRun ? 'darwin' : null;
  if (!platform) throw new UsageError('schedule.mjs supports macOS and Windows 11 only');
  return platform === 'win32' ? winCommand(command, ctx) : macCommand(command, ctx);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(main);
