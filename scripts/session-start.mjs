#!/usr/bin/env node
// Runs first in every Claude Code session (see AGENTS.student.md). Output is at most six lines because the agent
// reads it before anything else: update result, integrity restore, budget session and clamps, interview trigger,
// switch states. Usage: session-start.mjs [--root R]
import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runCli } from '../lib/args.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { verifyAndRestore } from '../lib/integrity.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { runUpdate } from '../update.mjs';

const MAX_LINES = 6;

function runBudgetSessionStart({ root, packRoot }) {
  try {
    const out = execFileSync(process.execPath, [join(packRoot, 'scripts', 'budget.mjs'), 'session-start', '--root', root], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (err) {
    return [`budget session start failed: ${String(err.stderr || err.message).split('\n')[0]}`];
  }
}

export async function sessionStart({ root, packRoot, update = runUpdate }) {
  const lines = [];
  try {
    lines.push(...(await update({ root, packRoot, safetyOnly: true })).lines);
  } catch {
    lines.push('pack update check failed; continuing');
  }
  const integrity = verifyAndRestore({ packRoot });
  if (integrity.restored || !integrity.ok) lines.push(integrity.message);
  lines.push(...runBudgetSessionStart({ root, packRoot }));

  let config = null;
  let problem = null;
  try {
    config = await loadStudentConfig({ root });
  } catch (err) {
    problem = `config problem: ${String(err.message).split('\n')[0]}`;
  }
  // The last line decides what the agent does next, so it is never the one cut by the line cap.
  let last;
  if (!config || !config.onboarding.complete) last = 'INTERVIEW: run student/interview/interview.md before anything else';
  else last = `outreach=${config.switches.outreach} handshake=${config.switches.handshake} submission=${config.switches.submission}`;
  const head = problem ? [problem, ...lines] : lines;
  return [...head.slice(0, MAX_LINES - 1), last];
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: {} });
  const paths = resolvePaths({ root: flags.root });
  for (const l of await sessionStart({ root: paths.root, packRoot: paths.packRoot })) console.log(l);
  return 0;
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) await runCli(main);
