// Fixtures for the inbox-pass tests: a scratch root with a config, applications.md and a data folder, canned claude
// stream-json and codex --json output, and a fake runner(cmd, args, opts) that never starts a real agent. The runner is
// synchronous like daily-triage's: it returns the agent's stdout or throws an error with { status, stderr, code }.
// Assumed event shapes: claude stream-json has {type:'assistant', message:{content:[{type:'tool_use', name}]}} blocks and a
// final {type:'result', result:<text>}; codex --json has {type:'item.completed', item:{type:'mcp_tool_call', tool}} items.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { resolvePaths } from '../../lib/paths.mjs';
import { CLAUDE_GMAIL_READ_TOOLS, CLAUDE_GMAIL_WRITE_TOOLS } from '../../lib/agent.mjs';
import { PACK_ROOT, TODAY, makeRoot } from './script-harness.mjs';

export { PACK_ROOT, TODAY };
export const NOW = Date.parse('2026-10-27T12:00:00.000Z');
export const FRESH = '2026-10-26T15:00:00.000Z';
export const ON = 'agent: claude\nmailbox:\n  backend: connector\n  schedule: on\n';
export const CLAUDE = '/opt/sample/bin/claude';
export const CODEX = '/opt/sample/bin/codex';
export const SEARCH = CLAUDE_GMAIL_READ_TOOLS.find((t) => /search/.test(t));
export const WRITE_TOOL = CLAUDE_GMAIL_WRITE_TOOLS[0];
export const digestFile = `data/digest/student-${TODAY}.md`;

const APPS = [
  '# Applications',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-10-10 | Northwind Robotics | Data Intern | 4.2/5 | Applied | no | none | |',
  '| 2 | 2026-10-11 | Contoso Analytics | Analyst Intern | 4.0/5 | Applied | no | none | |',
  '',
].join('\n');

export function makeInboxRoot({ config = ON } = {}) {
  const r = makeRoot({ config });
  r.write('data/applications.md', APPS);
  return r;
}

export const unquote = (s) => String(s).replace(/^"(.*)"$/, '$1');
const line = (o) => JSON.stringify(o);

export const msg = (id, from, subject, snippet = 'Hello.', extra = {}) => ({ id, from, subject, snippet, date: FRESH, ...extra });
export const handshakeJob = { title: 'Analyst Intern', company: 'Wingtip Partners', location: 'Austin, TX', job_id: '8800123', site: 'handshake' };
export const handshakeAlert = (id = 'a-1') => msg(id, 'Handshake <no-reply@joinhandshake.com>', 'New job match', 'New job match.', { jobs: [handshakeJob] });
export const plainMail = (id = 'p-1') => msg(id, 'Friend <friend@example.org>', 'Hello', 'Lunch on Friday?');

export const answerText = (messages, notRead = 0) => JSON.stringify({ messages, not_read: notRead });

// A claude stream-json transcript. tools are the tool_use names the run made; the init event lists every tool so a test
// can prove the audit reads tool_use blocks and not the init list.
export function claudeStream({ tools = [SEARCH], answer = answerText([]) } = {}) {
  return [
    line({ type: 'system', subtype: 'init', tools: [...CLAUDE_GMAIL_READ_TOOLS, ...CLAUDE_GMAIL_WRITE_TOOLS, 'Bash'] }),
    ...tools.map((name, i) => line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${i}`, name, input: {} }] } })),
    line({ type: 'result', subtype: 'success', is_error: false, result: answer }),
  ].join('\n');
}

export function codexEvents({ tools = ['gmail_search_emails'] } = {}) {
  return [
    line({ type: 'thread.started', thread_id: 'th-1' }),
    ...tools.map((tool) => line({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'codex_apps', tool, status: 'completed' } })),
    line({ type: 'turn.completed' }),
  ].join('\n');
}

// handlers: claude(args, opts) -> stdout or throws; codex(args, opts, out) -> stdout or throws (write the -o file at `out`);
// child(args, opts) -> stdout for process.execPath calls (merge-post.mjs). Each child call records the inbox JSON and
// the staging file as they were during the call.
export function makeAgentRunner(r, { claude = () => claudeStream(), codex = (args, opts, out) => (writeFileSync(out, answerText([])), codexEvents()), child = () => '' } = {}) {
  const calls = { claude: [], codex: [], child: [] };
  const read = (rel) => (existsSync(r.file(rel)) ? readFileSync(r.file(rel), 'utf8') : null);
  const runner = (cmd, args, opts = {}) => {
    const name = unquote(cmd);
    if (name === process.execPath) {
      calls.child.push({ args, opts, script: basename(args[0]), json: read(`data/inbox-${TODAY}.json`), staging: read('data/pipeline.staging.md') });
      return child(args, opts);
    }
    if (basename(name).toLowerCase().startsWith('codex')) {
      const out = unquote(args[args.indexOf('-o') + 1]);
      calls.codex.push({ cmd, args, opts, out });
      return codex(args, opts, out);
    }
    calls.claude.push({ cmd, args, opts });
    return claude(args, opts);
  };
  return { runner, calls };
}

export const failing = (props) => () => {
  throw Object.assign(new Error('Command failed'), props);
};

// Runs inboxPass against the scratch root. inboxDeps.runner (set-status and plugins calls) is a recording no-op.
export async function runPass(r, { inboxPass, handlers, agent = 'claude', agentPath = CLAUDE, check = false, platform = process.platform, inboxDeps = {}, now = () => NOW } = {}) {
  const { runner, calls } = makeAgentRunner(r, handlers);
  // A literal config: loading config/student.yml would reject mailbox.schedule until the schema accepts it.
  const config = Object.freeze({ timezone: 'America/Chicago', agent, spend_tier: 'standard', automation: 'manual', mailbox: Object.freeze({ backend: 'connector', schedule: 'on' }) });
  const statusCalls = [];
  const lines = [];
  const deps = {
    runner: async (argv, opts) => (statusCalls.push({ argv, opts }), { code: 0, stdout: '' }),
    assessmentDomains: ['assess.example.com'],
    findAtEmployer: async () => ({ url: null, how: 'none' }),
    out: (l) => lines.push(String(l)),
    ...inboxDeps,
  };
  const result = await inboxPass({ paths: resolvePaths({ root: r.root, dataDir: r.data }), config, agent, agentPath, today: TODAY, check, runner, platform, now, inboxDeps: deps });
  return { result, calls, statusCalls, lines };
}

export const digestOf = (r) => (r.exists(digestFile) ? r.read(digestFile) : '');
export const staging = (r) => (r.exists('data/pipeline.staging.md') ? r.read('data/pipeline.staging.md') : '');
