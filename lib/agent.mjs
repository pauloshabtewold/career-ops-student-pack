// What differs between the two agents that can run the unattended triage: how to find the binary, the flags a Codex
// call must carry, and the sign-in step to tell the student. Node built-ins only.
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, posix } from 'node:path';
import { which } from './which.mjs';

export const AGENTS = ['claude', 'codex'];
// Each feature is a way for posting text to reach a tool or the network; the triage call needs none of them. A live
// listing run (codex-cli 0.166) still showed image generation (spends plan quota), view_image (reads files anywhere under
// the read-only sandbox) and the goal tools until those three were disabled too.
export const CODEX_DISABLED_FEATURES = ['apps', 'plugins', 'browser_use', 'in_app_browser', 'computer_use', 'shell_tool', 'hooks', 'image_generation', 'goals', 'view_image'];
// --ignore-user-config keeps the student's own ~/.codex settings (MCP servers, hooks) out of an unattended call.
export const CODEX_EXTRA_FLAGS = ['--ignore-user-config', '-c', 'web_search=disabled'];
export const AGENT_TIMEOUT_MS = 15 * 60 * 1000;

export const signInHint = (agent) => `run ${agent} once in a terminal to sign in`;

const BUNDLE_TAIL = ['ChatGPT.app', 'Contents', 'Resources', 'codex-cli', 'bin', 'codex'];

// The ChatGPT desktop app ships a codex binary that is not on PATH.
export function knownLocations(agent, { platform = process.platform, home = homedir() } = {}) {
  if (agent !== 'codex' || platform !== 'darwin') return [];
  // macOS-only locations, so posix joins keep them identical wherever the code runs (tests on Windows CI).
  return [posix.join('/Applications', ...BUNDLE_TAIL), posix.join(home, 'Applications', ...BUNDLE_TAIL)];
}

export function resolveAgentPath(agent, { env = process.env, platform = process.platform, home = homedir(), exists = existsSync } = {}) {
  return which(agent, { env, platform }) ?? knownLocations(agent, { platform, home }).find((p) => exists(p)) ?? null;
}

const AGENT_MAX_BUFFER = 64 * 1024 * 1024;

const realDir = (file) => {
  try {
    return dirname(realpathSync(file));
  } catch {
    return dirname(file);
  }
};

// launchd starts the job with PATH=/usr/bin:/bin:/usr/sbin:/sbin, where an npm-installed agent (a `#!/usr/bin/env node`
// script) cannot find node. The node running this script and the agent's own folder go first.
export function agentEnv(agentPath) {
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  return { ...process.env, [key]: [dirname(process.execPath), realDir(agentPath), process.env[key]].filter(Boolean).join(delimiter) };
}

// Options for one unattended agent call: the prompt on stdin, captured output, and the shell form for Windows shims.
export const agentCallOptions = ({ cwd, prompt, shell, agentPath }) => ({ cwd, input: prompt, env: agentEnv(agentPath), timeout: AGENT_TIMEOUT_MS, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: AGENT_MAX_BUFFER, ...(shell ? { shell: true } : {}) });

// A .cmd or .bat shim on Windows only starts through a shell.
export const shellForm = (path, platform = process.platform) => platform === 'win32' && /\.(cmd|bat)$/i.test(path);
// cmd.exe splits an unquoted path at a space, so the shell form quotes paths.
export const quoteIf = (shell, value) => (shell ? `"${value}"` : value);

// The Gmail tools the unattended inbox pass may call: search, read one thread or message, list labels. Claude names are
// the connector's full tool names as a live `claude -p --output-format stream-json --verbose` init event lists them.
const claudeGmail = (names) => Object.freeze(names.map((n) => `mcp__claude_ai_Gmail__${n}`));
export const CLAUDE_GMAIL_READ_TOOLS = claudeGmail(['search_threads', 'get_thread', 'get_message', 'list_labels']);
// Every other tool of the connector (the same live listing): all that send, draft, label, archive, trash or delete, plus
// the two draft readers, which the pass never needs.
export const CLAUDE_GMAIL_WRITE_TOOLS = claudeGmail([
  'apply_sensitive_message_label', 'apply_sensitive_thread_label', 'create_draft', 'create_label', 'delete_draft', 'delete_label',
  'forward', 'get_draft', 'label_message', 'label_thread', 'list_drafts', 'mark_message_spam', 'mark_thread_spam', 'reply',
  'send_message', 'trash_message', 'trash_thread', 'unlabel_message', 'unlabel_thread', 'unmark_message_spam',
  'unmark_thread_spam', 'untrash_message', 'untrash_thread', 'update_draft', 'update_label', 'update_message_labels',
]);

// Codex keys app settings by the Gmail connector's own id, which is the same for every account
// (templates/codex-config.suggested.toml uses it too).
export const CODEX_GMAIL_CONNECTOR_ID = 'connector_2128aebfecb84f64a069897515042a44';
export const CODEX_GMAIL_WRITE_TOOLS = Object.freeze([
  'send_email', 'send_draft', 'forward_emails', 'delete_emails', 'archive_emails', 'create_draft', 'update_draft',
  'batch_modify_email', 'apply_labels_to_emails', 'bulk_label_matching_emails', 'create_label',
]);
export const CODEX_GMAIL_READ_TOOLS = Object.freeze(['gmail_search_emails', 'gmail_read_email']);

// `-c` overrides that switch the write tools off for one `codex exec` call, so the call is read-only even when the
// student's .codex/config.toml is ignored (--ignore-user-config).
export const codexGmailDisableFlags = () => CODEX_GMAIL_WRITE_TOOLS.flatMap((tool) => ['-c', `apps.${CODEX_GMAIL_CONNECTOR_ID}.tools.${tool}.enabled=false`]);

// Allow-list for the Gmail connector: every other app is off (apps._default), the Gmail connector is on with tools not
// named switched off (default_tools_enabled) and only the two read tools on. codex-cli 0.167 has no exec flag for this;
// the keys come from its apps config schema (AppsDefaultConfig enabled, destructive_enabled, open_world_enabled;
// AppConfig default_tools_enabled; AppToolsConfig enabled) and have not been confirmed against a live tool listing. If
// a key is ignored, the write-tool deny flags above still apply and auditRun discards a run that called anything else;
// if the read tool names are wrong, the pass finds no Gmail search and fails closed. Claude stays the recommended
// unattended backend, where --allowedTools is a true allow-list.
export const codexGmailAllowFlags = () => [
  '-c', 'apps._default.enabled=false',
  '-c', 'apps._default.destructive_enabled=false',
  '-c', 'apps._default.open_world_enabled=false',
  '-c', `apps.${CODEX_GMAIL_CONNECTOR_ID}.enabled=true`,
  '-c', `apps.${CODEX_GMAIL_CONNECTOR_ID}.default_tools_enabled=false`,
  ...CODEX_GMAIL_READ_TOOLS.flatMap((tool) => ['-c', `apps.${CODEX_GMAIL_CONNECTOR_ID}.tools.${tool}.enabled=true`]),
];
