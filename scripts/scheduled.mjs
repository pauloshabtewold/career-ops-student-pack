#!/usr/bin/env node
// Entry point the installed schedule starts. It runs the zero-token daily run first and then, only for
// scheduled-discovery-plus-triage, the model triage, each as its own child process so one cannot stop the other.
// Usage: scheduled.mjs [--root R] [--data-dir D] [--today YYYY-MM-DD] [--log-file F] [--claude PATH]
// Exit 0 always: a scheduler that sees a failure retries, and both steps already report their own problems.
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, runCli } from '../lib/args.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { defaultRunner } from '../lib/upstream.mjs';

const CHILD_TIMEOUT_MS = 60 * 60 * 1000;
const oneLine = (text, max = 160) => String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, max) ?? '';

// Each script runs as its own child process, so a crash or timeout in the daily run cannot stop triage and the reverse.
// daily.mjs gets --via-scheduled so it knows this wrapper already starts triage.
export async function scheduledRun({ root, packRoot, passThrough, claude, runner = defaultRunner, out = (s) => console.log(s) }) {
  const child = (script, extra = []) => {
    try {
      const text = runner(process.execPath, [join(packRoot, 'scripts', script), ...extra, ...passThrough], { cwd: root, timeout: CHILD_TIMEOUT_MS });
      if (String(text).trim()) out(String(text).trimEnd());
    } catch (err) {
      out(`scheduled: ${script} stopped (${oneLine(err.stderr || err.stdout || err.message) || 'failed'})`);
    }
  };
  child('daily.mjs', ['--via-scheduled']);
  let config = null;
  try {
    config = await loadStudentConfig({ root });
  } catch (err) {
    out(`scheduled: config unreadable (${oneLine(err.message)}); daily triage skipped`);
  }
  if (config?.automation === 'scheduled-discovery-plus-triage') child('daily-triage.mjs', claude ? ['--claude', claude] : []);
  return 0;
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { claude: 'string', 'log-file': 'string' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const passThrough = [
    '--root', paths.root,
    '--data-dir', paths.dataDir,
    ...(flags.today ? ['--today', flags.today] : []),
    ...(flags.logFile ? ['--log-file', flags.logFile] : []),
  ];
  try {
    return await scheduledRun({ root: paths.root, packRoot: paths.packRoot, passThrough, claude: flags.claude });
  } catch (err) {
    if (err instanceof UsageError) throw err;
    console.log(`scheduled: stopped (${oneLine(err.message)})`);
    return 0;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(main);
