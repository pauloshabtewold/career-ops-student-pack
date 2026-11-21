// One way to call a model without a person watching, shared by every new caller (cover letters, outreach drafts,
// unknown questions, reviewer, outcome classification). It keeps the lockdown the daily triage proved: no tools, project
// settings only, no MCP servers, the CLAUDE.md exclusion, an empty temp folder and the prompt on stdin, so posting or
// mail text cannot make the model act and the fixed token cost per call is the same for every student. Every call
// appends a usage-ledger row with the tokens the agent reported.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODEX_DISABLED_FEATURES, CODEX_EXTRA_FLAGS, agentCallOptions, quoteIf, resolveAgentPath, shellForm } from './agent.mjs';
import { runText } from './run.mjs';
import { withTempDir } from './temp-dir.mjs';
import { append, ledgerRow } from './usage-ledger.mjs';

const PACK_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// Drafting runs at the mid tier. opus needs allowTop: the A/B judge (once per comparison) and the reviewer when the
// student chose spend_tier premium, which is how v0.4 ran it.
export const MID = Object.freeze({ claude: 'sonnet', codex: 'medium' });
export const JUDGE_MODEL = 'opus';

// A headless agent call failed or was refused.
export class HeadlessError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'HeadlessError';
    this.cause = cause;
  }
}

// Claude's usage object (claude -p --output-format json, or the result event of stream-json) as ledger columns. Every
// caller goes through this one mapping so a change in the CLI's usage fields is fixed in one place.
export const normalizeUsage = (u) => (u ? { input: u.input_tokens ?? 0, cache_read: u.cache_read_input_tokens ?? 0, cache_write: u.cache_creation_input_tokens ?? 0, output: u.output_tokens ?? 0 } : null);

// claude -p --output-format json: result text, usage, and modelUsage keyed by the resolved model id.
// A reply that is not JSON (an older client or a wrapper script) keeps its text and is recorded as unmeasured.
export function parseClaude(stdout) {
  let obj;
  try {
    obj = JSON.parse(stdout);
  } catch {
    return { text: String(stdout ?? ''), model: null, usage: null };
  }
  return {
    text: String(obj.result ?? ''),
    model: Object.keys(obj.modelUsage ?? {}).join(',') || null,
    usage: normalizeUsage(obj.usage),
  };
}

// codex exec --json: usage arrives on turn.completed events, summed over the call. input is codex's input_tokens as
// reported (cached input included); cache_read records the cached share of it.
export function parseCodex(stdout) {
  let usage = null;
  let text = '';
  let model = null;
  for (const line of String(stdout).split('\n')) {
    if (!line.trim().startsWith('{')) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.model) model = ev.model;
    if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') text = String(ev.item.text ?? '');
    if (ev.type === 'turn.completed' && ev.usage) {
      usage ??= { input: 0, cache_read: 0, cache_write: 0, output: 0 };
      usage.input += ev.usage.input_tokens ?? 0;
      usage.cache_read += ev.usage.cached_input_tokens ?? 0;
      usage.output += ev.usage.output_tokens ?? 0;
    }
  }
  return { text, model, usage };
}

// json false keeps the plain-text reply for a caller whose argv is pinned elsewhere; its ledger row then says unmeasured.
export function claudeArgs({ model, shell, packRoot = PACK_ROOT, json = true }) {
  const settings = join(packRoot, 'templates', 'triage-claude-settings.json');
  return ['-p', '--tools', shell ? '""' : '', '--setting-sources', 'project', '--strict-mcp-config', '--settings', quoteIf(shell, settings), '--model', model, ...(json ? ['--output-format', 'json'] : [])];
}

// argv for codex exec: no approval prompts, ephemeral session, read-only sandbox.
export function codexArgs({ effort, tmp, out, shell }) {
  return [
    '-a', 'never', 'exec', '--json', '--ephemeral', '--skip-git-repo-check', ...CODEX_EXTRA_FLAGS, '-s', 'read-only', '--color', 'never',
    ...CODEX_DISABLED_FEATURES.flatMap((f) => ['--disable', f]),
    '-c', `model_reasoning_effort=${effort}`, '-C', quoteIf(shell, tmp), '-o', quoteIf(shell, out), '-',
  ];
}

function callOnce({ agent, agentPath, model, effort, prompt, runner, platform, packRoot, tempPrefix, json }) {
  const shell = shellForm(agentPath, platform);
  return withTempDir(tempPrefix ?? `headless-${agent}-`, (tmp) => {
    const opts = agentCallOptions({ cwd: tmp, prompt, shell, agentPath });
    if (agent === 'claude') return parseClaude(runner(quoteIf(shell, agentPath), claudeArgs({ model, shell, packRoot, json }), opts));
    const out = join(tmp, 'last.txt');
    const parsed = parseCodex(runner(quoteIf(shell, agentPath), codexArgs({ effort, tmp, out, shell }), opts));
    const last = existsSync(out) ? readFileSync(out, 'utf8') : '';
    return { ...parsed, text: last.trim() ? last : parsed.text };
  });
}

/**
 * runHeadless({ agent, model?, effort?, prompt, step, feature, dataDir, date, rows?, allowTop?, runner?, agentPath?, tempPrefix?, json? })
 * tempPrefix names the empty temp folder the call runs in, so each caller's folders stay recognizable.
 * Returns { text, model, usage }. usage is null when the agent reported none; the ledger row then says unmeasured.
 */
export async function runHeadless({ agent = 'claude', model, effort, prompt, step, feature, dataDir, date, rows = 1, allowTop = false, source = 'scheduled', tempPrefix, json = true, runner = runText, agentPath, platform = process.platform, packRoot = PACK_ROOT }) {
  const resolvedModel = model ?? MID.claude;
  if (agent === 'claude' && resolvedModel === JUDGE_MODEL && !allowTop) throw new HeadlessError('opus needs allowTop; drafting runs at the mid tier');
  const path = agentPath ?? resolveAgentPath(agent);
  if (!path) throw new HeadlessError(`${agent} was not found`);
  let res;
  try {
    res = callOnce({ agent, agentPath: path, model: resolvedModel, effort: effort ?? MID.codex, prompt, runner, platform, packRoot, tempPrefix, json });
  } catch (err) {
    throw new HeadlessError(`${agent} call failed: ${String(err.stderr || err.message).split('\n')[0]}`, err);
  }
  if (dataDir) {
    const label = agent === 'claude' ? res.model ?? resolvedModel : res.model ?? `codex-${effort ?? MID.codex}`;
    await append(dataDir, ledgerRow({ date: date ?? new Date().toISOString().slice(0, 10), step, feature, agent, model: label, rows, usage: res.usage, source }));
  }
  return res;
}
