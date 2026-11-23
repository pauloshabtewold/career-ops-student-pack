// Starts and stops the automation Chrome for the e2e tests. A test asks gate() first: no slot command outside CI, a slot
// hook that answers non-zero, or no Chrome binary each mean skip with the reason. openChrome() goes through chrome.mjs
// open, which runs the slot hook again before its launch; stopAll() stops only PIDs this harness recorded.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { loadStudentConfig } from '../../lib/config.mjs';
import { findChrome, readState, resolveSlotCommand } from '../../scripts/chrome.mjs';
import { PACK_ROOT } from './script-harness.mjs';

export const CHROME_CLI = join(PACK_ROOT, 'scripts', 'chrome.mjs');
// Points the harness at a career-ops root whose config/student.yml it reads; unset means the pack's default root.
export const ROOT_ENV = 'CHROME_E2E_ROOT';
export const NO_SLOT_REASON = 'no browser slot command configured';
const CLI_TIMEOUT_MS = 60000;

const recorded = new Set();

export function runChromeCli(args, { root, dataDir, env = process.env } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CHROME_CLI, ...args, '--root', root, '--data-dir', dataDir], { cwd: PACK_ROOT, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// Returns the skip reason, or null when a Chrome e2e test may run.
export async function gate({ env = process.env } = {}) {
  const config = await loadStudentConfig(env[ROOT_ENV] ? { root: env[ROOT_ENV] } : {});
  if (!resolveSlotCommand({ env, config }) && !env.CI) return NO_SLOT_REASON;
  if (!findChrome({ env })) return 'no Chrome binary found';
  return null;
}

// Opens the automation Chrome for one test root. A slot hook that answers non-zero becomes { skip } with its exit code.
export async function openChrome({ root, dataDir, env = process.env }) {
  if (recorded.size > 0) throw new Error('chrome-harness: one automation Chrome per test file');
  // Headless: no test needs a window, and a visible Chrome on a locked or busy desktop can stall its first navigation.
  const out = await runChromeCli(['open', '--headless'], { root, dataDir, env });
  const wait = out.stdout.match(/waiting for a browser slot \(hook exit (\d+)\)/);
  if (out.code === 4) return { ...out, skip: `browser slot hook exit ${wait ? wait[1] : 'non-zero'}` };
  const state = out.code === 0 ? readState(dataDir) : null;
  if (state?.pid) recorded.add(state.pid);
  return { ...out, state, skip: null };
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Teardown: chrome.mjs close first; any PID this harness recorded that is still alive is stopped directly.
export async function stopAll({ root, dataDir, env = process.env }) {
  if (recorded.size === 0) return;
  await runChromeCli(['close'], { root, dataDir, env });
  for (const pid of recorded) if (alive(pid)) process.kill(pid);
  recorded.clear();
}

export { alive };
