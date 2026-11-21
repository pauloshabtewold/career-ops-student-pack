#!/usr/bin/env node
// The automation Chrome: a dedicated --user-data-dir in the career-ops data folder that the student signs in to once
// (LinkedIn, Gmail, Handshake), driven over the DevTools port by lib/cdp.mjs. Chrome 136+ refuses remote debugging on the
// default profile, and a separate profile keeps the student's everyday browsing out of reach, so the default profile is
// never touched. Claude Code, Codex and a scheduled run all reach the same browser through this one CLI.
// Usage: chrome.mjs open [--headless] | status [--json] | read <url> | close
//        chrome.mjs fill --plan FILE | submit --batch-id ID --item N   [--root R] [--data-dir D]
// fill types into the form by field map and never into a password field or an SSN, card or bank field (those are listed
// as blocked-on-user and the fill exits 5 after the rest is filled); a CAPTCHA or bot check stops it and moves the
// job to the batch's finish-yourself list. submit clicks only after budget.mjs check passes for the approved item.
// Exit codes: 0 ok, 1 close could not stop Chrome, 2 usage, 3 refused (password field, or budget.mjs refused the submit),
// 4 wait (browser slot or budget.mjs wait), 5 needs the user (budget.mjs exit 5 passed through, a sensitive field left
// for the student, or a submit that clicked but could not be logged), 6 CAPTCHA or bot check (finish it yourself), 7 automation Chrome not running or its profile
// held by a Chrome this CLI did not record.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { UsageError, isMain, parseArgs, runCli } from '../lib/args.mjs';
import { SENSITIVE_KEY } from '../lib/ats-fields.mjs';
import { addFinishYourself } from '../lib/batch-file.mjs';
import { attachTo, click, describeField, evaluate, readText, openPage, screenshot, selectOption, setChecked, setFileInputFiles, setValue, withBrowser } from '../lib/cdp.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { isSensitive } from '../lib/profile-answers.mjs';
import { isPidAlive, withLock } from '../lib/dir-lock.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { runResult } from '../lib/run.mjs';
import { which } from '../lib/which.mjs';

export const STATE_FILE = '.chrome-automation';
export const PROFILE_DIR = 'chrome-automation';
export const EXIT = Object.freeze({ ok: 0, stuck: 1, usage: 2, refused: 3, wait: 4, needsUser: 5, captcha: 6, notRunning: 7 });
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

// Password fields stay with the student: type=password or a password autocomplete hint.
export const isPasswordField = (info) => info?.type === 'password' || /(current|new)-password/.test(info?.autocomplete ?? '');

const CAPTCHA_CHECK = `(() => {
  const frames = [...document.querySelectorAll('iframe')].map((f) => f.src || '').join(' ');
  if (/recaptcha|hcaptcha|turnstile|challenges\\.cloudflare|arkoselabs|funcaptcha/i.test(frames)) return 'captcha frame';
  if (document.querySelector('.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]')) return 'captcha widget';
  const text = document.body ? document.body.innerText : '';
  return /verify (that )?you are (a )?human|are you a robot|unusual traffic/i.test(text) ? 'bot check text' : null; })()`;

export const detectCaptcha = (client, sessionId) => evaluate(client, sessionId, CAPTCHA_CHECK);

const siteOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

async function fillField(client, sessionId, field) {
  if (field.type === 'select' || field.type === 'select-one') return selectOption(client, sessionId, field.selector, field.value);
  if (field.type === 'checkbox' || field.type === 'radio') return setChecked(client, sessionId, field.selector, Boolean(field.value));
  return setValue(client, sessionId, field.selector, field.value);
}

