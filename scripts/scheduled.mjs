#!/usr/bin/env node
// Entry point the installed schedule starts. It runs the zero-token daily run first and then, only for
// scheduled-discovery-plus-triage, the model triage, each as its own child process so one cannot stop the other.
// Usage: scheduled.mjs [--root R] [--data-dir D] [--today YYYY-MM-DD] [--log-file F] [--agent claude|codex] [--agent-path PATH] [--claude PATH]
// Exit 0 always: a scheduler that sees a failure retries, and both steps already report their own problems.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { oneLine, stepErrorText } from '../lib/text.mjs';
import { defaultRunner } from '../lib/upstream.mjs';

const CHILD_TIMEOUT_MS = 60 * 60 * 1000;

// Each script runs as its own child process, so a crash or timeout in the daily run cannot stop triage and the reverse.
// daily.mjs gets --via-scheduled so it knows this wrapper already starts triage.
export async function scheduledRun({ root, packRoot, passThrough, agent, agentPath, claude, runner = defaultRunner, out = (s) => console.log(s) }) {
  const child = (script, extra = []) => {
    try {
      const text = runner(process.execPath, [join(packRoot, 'scripts', script), ...extra, ...passThrough], { cwd: root, timeout: CHILD_TIMEOUT_MS });
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
  // A schedule installed before the agent flags existed passes only --claude; it keeps working until reinstalled.
  if (config?.automation === 'scheduled-discovery-plus-triage') child('daily-triage.mjs', agentPath ? ['--agent', agent, '--agent-path', agentPath] : claude ? ['--claude', claude] : []);
  return 0;
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { agent: 'string', 'agent-path': 'string', claude: 'string', 'log-file': 'string' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  // The schedule points --log-file at data/logs, which a student may have deleted since install; both children append to it.
  if (flags.logFile) mkdirSync(dirname(flags.logFile), { recursive: true });
  const passThrough = [
    '--root', paths.root,
    '--data-dir', paths.dataDir,
    ...(flags.today ? ['--today', flags.today] : []),
    ...(flags.logFile ? ['--log-file', flags.logFile] : []),
  ];
  try {
    return await scheduledRun({ root: paths.root, packRoot: paths.packRoot, passThrough, agent: flags.agent, agentPath: flags.agentPath, claude: flags.claude });
  } catch (err) {
    if (err instanceof UsageError) throw err;
    console.log(`scheduled: stopped (${oneLine(err.message)})`);
    return 0;
  }
}

if (isMain(import.meta.url)) await runCli(main);
