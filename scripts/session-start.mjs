#!/usr/bin/env node
// Runs first in every Claude Code or Codex session (see AGENTS.student.md). Output is at most six lines because the
// agent reads it before anything else: update result, integrity restore, budget session and clamps, interview trigger,
// switch states. A sandboxed or offline agent cannot reach the pack remote, so a failed update check is one quiet
// line and never stops the rest. Usage: session-start.mjs [--root R]
import { join } from 'node:path';
import { refreshOverride } from '../lib/agents-override.mjs';
import { parseArgs, runCli, isMain } from '../lib/args.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { verifyAndRestore } from '../lib/integrity.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { runText } from '../lib/run.mjs';
import { oneLine } from '../lib/text.mjs';
import { runUpdate } from '../update.mjs';

const MAX_LINES = 6;
const OFFLINE_LINE = 'update check skipped (offline)';
const UNREACHABLE_RE = /could not reach|unreachable|update check (skipped|failed)/i;
const NETWORK_CODES = new Set(['ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH']);
const NETWORK_RE = /unable to access|could not resolve host|could not read from remote|timed out|network is unreachable|connection (refused|reset|timed out)/i;

// Only a failure to reach the remote reads as offline. Anything else (a malformed config/plugins.yml, a plugin copy
// that cannot be written) means the safety check and plugin sync did not run while the network was fine.
function isNetworkFailure(err) {
  return NETWORK_CODES.has(err?.code) || NETWORK_RE.test(`${err?.message ?? ''} ${err?.stderr ?? ''}`);
}

// Every way of saying the remote could not be reached becomes the same single line.
function collapseOffline(lines) {
  const out = [];
  let seen = false;
  for (const line of lines) {
    if (!UNREACHABLE_RE.test(line)) out.push(line);
    else if (!seen) {
      out.push(OFFLINE_LINE);
      seen = true;
    }
  }
  return out;
}

function runBudgetSessionStart({ root, packRoot }) {
  try {
    const out = runText(process.execPath, [join(packRoot, 'scripts', 'budget.mjs'), 'session-start', '--root', root]);
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (err) {
    return [`budget session start failed: ${String(err.stderr || err.message).split('\n')[0]}`];
  }
}

export async function sessionStart({ root, packRoot, update = runUpdate, refresh = refreshOverride }) {
  const lines = [];
  try {
    lines.push(...collapseOffline((await update({ root, packRoot, safetyOnly: true })).lines));
  } catch (err) {
    lines.push(isNetworkFailure(err) ? OFFLINE_LINE : `pack update failed: ${oneLine(err?.message) || 'unknown error'}`);
  }
  // Runs after the update step because that step can replace AGENTS.student.md. An unwritable folder costs one line.
  try {
    const res = refresh({ root, packRoot });
    if (res.line) lines.push(res.line);
  } catch (err) {
    lines.push(`AGENTS.override.md not refreshed (${oneLine(err.message) || 'write failed'})`);
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

if (isMain(import.meta.url)) await runCli(main);
