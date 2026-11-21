#!/usr/bin/env node
// The automation Chrome: a dedicated --user-data-dir in the career-ops data folder that the student signs in to once
// (LinkedIn, Gmail, Handshake), driven over the DevTools port by lib/cdp.mjs. Chrome 136+ refuses remote debugging on the
// default profile, and a separate profile keeps the student's everyday browsing out of reach, so the default profile is
// never touched. Claude Code, Codex and a scheduled run all reach the same browser through this one CLI.
// Usage: chrome.mjs open [--headless] | status [--json] | read <url> | close   [--root R] [--data-dir D]
// Exit codes: 0 ok, 1 close could not stop Chrome, 2 usage, 4 waiting for a browser slot, 7 automation Chrome not running
// or its profile held by a Chrome this CLI did not record. 5 stays the pack's "needs the
// user" code, so a caller never mistakes a stopped browser for a question to the student.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { UsageError, isMain, parseArgs, runCli } from '../lib/args.mjs';
import { readText, openPage, withBrowser } from '../lib/cdp.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { isPidAlive, withLock } from '../lib/dir-lock.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { which } from '../lib/which.mjs';

export const STATE_FILE = '.chrome-automation';
export const PROFILE_DIR = 'chrome-automation';
export const EXIT = Object.freeze({ ok: 0, stuck: 1, usage: 2, wait: 4, notRunning: 7 });
const PORT_WAIT_MS = 20 * 1000;
const SLOT_TIMEOUT_MS = 60 * 1000;
// A second open waits out the first one's slot command and port wait, then finds its Chrome live and reuses it.
const OPEN_LOCK_MS = SLOT_TIMEOUT_MS + PORT_WAIT_MS + 30 * 1000;
const EXIT_WAIT_MS = 10 * 1000;
const KILL_WAIT_MS = 3 * 1000;