// Fills one plan; returns { code, filled, problems }. The tab stays open for submit.
export async function fillPlan(client, plan, { dataDir }) {
  const page = (await attachTo(client, plan.url)) ?? (await openPage(client, plan.url));
  const { sessionId } = page;
  const captcha = await detectCaptcha(client, sessionId);
  if (captcha) {
    if (plan.batchId) addFinishYourself(dataDir, plan.batchId, { company: plan.company, role: plan.role, link: plan.link ?? plan.url, reason: captcha });
    return { code: EXIT.captcha, filled: 0, problems: [`blocked: ${siteOf(plan.url)} shows a ${captcha}; added to finish these yourself`] };
  }
  const problems = [];
  const blocked = [];
  let filled = 0;
  for (const field of (plan.fields ?? []).filter((f) => f.selector)) {
    const info = await describeField(client, sessionId, field.selector);
    if (isPasswordField(info)) {
      return { code: EXIT.refused, filled, problems: [`refused: ${field.label || field.selector} is a password field; sign-ins stay with you`] };
    }
    // SSN, card and bank fields are never typed, whatever value the plan carries; the student fills them.
    if (field.key === SENSITIVE_KEY || isSensitive({ label: field.label, name: field.name, autocomplete: info?.autocomplete ?? field.autocomplete })) {
      blocked.push(`blocked-on-user: ${field.label || field.name || field.selector} is a card, bank or government id field; fill it yourself`);
      continue;
    }
    if (field.value === undefined || field.value === null || field.value === '') continue;
    if (await fillField(client, sessionId, field)) filled++;
    else problems.push(`could not fill ${field.label || field.selector}`);
  }
  for (const up of plan.uploads ?? []) {
    if (up.selector && up.path) {
      await setFileInputFiles(client, sessionId, up.selector, [up.path]);
      filled++;
    }
  }
  return { code: blocked.length ? EXIT.needsUser : EXIT.ok, filled, problems: [...problems, ...blocked] };
}

async function cmdFill({ dataDir, flags, deps, say }) {
  if (!flags.plan) throw new UsageError('fill needs --plan FILE');
  const plan = JSON.parse(readFileSync(flags.plan, 'utf8'));
  const live = await liveState(dataDir, deps);
  if (!live) {
    say('chrome: automation Chrome is not running; run node student/scripts/chrome.mjs open');
    return EXIT.notRunning;
  }
  const res = await withBrowser(live.port, (client) => fillPlan(client, plan, { dataDir }), deps);
  for (const p of res.problems) say(`chrome: ${p}`);
  if (res.code === EXIT.ok || res.code === EXIT.needsUser) say(`chrome: filled ${res.filled} field(s) on ${siteOf(plan.url)}`);
  return res.code;
}

// The budget check runs as a child process with the same --batch-id and --item that the log records after the click.
export function budgetCall(paths, verb, action, plan, extra = [], runner = runResult) {
  const args = [join(paths.packRoot, 'scripts', 'budget.mjs'), verb, action, '--company', plan.company, '--batch-id', plan.batchId, '--item', String(plan.item), '--root', paths.root, '--data-dir', paths.dataDir, ...extra];
  return runner(process.execPath, args, { cwd: paths.root });
}

// The fill plan fill-plan.mjs wrote for one batch item: data/fill-plans/<batchId>/<item>.json.
export const planFile = (dataDir, batchId, item) => join(dataDir, 'fill-plans', batchId, `${item}.json`);

export function planFor(dataDir, batchId, item) {
  const file = planFile(dataDir, batchId, item);
  if (!existsSync(file)) return null;
  return { ...JSON.parse(readFileSync(file, 'utf8')), batchId, item, planFile: file };
}

export const SUBMIT_KINDS = Object.freeze({ apply: 'apply.submit' });

// budget.mjs exit codes keep their meaning here: 4 wait, 5 needs the user (another track at the company); any other
// non-zero is a refusal.
export const budgetExit = (code) => (code === 4 ? EXIT.wait : code === 5 ? EXIT.needsUser : EXIT.refused);

const SUBMIT_SELECTOR = 'button[type=submit], input[type=submit]';

