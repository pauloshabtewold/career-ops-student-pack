// What differs between the two agents that can run the unattended triage: how to find the binary, the flags a Codex
// call must carry, and the sign-in step to tell the student. Node built-ins only.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix } from 'node:path';
import { which } from './which.mjs';

export const AGENTS = ['claude', 'codex'];
// Each feature is a way for posting text to reach a tool or the network; the triage call needs none of them.
export const CODEX_DISABLED_FEATURES = ['apps', 'plugins', 'browser_use', 'in_app_browser', 'computer_use', 'shell_tool', 'hooks'];
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

// A .cmd or .bat shim on Windows only starts through a shell.
export const shellForm = (path, platform = process.platform) => platform === 'win32' && /\.(cmd|bat)$/i.test(path);
// cmd.exe splits an unquoted path at a space, so the shell form quotes paths.
export const quoteIf = (shell, value) => (shell ? `"${value}"` : value);