// Splits a command string into argv without a shell: double or single quotes group words, and a leading ~ is HOME.
export function splitCommand(text, home = homedir()) {
  const words = [...String(text).matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  return words.map((w, i) => (i === 0 && (w === '~' || w.startsWith('~/')) ? join(home, w.slice(1)) : w));
}

// The environment wins so one shell can override; config is the fallback that launchd, Task Scheduler and Codex shells
// can read, since none of them carries the student's shell variables.
export function resolveSlotCommand({ env = process.env, config = null } = {}) {
  const fromEnv = String(env.BROWSER_SLOT_CMD ?? '').trim();
  if (fromEnv) return fromEnv;
  const fromConfig = String(config?.browser?.slot_cmd ?? '').trim();
  return fromConfig || null;
}

// Runs the configured browser-slot command without a shell and returns its exit status, or the spawn error code (such
// as ENOENT) when it cannot start, so a misconfigured command is told apart from a busy slot.
export function runSlotCommand(command, { run = spawnSync, home = homedir() } = {}) {
  const [cmd, ...args] = splitCommand(command, home);
  const res = run(cmd, args, { stdio: 'ignore', timeout: SLOT_TIMEOUT_MS, windowsHide: true });
  if (res.error) return res.error.code ?? 1;
  return typeof res.status === 'number' ? res.status : 1;
}

// Per-platform install locations; Linux relies on PATH.
export function chromeCandidates({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  if (platform === 'darwin') {
    const app = ['Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'];
    return [join('/Applications', ...app), join(home, 'Applications', ...app)];
  }
  if (platform === 'win32') {
    const tail = join('Google', 'Chrome', 'Application', 'chrome.exe');
    return [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean).map((base) => join(base, tail));
  }
  return [];
}

// First existing listed Chrome path. On Linux falls back to PATH names; null when nothing is found.
export function findChrome({ platform = process.platform, env = process.env, home = homedir(), exists = existsSync } = {}) {
  const listed = chromeCandidates({ platform, env, home }).find((p) => exists(p));
  if (listed) return listed;
  if (platform === 'darwin' || platform === 'win32') return null;
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const found = which(name, { env, platform });
    if (found) return found;
  }
  return null;
}

// Parsed state file, or null when it is missing or unreadable.
export function readState(dataDir) {
  const file = join(dataDir, STATE_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// 0600 because the port is a key to a signed-in browser.
export function writeState(dataDir, state) {
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, STATE_FILE);
  writeFileSync(file, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

// True when the debugging port answers /json/version within 3 seconds.
// Two tries: a Chrome still busy right after its first launch (fresh profile, slow CI runner) can miss one 3 s probe. A
// closed port refuses at once, so a dead instance costs no wait.
export async function reachable(port, { fetchFn = fetch } = {}) {
  if (!port) return false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchFn(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      // timed out or refused; try once more
    }
  }
  return false;
}

// A recorded instance counts only when its own PID is alive and its port answers; anything else is stale.
export async function liveState(dataDir, deps = {}) {
  const state = readState(dataDir);
  if (!state) return null;
  const alive = (deps.isAlive ?? isPidAlive)(state.pid);
  return alive && (await reachable(state.port, deps)) ? state : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Chrome on macOS and Linux keeps a SingletonLock symlink in the profile whose target ends in -<pid> of the Chrome
// holding it. Windows has no such link, so this returns null there.
export function profileLockPid(profile) {
  try {
    const m = /-(\d+)$/.exec(readlinkSync(join(profile, 'SingletonLock')));
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

// True when a running Chrome owns profile: the SingletonLock PID is alive, or the port in DevToolsActivePort answers.
async function profileHeld(profile, deps) {
  const lockPid = profileLockPid(profile);
  if (lockPid && (deps.isAlive ?? isPidAlive)(lockPid)) return true;
  const file = join(profile, 'DevToolsActivePort');
  if (!existsSync(file)) return false;
  return reachable(Number(readFileSync(file, 'utf8').split('\n')[0]), deps);
}

// The recorded PID is still our Chrome when it is alive and either its port answers or the profile lock names it; a
// live PID with neither may have been reused by another process after a crash or reboot.
async function recordedChromeAlive(state, profile, deps) {
  if (!(deps.isAlive ?? isPidAlive)(state.pid)) return false;
  return (await reachable(state.port, deps)) || profileLockPid(profile) === state.pid;
}

async function waitGone(pid, ms, { now = Date.now, wait = sleep, isAlive = isPidAlive } = {}) {
  const until = now() + ms;
  while (isAlive(pid)) {
    if (now() >= until) return false;
    await wait(200);
  }
  return true;
}

// SIGTERM first so Chrome flushes the profile, SIGKILL only after the exit wait. Returns once the PID is gone (true) or
// both waits ran out (false): the profile files stay locked until the process has exited.
export async function stopChrome(pid, deps = {}) {
  const kill = deps.kill ?? process.kill;
  const signal = (sig) => {
    try {
      kill(pid, sig);
    } catch {
      // already exited
    }
  };
  signal('SIGTERM');
  if (await waitGone(pid, EXIT_WAIT_MS, deps)) return true;
  // On Windows process.kill ends only the browser process; its renderer, GPU and utility children keep the profile files
  // open, so the whole tree goes.
  if ((deps.platform ?? process.platform) === 'win32') (deps.run ?? spawnSync)('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else signal('SIGKILL');
  return waitGone(pid, KILL_WAIT_MS, deps);
}

// Windows keeps profile files open until the last Chrome child exits, and refuses to rename a folder while any file in it
// is open: a rename and rename back succeeding means the profile is free. Bounded, so a stuck child never hangs close.
// Other platforms release the profile with the browser process.
async function waitProfileReleased(profile, { platform = process.platform, now = Date.now, wait = sleep, rename = renameSync } = {}) {
  if (platform !== 'win32' || !existsSync(profile)) return;
  const probe = `${profile}.closing`;
  const until = now() + EXIT_WAIT_MS;
  while (now() < until) {
    try {
      rename(profile, probe);
      rename(probe, profile);
      return;
    } catch {
      await wait(250);
    }
  }
}

// Chrome writes the port it picked for --remote-debugging-port=0 on the first line of DevToolsActivePort.
async function waitForPort(profile, { now = Date.now, wait = sleep } = {}) {
  const file = join(profile, 'DevToolsActivePort');
  const until = now() + PORT_WAIT_MS;
  while (now() < until) {
    if (existsSync(file)) {
      const port = Number(readFileSync(file, 'utf8').split('\n')[0]);
      if (Number.isInteger(port) && port > 0) return port;
    }
    await wait(200);
  }
  return null;
}

// Chrome flags: dedicated profile directory, debugging port bound to loopback only.
export function launchArgs(profile, { headless = false } = {}) {
  return [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--remote-debugging-address=127.0.0.1',
    '--no-first-run',
    '--no-default-browser-check',
    ...(headless ? ['--headless=new'] : []),
  ];
}

// Profile directory from config.browser.automation_profile, else the default under dataDir.
export function profilePath(config, dataDir) {
  return String(config?.browser?.automation_profile ?? '').trim() || join(dataDir, PROFILE_DIR);
}

// Serialized so two callers (Claude Code, Codex, a scheduled run) never launch on the same profile at once.
async function cmdOpen(ctx) {
  mkdirSync(ctx.dataDir, { recursive: true });
  return withLock(join(ctx.dataDir, STATE_FILE), () => openLocked(ctx), { timeoutMs: OPEN_LOCK_MS });
}

async function openLocked({ dataDir, config, flags, deps, say }) {
  const slot = resolveSlotCommand({ env: deps.env ?? process.env, config });
  if (!slot) say('chrome: no browser slot command set');
  const live = await liveState(dataDir, deps);
  if (live) {
    say(`chrome: ready ${live.profile ?? profilePath(config, dataDir)}`);
    return EXIT.ok;
  }
  if (slot) {
    const code = (deps.runSlot ?? runSlotCommand)(slot);
    if (code !== 0) {
      say(`chrome: waiting for a browser slot (hook exit ${code})`);
      return EXIT.wait;
    }
  }
  const binary = (deps.findChrome ?? findChrome)({ env: deps.env ?? process.env });
  if (!binary) {
    say('chrome: Google Chrome was not found; install Chrome, then run this again');
    return EXIT.notRunning;
  }
  const profile = profilePath(config, dataDir);
  mkdirSync(profile, { recursive: true });
  // Deleting a live instance's DevToolsActivePort would leave it unreachable, and Chrome hands a second launch on the
  // same profile to that instance, so a held profile is reported instead.
  if (await profileHeld(profile, deps)) {
    say(`chrome: a Chrome this command did not record holds the profile ${profile}; quit that Chrome, then run open again`);
    return EXIT.notRunning;
  }
  rmSync(join(profile, 'DevToolsActivePort'), { force: true });
  const child = (deps.spawn ?? spawn)(binary, launchArgs(profile, { headless: Boolean(flags.headless) }), { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref?.();
  const port = await waitForPort(profile, deps);
  if (!port) {
    await stopChrome(child.pid, deps);
    say(`chrome: Chrome started but opened no DevTools port within 20 seconds; stopped it (PID ${child.pid})`);
    return EXIT.notRunning;
  }
  writeState(dataDir, { port, pid: child.pid, profile, started: new Date().toISOString() });
  say(`chrome: ready ${profile}`);
  return EXIT.ok;
}

async function cmdStatus({ dataDir, flags, deps, say }) {
  const live = await liveState(dataDir, deps);
  const out = { reachable: live ? 'yes' : 'no', port: live?.port ?? null, profile: live?.profile ?? null };
  say(flags.json ? JSON.stringify(out) : `reachable ${out.reachable}${live ? ` port ${live.port}` : ''}`);
  return EXIT.ok;
}

async function cmdRead({ dataDir, positionals, deps, say }) {
  const url = positionals[0];
  if (!url) throw new UsageError('read needs a url');
  const live = await liveState(dataDir, deps);
  if (!live) {
    say('chrome: automation Chrome is not running; run node student/scripts/chrome.mjs open');
    return EXIT.notRunning;
  }
  const text = await withBrowser(live.port, async (client) => {
    const { sessionId, targetId } = await openPage(client, url);
    try {
      return await readText(client, sessionId);
    } finally {
      await client.send('Target.closeTarget', { targetId }).catch(() => {});
    }
  }, deps);
  say(text);
  return EXIT.ok;
}

// Stops only the PID this CLI recorded, never anything found by name, and only while recordedChromeAlive confirms it:
// the state file outlives a crash or reboot, after which the recorded PID can belong to another process. The state file
// is kept while that Chrome is still running, so a later close can still stop it.
async function cmdClose({ dataDir, config, deps, say }) {
  const state = readState(dataDir);
  const profile = state?.profile ?? profilePath(config, dataDir);
  if (state?.pid && (await recordedChromeAlive(state, profile, deps))) {
    // Browser.close first: Chrome shuts every child down and flushes the profile; signals are the fallback.
    if (state.port) await withBrowser(state.port, (client) => client.send('Browser.close').catch(() => {}), deps).catch(() => {});
    if (!(await waitGone(state.pid, EXIT_WAIT_MS, deps)) && !(await stopChrome(state.pid, deps))) {
      say(`chrome: Chrome (PID ${state.pid}) did not exit; run close again`);
      return EXIT.stuck;
    }
    await waitProfileReleased(profile, deps);
  }
  rmSync(join(dataDir, STATE_FILE), { force: true });
  say('chrome: closed');
  return EXIT.ok;
}

export const HANDLERS = { open: cmdOpen, status: cmdStatus, read: cmdRead, close: cmdClose };
export const COMMANDS = Object.keys(HANDLERS);
export const FLAGS = { headless: 'boolean' };

// Config is optional: status must work before setup has written config/student.yml.
async function readConfig(root) {
  try {
    return await loadStudentConfig({ root });
  } catch {
    return null;
  }
}

// Parses argv, loads optional config, and dispatches to the command handler.
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { command, positionals, flags } = parseArgs(argv, { commands: COMMANDS, flags: FLAGS });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const config = await readConfig(paths.root);
  const say = deps.say ?? ((line) => console.log(line));
  return HANDLERS[command]({ dataDir: paths.dataDir, paths, config, flags, positionals, deps, say });
}

if (isMain(import.meta.url)) await runCli(() => main());
