// Reads the schedule that schedule.mjs installed and says whether it still matches the current pack.
// A schedule from v0.1.0 starts daily.mjs directly, so it never runs the daily triage; scheduled.mjs is the current entry.
// Read only: it never writes the plist or registers a task. The runner and home are injected so tests touch neither.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadStudentConfig } from './config.mjs';
import { runResult } from './run.mjs';

export const SCHEDULE_LABEL = 'com.career-ops.student.daily';
export const SCHEDULE_TASK_NAME = 'career-ops-student-daily';
const REINSTALL = 'Run `node student/scripts/schedule.mjs install` again.';

export const launchAgentPath = (home = homedir()) => join(home, 'Library', 'LaunchAgents', `${SCHEDULE_LABEL}.plist`);

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// The strings inside the ProgramArguments array, in order, or null when the plist has none.
export function plistArguments(text) {
  const m = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text);
  if (!m) return null;
  return [...m[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((s) => unxml(s[1]));
}

const defaultRunner = (cmd, args) => {
  // A hung powershell.exe must not stall update.mjs, so the read is cut off.
  const r = runResult(cmd, args, { timeout: 15000 });
  return { ok: !r.error, out: r.error ? String(r.error.stderr || r.error.message) : r.stdout };
};

// Task Scheduler keeps the node path in Execute and the script and flags in Arguments; the arguments are what matter.
const WIN_SCRIPT = `Get-ScheduledTask -TaskName '${SCHEDULE_TASK_NAME}' | ForEach-Object { $_.Actions } | ForEach-Object { $_.Arguments }\n`;

// Returns the schedule's argument text, or null when no schedule is installed or it cannot be read.
export function installedScheduleArgs({ platform = process.platform, home = homedir(), runner = defaultRunner } = {}) {
  try {
    if (platform === 'darwin') {
      const file = launchAgentPath(home);
      if (!existsSync(file)) return null;
      return plistArguments(readFileSync(file, 'utf8'))?.join(' ') ?? null;
    }
    if (platform === 'win32') {
      const res = runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_SCRIPT]);
      return res.ok && res.out.trim() ? res.out.trim() : null;
    }
  } catch {
    return null;
  }
  return null;
}

// One line to print, or null when nothing is installed, the schedule is current, or it cannot be read.
export async function scheduleNotice({ root, platform, home, runner } = {}) {
  const args = installedScheduleArgs({ platform, home, runner });
  if (args === null) return null;
  let config = null;
  try {
    config = await loadStudentConfig({ root });
  } catch {
    config = null;
  }
  const plusTriage = config?.automation === 'scheduled-discovery-plus-triage';
  const agent = config?.agent ?? 'claude';
  if (!/(?:^|[\s"'\\/])scheduled\.mjs(?=[\s"']|$)/.test(args)) {
    return plusTriage
      ? `schedule: installed by an older pack, so the daily run skips triage. ${REINSTALL}`
      : `schedule: installed by an older pack. ${REINSTALL}`;
  }
  // Installs from before --agent passed `--claude PATH`, which scheduled.mjs still reads as the claude path.
  const hasAgent = (new RegExp(`--agent\\s+${agent}\\b`).test(args) && /--agent-path\s/.test(args))
    || (agent === 'claude' && /--claude\s/.test(args));
  if (plusTriage && !hasAgent) {
    return `schedule: installed without the ${agent} path, so the daily run skips triage. Install ${agent}, then run \`node student/scripts/schedule.mjs install\` again.`;
  }
  return null;
}