// On the page: CAPTCHA check, then the button, then the pending row, then the click. The pending row is logged before the
// click so a click whose apply.submit log later fails still leaves the item used; budget.mjs approvedItem counts it.
async function clickSubmit(client, { plan, paths, item, runner }) {
  const page = (await attachTo(client, plan.url)) ?? (await openPage(client, plan.url));
  if (await detectCaptcha(client, page.sessionId)) return { state: 'captcha' };
  const selector = plan.submitSelector ?? SUBMIT_SELECTOR;
  if (!(await describeField(client, page.sessionId, selector))) return { state: 'no-button' };
  const pending = budgetCall(paths, 'log', 'apply.pending', plan, ['--target', plan.url], runner);
  if (pending.code !== 0) return { state: 'pending-failed', res: pending };
  if (!(await click(client, page.sessionId, selector))) return { state: 'no-button' };
  // A screenshot is taken only here, to prove what the submit showed; every other read is text.
  await new Promise((r) => setTimeout(r, 1500));
  writeFileSync(join(dirname(plan.planFile), `${item}-submitted.png`), await screenshot(client, page.sessionId));
  return { state: 'clicked' };
}

const childLine = (res) => (res.stdout || res.stderr || '').trim().split('\n')[0] || `exit ${res.code}`;

async function cmdSubmit({ dataDir, paths, flags, deps, say }) {
  if (!flags.batchId || !Number.isInteger(flags.item)) throw new UsageError('submit needs --batch-id ID --item N');
  const action = SUBMIT_KINDS[flags.kind ?? 'apply'];
  if (!action) throw new UsageError(`--kind must be one of ${Object.keys(SUBMIT_KINDS).join(', ')}`);
  const plan = planFor(dataDir, flags.batchId, flags.item);
  if (!plan) {
    say(`chrome: no fill plan for item ${flags.item} of batch ${flags.batchId}`);
    return EXIT.usage;
  }
  const scoreArgs = ['--score', String(plan.score ?? 0), '--batch', '1', ...(plan.track ? ['--track', plan.track] : [])];
  const check = budgetCall(paths, 'check', action, plan, scoreArgs, deps.runner);
  if (check.code !== 0) {
    say(`chrome: budget.mjs said ${childLine(check)} (exit ${check.code}); nothing was clicked`);
    return budgetExit(check.code);
  }
  const live = await liveState(dataDir, deps);
  if (!live) {
    say('chrome: automation Chrome is not running; run node student/scripts/chrome.mjs open');
    return EXIT.notRunning;
  }
  const clicked = await withBrowser(live.port, (client) => clickSubmit(client, { plan, paths, item: flags.item, runner: deps.runner }), deps);
  return afterClick({ clicked, plan, paths, flags, action, dataDir, deps, say });
}

function afterClick({ clicked, plan, paths, flags, action, dataDir, deps, say }) {
  if (clicked.state === 'captcha') {
    addFinishYourself(dataDir, flags.batchId, { company: plan.company, role: plan.role, link: plan.link ?? plan.url });
    say(`chrome: blocked: ${siteOf(plan.url)} shows a CAPTCHA; added to finish these yourself`);
    return EXIT.captcha;
  }
  if (clicked.state === 'no-button') {
    say('chrome: no submit button found; nothing was clicked');
    return EXIT.refused;
  }
  if (clicked.state === 'pending-failed') {
    say(`chrome: budget.mjs could not record the pending submit (${childLine(clicked.res)}); nothing was clicked`);
    return EXIT.refused;
  }
  const log = budgetCall(paths, 'log', action, plan, plan.track ? ['--track', plan.track, '--target', plan.url] : ['--target', plan.url], deps.runner);
  if (log.code !== 0) {
    say(`chrome: item ${flags.item} of ${flags.batchId} was submitted but budget.mjs log ${action} failed (${childLine(log)}); its pending row keeps it from being submitted again. Tell the student before any other submit today.`);
    return EXIT.needsUser;
  }
  say(`chrome: submitted item ${flags.item} of ${flags.batchId}`);
  return EXIT.ok;
}

export const HANDLERS = { open: cmdOpen, status: cmdStatus, read: cmdRead, close: cmdClose, fill: cmdFill, submit: cmdSubmit };
export const COMMANDS = Object.keys(HANDLERS);
export const FLAGS = { headless: 'boolean', plan: 'string', 'batch-id': 'string', item: 'int', kind: 'string' };

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
