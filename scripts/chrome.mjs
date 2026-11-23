#!/usr/bin/env node
// The automation Chrome: a dedicated --user-data-dir in the career-ops data folder that the student signs in to once
// (LinkedIn, Gmail, Handshake), driven over the DevTools port by lib/cdp.mjs. Chrome 136+ refuses remote debugging on the
// default profile, and a separate profile keeps the student's everyday browsing out of reach, so the default profile is
// never touched. Claude Code, Codex and a scheduled run all reach the same browser through this one CLI.
// Usage: chrome.mjs open [--headless] | status [--json] | read <url> [--links] | read-form --url URL | close
//        chrome.mjs fill --plan FILE | submit --batch-id ID --item N [--kind apply|easy-apply]   [--root R] [--data-dir D]
// read --links lists only the page's LinkedIn job and company links (jobs/view and company hrefs), up to 200.
// read-form reads the posting's application form (labels, names, types and selectors, never values) into
// data/form-fields/<url key>.json for fill-plan; it never types or clicks, and a CAPTCHA (exit 6) or a password field
// (exit 5, a sign-in page) stops it before anything is saved. Only the application form's inputs count (lib/cdp.mjs
// readApplicationForm), and the form read and its button are saved with them so submit clicks only that button. A form
// that renders late is polled for a few seconds; a page with none saves nothing (exit 3), counts the try in
// data/form-fields/empty-reads.json and is read again on the next run, up to 3 tries, and a later read that works
// clears the count. When no job text is saved for the posting yet (daily triage's text is never replaced), it saves
// the job text (the JSON-LD JobPosting description, else the posting page's main text without its forms, never a form
// route's labels) through the posting guard into data/jds, where fill-plan reads it.
// fill types into the form by field map and never into a password field or an SSN, card or bank field (those are listed
// as blocked-on-user and the fill exits 5 after the rest is filled); a visible CAPTCHA or bot check stops it and moves
// the job to the batch's finish-yourself list. fill records its tab in the plan file. submit clicks only in that tab,
// only after budget.mjs check passes for the approved item, and logs apply.submit only when the page confirms it.
// Exit codes: 0 ok, 1 close could not stop Chrome, 2 usage (or no plan for the approved line), 3 refused (an item with no
// unspent approval, checked before its plan is looked up; budget.mjs refused, a plan for another link than the approved line, a job on finish these yourself, the filled tab is gone or
// changed, a plan with text fields that no fill typed, no submit button or one outside the form read), 4 wait (browser slot or budget.mjs wait), 5 needs the
// user (budget.mjs exit 5 passed through, a password or sensitive field left for the student, a form that refused the
// submit or a submit with no new confirmation, both added to finish these yourself, or a confirmed submit that could not
// be logged), 6 CAPTCHA or bot check
// (finish it yourself), 7 automation Chrome not running or its profile held by a Chrome this CLI did not record.
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readActionLog } from '../lib/action-log.mjs';
import { UsageError, isMain, parseArgs, runCli } from '../lib/args.mjs';
import { EMPTY_READ_TRIES, FIELDS_DIR, SENSITIVE_KEY, atsOf, clearEmptyReads, formFieldsFile, formUrl, recordEmptyRead } from '../lib/ats-fields.mjs';
import { addFinishYourself, readBatch } from '../lib/batch-file.mjs';
import { LINK_STYLE, attachById, attachTo, chooseRadio, click, describeField, evaluate, insideForm, readApplicationForm, readText, openPage, readValue, screenshot, selectOption, setChecked, setFileInputFiles, setValue, submitButton, submitForFields, withBrowser } from '../lib/cdp.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { load as loadJd, saveIfAbsent as saveJdIfAbsent } from '../lib/jd-store.mjs';
import { trimJobText } from '../lib/jd-trim.mjs';
import { guardPosting } from '../lib/posting-guard.mjs';
import { leverOpts, resolve as resolveLever } from '../lib/levers.mjs';
import { isSensitive } from '../lib/profile-answers.mjs';
import { LockTimeoutError, isPidAlive, withLock } from '../lib/dir-lock.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { runResult } from '../lib/run.mjs';
import { writeAtomic } from '../lib/tsv.mjs';
import { which } from '../lib/which.mjs';
import { approvedItem } from './budget.mjs';
import { trimWords } from './daily-triage.mjs';

export const STATE_FILE = '.chrome-automation';
export const PROFILE_DIR = 'chrome-automation';
export const EXIT = Object.freeze({ ok: 0, stuck: 1, usage: 2, refused: 3, wait: 4, needsUser: 5, captcha: 6, notRunning: 7 });
// Chrome on an 8 GB machine under load can take well over 20 s to write its DevTools port.
export const PORT_WAIT_MS = 45 * 1000;
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

// Chrome writes the port it picked for --remote-debugging-port=0 on the first line of DevToolsActivePort, and on a slow
// or cold start it can write it seconds before /json/version answers. The launch is ready only when it passes the same
// check read, fill, submit and status make (liveState: the PID alive and the port answering), so a "ready" open is never
// followed by "not running". Returns { port, ready, exited }; port is the last one seen, null when none was written.
// portWaitMs overrides PORT_WAIT_MS (tests).
async function waitForDevtools(profile, pid, deps = {}) {
  const { now = Date.now, wait = sleep, portWaitMs = PORT_WAIT_MS } = deps;
  const isAlive = deps.isAlive ?? isPidAlive;
  const file = join(profile, 'DevToolsActivePort');
  const until = now() + portWaitMs;
  let port = null;
  while (now() < until) {
    if (!isAlive(pid)) return { port, ready: false, exited: true };
    if (existsSync(file)) {
      const seen = Number(readFileSync(file, 'utf8').split('\n')[0]);
      if (Number.isInteger(seen) && seen > 0) {
        port = seen;
        if ((await reachable(port, deps)) && isAlive(pid)) return { port, ready: true, exited: false };
      }
    }
    await wait(200);
  }
  return { port, ready: false, exited: false };
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
  const { port, ready, exited } = await waitForDevtools(profile, child.pid, deps);
  if (!ready) {
    await stopChrome(child.pid, deps);
    const seconds = Math.round((deps.portWaitMs ?? PORT_WAIT_MS) / 1000);
    if (exited) say(`chrome: Chrome (PID ${child.pid}) exited before its DevTools port answered; run open again`);
    else if (port) say(`chrome: Chrome started but its DevTools port ${port} did not answer within ${seconds} seconds; stopped it (PID ${child.pid})`);
    else say(`chrome: Chrome started but opened no DevTools port within ${seconds} seconds; stopped it (PID ${child.pid})`);
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

// T17 for a student: deps.levers (tests), else the pack's verdict with the student's config/levers.yml, which may turn
// it off (deps.packRoot for tests).
export const t17Lever = (deps = {}, root = null) => resolveLever('T17', deps.levers ?? leverOpts(deps.packRoot, root));

async function cmdRead({ dataDir, paths, positionals, flags, deps, say }) {
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
      const body = await readText(client, sessionId);
      // T17 (off until its A/B verdict): page text capped at the tested character limit, then the link refs.
      const t17 = t17Lever(deps, paths?.root ?? null);
      if (t17.on) return [cappedText(body, t17.value), '', ...(await linkRefs(client, sessionId))].join('\n');
      return flags.links ? [body, '', ...(await linkRefs(client, sessionId))].join('\n') : body;
    } finally {
      await client.send('Target.closeTarget', { targetId }).catch(() => {});
    }
  }, deps);
  say(text);
  return EXIT.ok;
}

// Numbered link refs ("[n] text -> href") after the page text, so a script can take job links from a read with no model.
// Only job and company links are kept, before the cap, so header, nav and filter links cannot push job cards out. The
// refs go to code (fresh-scan's linkedinJobs), not to a model, so the cap costs no tokens.
const REF_LIMIT = 200;
// T17's default page-text cap for a read when its verdict recorded no tested value.
export const READ_CAP_CHARS = 6000;
// The page text T17 hands an agent: at most cap characters (READ_CAP_CHARS when its verdict recorded none).
export const cappedText = (body, cap) => String(body ?? '').slice(0, Number(cap) || READ_CAP_CHARS);
export const REF_SELECTOR = 'a[href*="/jobs/view/"], a[href*="/company/"]';
export const linkRefs = async (client, sessionId, limit = REF_LIMIT) =>
  (await evaluate(client, sessionId, `[...document.querySelectorAll(${JSON.stringify(REF_SELECTOR)})].slice(0, ${limit}).map((a, i) => '[' + (i + 1) + '] ' + a.innerText.replace(/\\s+/g, ' ').trim().slice(0, 60) + ' -> ' + a.href)`)) ?? [];

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

// A challenge the student must solve: a visible CAPTCHA frame or widget, or a bot-check page. An invisible reCAPTCHA or
// hCaptcha badge (Greenhouse and Lever embed one on most forms) is not a challenge, so the form is still filled.
const VISIBLE_CHALLENGE = `(() => {
  const RE = /recaptcha|hcaptcha|turnstile|challenges\\.cloudflare|arkoselabs|funcaptcha/i;
  const invisible = (el) => Boolean(el.closest('.grecaptcha-badge, [data-size="invisible"]')) || /[?&#]size=invisible/.test(el.getAttribute('src') || '');
  const shown = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false;
    if (el.checkVisibility) return el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const st = getComputedStyle(el); return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0; };
  for (const f of document.querySelectorAll('iframe')) {
    if (RE.test((f.getAttribute('src') || '') + ' ' + (f.title || '')) && !invisible(f) && shown(f)) return 'captcha frame';
  }
  for (const w of document.querySelectorAll('.g-recaptcha, .h-captcha, .cf-turnstile, [data-sitekey]')) if (!invisible(w) && shown(w)) return 'captcha widget';
  const text = document.body ? document.body.innerText : '';
  return /verify (that )?you are (a )?human|are you a robot|unusual traffic/i.test(text) ? 'bot check text' : null; })()`;

export const detectCaptcha = (client, sessionId) => evaluate(client, sessionId, VISIBLE_CHALLENGE);

// Confirmation and sign-in wording, counted on the page before and after the click: only wording the click added counts,
// since a job description can already say "Thank you for applying".
const CONFIRM_SRC = String.raw`thank you for (applying|your application)|application (has been |was )?(received|submitted)|we('ve| have) received your application|successfully submitted`;
const SIGNIN_SRC = String.raw`\bsign in\b|\blog in\b|\bcreate (an |your )?account\b|forgot (your )?password`;
const SIGNS = `const text = document.body ? document.body.innerText : '';
  const count = (src) => (text.match(new RegExp(src, 'gi')) || []).length;
  const signs = { confirm: count(${JSON.stringify(CONFIRM_SRC)}), signin: count(${JSON.stringify(SIGNIN_SRC)}), password: document.querySelectorAll('input[type=password]').length };`;
export const PAGE_SIGNS = `(() => { ${SIGNS} return signs; })()`;
// The page signs, or null when the read gave no number for one of them.
const signsOf = (v) => (v && typeof v === 'object' && ['confirm', 'signin', 'password'].every((k) => Number.isFinite(v[k])) ? { confirm: v.confirm, signin: v.signin, password: v.password } : null);

// What the page shows after the submit click, checked in this order: a challenge, a form that refused the submit
// (invalid or error-marked fields), a sign-in or create-account page (a new password field or new sign-in wording: not a
// confirmation), confirmation wording the click added, or nothing decisive yet ('waiting'). A page that merely changed
// is never a confirmation. before is PAGE_SIGNS read just before the click; when it could not be read, no wording can be
// shown to be new, so the outcome is unconfirmed.
export const outcomeCheck = (before) => `(() => {
  const challenge = ${VISIBLE_CHALLENGE};
  if (challenge) return { state: 'captcha', detail: challenge };
  const seen = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const labelOf = (el) => { const l = (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]')) || el.closest('label'); return ((l && l.innerText) || el.name || el.id || 'a field').trim(); };
  const bad = [...document.querySelectorAll('input, select, textarea')].filter((el) => !el.disabled && el.type !== 'hidden' && (el.matches(':invalid') || el.getAttribute('aria-invalid') === 'true'));
  const alerts = [...document.querySelectorAll('[role=alert], .error, .field-error, .invalid-feedback')].filter((el) => seen(el) && el.innerText.trim());
  if (bad.length || alerts.length) return { state: 'invalid', detail: [...bad.map(labelOf), ...alerts.map((el) => el.innerText.trim().slice(0, 80))].slice(0, 5).join('; ') };
  const before = ${JSON.stringify(signsOf(before))};
  if (!before) return { state: 'unconfirmed', detail: 'the page wording before the click could not be read' };
  ${SIGNS}
  if (signs.password > before.password || signs.signin > before.signin) return { state: 'unconfirmed', detail: 'the submit led to a sign-in or create-account page' };
  if (signs.confirm > before.confirm) return { state: 'confirmed', detail: 'confirmation text' };
  return { state: 'waiting' }; })()`;

const siteOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

const CHECK_YES = /^(yes|y|true|on|1|checked)$/i;
const CHECK_NO = /^(no|n|false|off|0|unchecked|decline)$/i;
const DECLINE_LABEL = /decline|prefer not|do not wish|don'?t wish|choose not|not to (self[- ]?)?identify|rather not/i;

// A checkbox answer as true or false; null when the value is neither a yes nor a no ("No" must never tick a box).
// "decline" ticks a box whose label is itself the decline choice ("I do not wish to self-identify") and leaves any other
// box unticked.
export function checkboxState(value, label = '') {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim();
  if (/^decline$/i.test(text) && DECLINE_LABEL.test(String(label))) return true;
  if (CHECK_YES.test(text)) return true;
  if (CHECK_NO.test(text)) return false;
  return null;
}

async function fillField(client, sessionId, field) {
  if (field.type === 'select' || field.type === 'select-one') return selectOption(client, sessionId, field.selector, field.value);
  if (field.type === 'radio') return chooseRadio(client, sessionId, field.selector, field.value);
  if (field.type === 'checkbox') {
    const state = checkboxState(field.value, field.label);
    return state === null ? false : setChecked(client, sessionId, field.selector, state);
  }
  // A page script may only set a file input to the empty string, so a file goes through the DOM domain.
  if (field.type === 'file') {
    await setFileInputFiles(client, sessionId, field.selector, [String(field.value)]);
    return true;
  }
  return setValue(client, sessionId, field.selector, field.value);
}

const TEXT_TYPES = new Set(['text', 'email', 'tel', 'url', 'number', 'textarea', 'search', '']);
const pageUrl = async (client, sessionId) => {
  const href = await evaluate(client, sessionId, 'location.href');
  return typeof href === 'string' ? href : null;
};

// Fills one plan; returns { code, filled, problems, tab }. The tab stays open for submit, and tab = { targetId, url,
// sentinel } names it, so submit clicks in this exact tab and checks that it still holds the filled form.
export async function fillPlan(client, plan, { dataDir }) {
  const form = formUrl(plan.url);
  const page = (await attachTo(client, form)) ?? (await openPage(client, form));
  const { sessionId } = page;
  const captcha = await detectCaptcha(client, sessionId);
  if (captcha) {
    if (plan.batchId) addFinishYourself(dataDir, plan.batchId, { company: plan.company, role: plan.role, link: plan.link ?? plan.url, reason: captcha });
    return { code: EXIT.captcha, filled: 0, problems: [`blocked: ${siteOf(plan.url)} shows a ${captcha}; added to finish these yourself`] };
  }
  const problems = [];
  const blocked = [];
  let filled = 0;
  let sentinel = null;
  for (const field of (plan.fields ?? []).filter((f) => f.selector)) {
    const info = await describeField(client, sessionId, field.selector);
    if (isPasswordField(info)) {
      blocked.push(`blocked-on-user: ${field.label || field.selector} is a password field; sign-ins stay with you, nothing was typed there`);
      continue;
    }
    // SSN, card and bank fields are never typed, whatever value the plan carries; the student fills them.
    if (field.key === SENSITIVE_KEY || isSensitive({ label: field.label, name: field.name, autocomplete: info?.autocomplete ?? field.autocomplete })) {
      blocked.push(`blocked-on-user: ${field.label || field.name || field.selector} is a card, bank or government id field; fill it yourself`);
      continue;
    }
    if (field.value === undefined || field.value === null || field.value === '') continue;
    if (await fillField(client, sessionId, field)) {
      filled++;
      if (!sentinel && TEXT_TYPES.has(String(field.type ?? '').toLowerCase())) sentinel = { selector: field.selector, value: String(field.value) };
    } else problems.push(`could not fill ${field.label || field.selector}`);
  }
  for (const up of plan.uploads ?? []) {
    if (up.selector && up.path) {
      await setFileInputFiles(client, sessionId, up.selector, [up.path]);
      filled++;
    }
  }
  const tab = { targetId: page.targetId, url: await pageUrl(client, sessionId), sentinel };
  return { code: blocked.length ? EXIT.needsUser : EXIT.ok, filled, problems: [...problems, ...blocked], tab };
}

// Page script for the job text: the raw JSON-LD blocks and the visible text of main (else article, else body). Read-only.
// The text of every form inside main is left out, so form labels and questions never count as job text.
export const PAGE_JOB_SCRIPT = `(() => {
  const root = document.querySelector('main') || document.querySelector('article') || document.body;
  let main = root ? String(root.innerText || '') : '';
  if (root && typeof root.querySelectorAll === 'function') {
    for (const f of root.querySelectorAll('form')) { const t = String(f.innerText || '').trim(); if (t) main = main.split(t).join(' '); }
  }
  return { ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent || ''), main };
})()`;

// Fewer words than this is a form or a page shell, not a posting.
export const MIN_PAGE_JOB_WORDS = 80;
// Job text kept from a page when the jd_trim lever is off, the same cut daily triage applies.
const PAGE_JOB_CHARS = 6000;
const wordCount = (text) => String(text ?? '').split(/\s+/).filter(Boolean).length;
// Entities are decoded before tags are stripped, so an entity-encoded description (&lt;p&gt;) loses its tags too; &amp;
// is decoded last so it never forms a new entity.
const stripHtml = (html) => String(html ?? '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/<\s*(br|\/p|\/li|\/h[1-6]|\/div)\b[^>]*>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

// The JobPosting nodes of one JSON-LD block (a node, an array, or an @graph); [] for a block that does not parse.
function jobPostings(block) {
  let data;
  try {
    data = JSON.parse(block);
  } catch {
    return [];
  }
  const nodes = (Array.isArray(data) ? data : [data]).flatMap((n) => (Array.isArray(n?.['@graph']) ? n['@graph'] : [n]));
  return nodes.filter((n) => [].concat(n?.['@type'] ?? []).includes('JobPosting'));
}

// Job text from a page read by PAGE_JOB_SCRIPT: the description of the page's one JSON-LD JobPosting, else (unless main
// is false) the visible main text, cut to the resolved jd_trim words (lib/jd-trim.mjs) or, with the lever off, to the
// characters daily triage keeps; '' when neither reaches MIN_PAGE_JOB_WORDS or the page names several postings.
export function pageJobText(raw, { main: useMain = true, words = trimWords() } = {}) {
  const postings = (raw?.ld ?? []).flatMap(jobPostings);
  if (postings.length > 1) return '';
  const ld = postings.length ? stripHtml(postings[0].description) : '';
  if (wordCount(ld) >= MIN_PAGE_JOB_WORDS) return postings[0].title ? `${postings[0].title}\n\n${ld}` : ld;
  const main = useMain ? String(raw?.main ?? '').trim() : '';
  if (wordCount(main) < MIN_PAGE_JOB_WORDS) return '';
  return words ? trimJobText(main, { words }) : main.slice(0, PAGE_JOB_CHARS);
}

// A form rendered after the load event (a client-side route) is polled for up to FORM_WAIT_MS before a read is empty.
export const FORM_WAIT_MS = 3000;
const FORM_POLL_MS = 500;

async function readFormPage(client, sessionId, wait) {
  let read = await readApplicationForm(client, sessionId);
  for (let waited = 0; !read.fields.length && waited < FORM_WAIT_MS; waited += FORM_POLL_MS) {
    await wait(FORM_POLL_MS);
    read = await readApplicationForm(client, sessionId);
  }
  return read;
}

// The posting's job text for read-form: the JSON-LD JobPosting of the opened form page, else the posting page itself.
// On a form route (Lever /apply) the posting page is read in its own tab, and the form route's visible text (form labels
// and questions) never counts. A posting page that is its own form page (Greenhouse) counts its main text without forms.
async function postingText(client, url, sessionId) {
  const raw = await evaluate(client, sessionId, PAGE_JOB_SCRIPT);
  if (formUrl(url) === url) return pageJobText(raw);
  const fromLd = pageJobText(raw, { main: false });
  if (fromLd) return fromLd;
  const tab = await openPage(client, url);
  try {
    return pageJobText(await evaluate(client, tab.sessionId, PAGE_JOB_SCRIPT));
  } finally {
    await client.send('Target.closeTarget', { targetId: tab.targetId }).catch(() => {});
  }
}

// Reads the application form at url in a new tab and closes it again: read-only, it never types, clicks or submits. A
// visible CAPTCHA or bot check, or a password field (a sign-in or account page), stops it before the fields are read.
// The page opened is the posting's form page (formUrl). The posting's job text is read only when opts.jobText is true
// (no text is saved for it yet). Returns { fields, form?, submit?, jobText? } (form and submit name the form read and
// its button) or { stop: 'captcha', detail }, { stop: 'password' } or { stop: 'empty' }. opts.wait(ms) paces the poll.
export async function readForm(client, url, { jobText = true, wait = sleep } = {}) {
  const { sessionId, targetId } = await openPage(client, formUrl(url));
  try {
    const captcha = await detectCaptcha(client, sessionId);
    if (captcha) return { stop: 'captcha', detail: captcha };
    const read = await readFormPage(client, sessionId, wait);
    const { fields } = read;
    if (fields.some(isPasswordField)) return { stop: 'password' };
    if (!fields.length) return { stop: 'empty' };
    const form = read.form !== undefined ? { form: read.form, submit: read.submit ?? null } : {};
    const text = jobText ? await postingText(client, url, sessionId) : '';
    return { fields, ...form, ...(text ? { jobText: text } : {}) };
  } finally {
    await client.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

// True when no job text is saved for the posting yet (data/jds), so read-form may save the page's.
export const needsJobText = (dataDir, url) => !loadJd(dataDir, url).trim();

// After a read that found fields: saves them with the form read, clears the posting's empty-read count (a later read
// that works lifts a give-up), and saves the page's job text only when no text is saved yet, so the text daily triage
// saved is never replaced.
export function keepRead({ dataDir, url, res, say }) {
  const file = saveFormFields(dataDir, url, res.fields, res);
  clearEmptyReads(join(dataDir, FIELDS_DIR), url);
  say(`chrome: read ${res.fields.length} form field(s) on ${siteOf(url)} into ${file}`);
  const guarded = res.jobText ? guardPosting(res.jobText).text.trim() : '';
  if (!needsJobText(dataDir, url)) say(`chrome: kept the posting text already saved for ${siteOf(url)}`);
  else if (guarded) say(`chrome: saved the posting text from ${siteOf(url)} (${saveJdIfAbsent(dataDir, url, guarded)})`);
  else say(`chrome: no posting text found on ${siteOf(url)}`);
}

// read-form: the posting's form fields (with selectors) into data/form-fields/<url key>.json as { ats, url, form,
// submit, fields }, which fill-plan reads.
async function cmdReadForm({ dataDir, flags, deps, say }) {
  if (!flags.url) throw new UsageError('read-form needs --url URL');
  const live = await liveState(dataDir, deps);
  if (!live) {
    say('chrome: automation Chrome is not running; run node student/scripts/chrome.mjs open');
    return EXIT.notRunning;
  }
  const res = await withBrowser(live.port, (client) => readForm(client, flags.url, { jobText: needsJobText(dataDir, flags.url) }), deps);
  if (res.stop === 'captcha') {
    say(`chrome: blocked: ${siteOf(flags.url)} shows a ${res.detail}; the form was not read and nothing was typed`);
    return EXIT.captcha;
  }
  if (res.stop === 'password') {
    say(`chrome: blocked-on-user: ${siteOf(flags.url)} shows a password field (a sign-in or account page); sign-ins stay with you, nothing was typed. Read the form again once you are signed in.`);
    return EXIT.needsUser;
  }
  if (res.stop === 'empty') {
    const tries = recordEmptyRead(join(dataDir, FIELDS_DIR), flags.url);
    const left = tries >= EMPTY_READ_TRIES ? 'it is left for you to finish yourself' : 'it is read again on the next run';
    say(`chrome: no application form found on ${siteOf(flags.url)} (read ${tries} of ${EMPTY_READ_TRIES}); nothing was saved and ${left}`);
    return EXIT.refused;
  }
  keepRead({ dataDir, url: flags.url, res, say });
  return EXIT.ok;
}

// Writes data/form-fields/<url key>.json as { ats, url, form, submit, fields } and returns its path. form and submit
// (from read, when the read recorded them) are the selectors of the form read and its button; submit clicks only that.
export function saveFormFields(dataDir, url, fields, read = {}) {
  const file = formFieldsFile(join(dataDir, FIELDS_DIR), url);
  mkdirSync(dirname(file), { recursive: true });
  const form = read.form !== undefined ? { form: read.form ?? null, submit: read.submit ?? null } : {};
  writeAtomic(file, `${JSON.stringify({ ats: atsOf(url), url, ...form, fields }, null, 2)}\n`);
  return file;
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
  if (res.code === EXIT.ok || res.code === EXIT.needsUser) {
    // The filled tab is recorded in the plan file submit reads.
    writeAtomic(flags.plan, `${JSON.stringify({ ...plan, tab: res.tab }, null, 2)}\n`);
    say(`chrome: filled ${res.filled} field(s) on ${siteOf(plan.url)}`);
  }
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

// The plan behind the numbered line the student approved. Item numbers follow the batch page, which renumbers when a
// CAPTCHA moves a job out before approval, so the plan is found through the batch JSON (its item's plan file) and its
// link must equal that line's link. Returns { plan } or { problem }; a batch with no JSON gives { plan, unverified }.
export function resolveSubmitPlan(dataDir, batchId, item) {
  const batch = readBatch(dataDir, batchId);
  if (!batch) {
    const plan = planFor(dataDir, batchId, item);
    return plan ? { plan, unverified: true } : { problem: `no fill plan for item ${item} of batch ${batchId}` };
  }
  const line = batch.items?.[item - 1];
  if (!line) return { problem: `batch ${batchId} has no item ${item}` };
  if (!line.plan || !existsSync(line.plan)) return { problem: `no fill plan for item ${item} of batch ${batchId}` };
  const plan = { ...JSON.parse(readFileSync(line.plan, 'utf8')), batchId, item, planFile: line.plan };
  if ((plan.link ?? plan.url) !== line.link) return { problem: `the fill plan for item ${item} is for ${plan.link ?? plan.url}, not the approved ${line.link}`, refused: true };
  // A job on finish these yourself is the student's now (they may have sent it by hand), so automation never submits it.
  if ((batch.finishYourself ?? []).some((f) => f.link === line.link)) return { problem: `item ${item} of batch ${batchId} is on finish these yourself (${line.link})`, refused: true };
  return { plan };
}

// Why a numbered line with no unspent logged approval is refused, or null. Checked before the fill-plan lookup, so an item
// left out of the approval exits 3 whether or not it has a plan. A missing batch or line, or a line on finish these
// yourself, is left to resolveSubmitPlan, which names that problem.
export async function approvalProblem(dataDir, batchId, item) {
  const batch = readBatch(dataDir, batchId);
  const line = batch?.items?.[item - 1];
  if (!line || (batch.finishYourself ?? []).some((f) => f.link === line.link)) return null;
  const rows = await readActionLog(join(dataDir, 'action-log.tsv'));
  return approvedItem(rows, batchId, item) ? null : `item ${item} of batch ${batchId} has no unspent approval`;
}

// Easy Apply is checked and logged as apply.easy_apply, which has its own daily cap and LinkedIn pacing in budget.mjs.
export const SUBMIT_KINDS = Object.freeze({ apply: 'apply.submit', 'easy-apply': 'apply.easy_apply' });

// budget.mjs exit codes keep their meaning here: 4 wait, 5 needs the user (another track at the company); any other
// non-zero is a refusal.
export const budgetExit = (code) => (code === 4 ? EXIT.wait : code === 5 ? EXIT.needsUser : EXIT.refused);

const OUTCOME_POLL_MS = 500;
const OUTCOME_TRIES = 20;

// Polls the page after the click until it shows a decision; a navigation in progress makes evaluate throw, which is
// only a reason to look again. 'unconfirmed' when nothing decisive shows within the wait.
async function submitOutcome(client, sessionId, before, wait) {
  for (let i = 0; i < OUTCOME_TRIES; i++) {
    await wait(OUTCOME_POLL_MS);
    try {
      const res = await evaluate(client, sessionId, outcomeCheck(before));
      if (res && res.state && res.state !== 'waiting') return res;
    } catch {
      // the page is navigating; read it again on the next poll
    }
  }
  return { state: 'unconfirmed' };
}

// Why the saved submit button must not be clicked, as a clickSubmit state, or null: it is gone, it reads as another
// action (LINK_STYLE), it is an untyped button outside any form (it submits nothing), or its form holds none of the
// filled fields.
function unsafeButton(b, selector) {
  if (!b || typeof b !== 'object') return { state: 'no-button', detail: `${selector} is gone` };
  if (LINK_STYLE.test(String(b.text ?? ''))) return { state: 'no-button', detail: `${selector} reads "${String(b.text).trim()}"` };
  if (!b.inForm && !b.typed) return { state: 'no-button', detail: `${selector} is an untyped button outside any form` };
  if (b.inForm && !b.formHasField) return { state: 'other-form', detail: selector };
  return null;
}

// On the page: the filled tab by its recorded id (never a fresh or look-alike tab), its address and a filled value, the
// CAPTCHA check and the button, then the pending row, the click and the page's answer. The pending row is logged before
// the click so a click whose apply.submit log later fails still leaves the item used; budget.mjs refuses a second
// pending row for the same item under the action-log lock.
export async function clickSubmit(client, { plan, paths, item, runner, wait = sleep }) {
  const page = await attachById(client, plan.tab?.targetId);
  if (!page) return { state: 'no-tab' };
  const before = await pageUrl(client, page.sessionId);
  if (!before || before !== plan.tab.url) return { state: 'tab-moved', detail: before };
  const s = plan.tab.sentinel;
  if (s && (await readValue(client, page.sessionId, s.selector)) !== s.value) return { state: 'not-filled', detail: s.selector };
  if (await detectCaptcha(client, page.sessionId)) return { state: 'captcha' };
  // A plan from a read that recorded its form (formSelector, null for a whole-page read, which saves no submit) clicks
  // only the button that read found, only inside that form. An older plan (no formSelector) clicks only the submit of a
  // form holding one of its filled fields, never the page's first submit; with none it is refused as a stale read. Every
  // button must also be a real submit of a form holding a filled field.
  const fieldSelectors = (plan.fields ?? []).map((f) => f.selector).filter(Boolean);
  const scoped = plan.formSelector !== undefined;
  if (scoped && !plan.submitSelector) return { state: 'no-button', detail: 'the form read saved none' };
  const selector = scoped ? plan.submitSelector : await submitForFields(client, page.sessionId, fieldSelectors);
  if (!selector) return { state: 'stale-read' };
  if (!(await describeField(client, page.sessionId, selector))) return { state: 'no-button' };
  if (plan.formSelector && !(await insideForm(client, page.sessionId, plan.formSelector, selector))) return { state: 'outside-form', detail: selector };
  const unsafe = unsafeButton(await submitButton(client, page.sessionId, selector, fieldSelectors), selector);
  if (unsafe) return unsafe;
  const signs = signsOf(await evaluate(client, page.sessionId, PAGE_SIGNS));
  // Without the wording before the click no confirmation could ever be shown to be new, so nothing is clicked.
  if (!signs) return { state: 'no-signs' };
  const pending = budgetCall(paths, 'log', 'apply.pending', plan, ['--target', plan.url], runner);
  if (pending.code !== 0) return { state: 'pending-failed', res: pending };
  if (!(await click(client, page.sessionId, selector))) return { state: 'clicked', outcome: { state: 'unconfirmed', detail: 'the button was gone at the click' } };
  const outcome = await submitOutcome(client, page.sessionId, signs, wait);
  // A screenshot is taken only here, to prove what the submit showed; every other read is text. A failed screenshot
  // never stops the outcome from being handled and logged.
  try {
    writeFileSync(join(dirname(plan.planFile), `${item}-submitted.png`), await screenshot(client, page.sessionId));
  } catch {
    outcome.screenshot = 'failed';
  }
  return { state: 'clicked', outcome };
}

const childLine = (res) => (res.stdout || res.stderr || '').trim().split('\n')[0] || `exit ${res.code}`;

async function cmdSubmit({ dataDir, paths, flags, deps, say }) {
  if (!flags.batchId || !Number.isInteger(flags.item)) throw new UsageError('submit needs --batch-id ID --item N');
  const action = SUBMIT_KINDS[flags.kind ?? 'apply'];
  if (!action) throw new UsageError(`--kind must be one of ${Object.keys(SUBMIT_KINDS).join(', ')}`);
  const unapproved = await approvalProblem(dataDir, flags.batchId, flags.item);
  if (unapproved) {
    say(`chrome: ${unapproved}; nothing was clicked`);
    return EXIT.refused;
  }
  const found =resolveSubmitPlan(dataDir, flags.batchId, flags.item);
  if (found.problem) {
    say(`chrome: ${found.problem}; nothing was clicked`);
    return found.refused ? EXIT.refused : EXIT.usage;
  }
  const { plan } = found;
  const scoreArgs = ['--score', String(plan.score ?? 0), '--batch', '1', ...(plan.track ? ['--track', plan.track] : [])];
  const check = budgetCall(paths, 'check', action, plan, scoreArgs, deps.runner);
  if (check.code !== 0) {
    say(`chrome: budget.mjs said ${childLine(check)} (exit ${check.code}); nothing was clicked`);
    return budgetExit(check.code);
  }
  if (found.unverified) {
    say(`chrome: batch ${flags.batchId} has no batch file, so item ${flags.item} cannot be matched to the approved line; nothing was clicked`);
    return EXIT.refused;
  }
  if (!plan.fields?.length) {
    say(`chrome: item ${flags.item} of ${flags.batchId} has no form fields: read the form first (node student/scripts/chrome.mjs read-form --url ${plan.link ?? plan.url}), rebuild the plan (node student/scripts/fill-plan.mjs --replan --batch-id ${flags.batchId} --item ${flags.item}), fill, then submit; nothing was clicked`);
    return EXIT.refused;
  }
  if (unfilled(plan)) {
    say(`chrome: item ${flags.item} of ${flags.batchId} has text fields but no fill typed one (no fill sentinel); ${REFILL(plan)}; nothing was clicked`);
    return EXIT.refused;
  }
  const live = await liveState(dataDir, deps);
  if (!live) {
    say('chrome: automation Chrome is not running; run node student/scripts/chrome.mjs open');
    return EXIT.notRunning;
  }
  const clicked = await withBrowser(live.port, (client) => clickSubmit(client, { plan, paths, item: flags.item, runner: deps.runner, wait: deps.wait }), deps);
  return afterClick({ clicked, plan, paths, flags, action, dataDir, deps, say });
}

// Adds a clicked job to finish these yourself. When the batch file stays locked, says so and returns false, so the caller
// exits 5 instead of throwing; the pending row still keeps the job from being clicked again.
function finishAfterClick(addFinish, dataDir, flags, entry, say) {
  try {
    addFinish(dataDir, flags.batchId, entry);
    return true;
  } catch (err) {
    if (!(err instanceof LockTimeoutError)) throw err;
    say(`chrome: item ${flags.item} of ${flags.batchId}: the submit was clicked (${entry.reason}) but the batch file stayed locked, so it could not be added to finish these yourself and is not logged as submitted; its pending row keeps it from being clicked again. Ask the student to check the open tab (${entry.link}).`);
    return false;
  }
}

// Adds a refused job (nothing clicked) to finish these yourself and says how that went: a missing batch file or one
// that stays locked is named, not thrown, since the refusal itself already stands.
function finishRefused(addFinish, dataDir, flags, entry) {
  try {
    addFinish(dataDir, flags.batchId, entry);
    return `added to finish these yourself (${entry.reason}: ${entry.link})`;
  } catch (err) {
    return `it could not be added to finish these yourself (${err.message}); finish it by hand (${entry.link})`;
  }
}

const REFILL = (plan) => `fill it again with node student/scripts/chrome.mjs fill --plan ${plan.planFile}, then submit`;

// A plan with a text field to type whose last fill typed none (its tab has no sentinel): submitting would click on a
// blank or half-filled form, the same rule the autopilot's fill hold applies.
export const unfilled = (plan) => !plan.tab?.sentinel && (plan.fields ?? []).some((f) => f.selector && !f.slot && TEXT_TYPES.has(String(f.type ?? '').toLowerCase()));

export function afterClick({ clicked, plan, paths, flags, action, dataDir, deps = {}, say }) {
  const link = plan.link ?? plan.url;
  const stops = {
    'no-tab': () => `the tab filled for item ${flags.item} is gone; ${REFILL(plan)}`,
    'tab-moved': () => `the tab filled for item ${flags.item} now shows ${clicked.detail ?? 'another page'}; ${REFILL(plan)}`,
    'not-filled': () => `the tab for item ${flags.item} no longer holds its filled ${clicked.detail}; ${REFILL(plan)}`,
    'no-signs': () => `the page wording for item ${flags.item} could not be read before the click, so a submit could never be confirmed`,
    'pending-failed': () => `budget.mjs refused or could not record the pending submit (${childLine(clicked.res)})`,
  };
  if (stops[clicked.state]) {
    say(`chrome: ${stops[clicked.state]()}; nothing was clicked`);
    return EXIT.refused;
  }
  // No safe submit button: the same markup refuses on every run, so the job goes to finish these yourself with its
  // reason and link (the autopilot then leaves it alone) instead of being refilled and refused each day.
  const unsafe = {
    'no-button': () => [`no safe submit button${clicked.detail ? ` (${clicked.detail})` : ''}`, 'no safe submit button in the form read'],
    'outside-form': () => [`the submit button ${clicked.detail ?? ''} is outside the form that was read`, 'the submit button is outside the form read'],
    'other-form': () => [`the submit button ${clicked.detail ?? ''} is in a form holding none of the filled fields`, 'the submit button is in a form holding none of the filled fields'],
    'stale-read': () => ['the saved form read names no form, and no form holding the filled fields has a safe submit button', 'saved form read is too old; read the form again'],
  };
  if (unsafe[clicked.state]) {
    const [why, reason] = unsafe[clicked.state]();
    say(`chrome: ${why}; ${finishRefused(deps.addFinishYourself ?? addFinishYourself, dataDir, flags, { company: plan.company, role: plan.role, link, reason })}; nothing was clicked`);
    return EXIT.refused;
  }
  if (clicked.state === 'captcha') {
    addFinishYourself(dataDir, flags.batchId, { company: plan.company, role: plan.role, link });
    say(`chrome: blocked: ${siteOf(plan.url)} shows a CAPTCHA; added to finish these yourself; nothing was clicked`);
    return EXIT.captcha;
  }
  const outcome = clicked.outcome ?? { state: 'unconfirmed' };
  const addFinish = deps.addFinishYourself ?? addFinishYourself;
  const finish = (reason) => finishAfterClick(addFinish, dataDir, flags, { company: plan.company, role: plan.role, link, reason }, say);
  if (outcome.state === 'captcha') {
    if (!finish('CAPTCHA on submit')) return EXIT.needsUser;
    say(`chrome: item ${flags.item} of ${flags.batchId} was not submitted: ${siteOf(plan.url)} showed a CAPTCHA after the click; added to finish these yourself (${link})`);
    return EXIT.captcha;
  }
  if (outcome.state === 'invalid') {
    if (!finish(`form refused: ${outcome.detail || 'a field error'}`)) return EXIT.needsUser;
    say(`chrome: item ${flags.item} of ${flags.batchId} was not submitted: the form refused it (${outcome.detail || 'a field error'}). It is not logged as submitted and is on finish these yourself; tell the student which field to fix and finish it in the open tab (${link}).`);
    return EXIT.needsUser;
  }
  if (outcome.state !== 'confirmed') {
    if (!finish(`clicked, not confirmed: ${outcome.detail || 'no confirmation shown'}`)) return EXIT.needsUser;
    say(`chrome: item ${flags.item} of ${flags.batchId}: the submit was clicked but the page showed no confirmation (${outcome.detail || 'nothing decisive'}), so it is not logged as submitted and is on finish these yourself; its pending row keeps it from being clicked again. Ask the student to check the open tab (${link}).`);
    return EXIT.needsUser;
  }
  const log = budgetCall(paths, 'log', action, plan, plan.track ? ['--track', plan.track, '--target', plan.url] : ['--target', plan.url], deps.runner);
  if (log.code !== 0) {
    say(`chrome: item ${flags.item} of ${flags.batchId} was submitted but budget.mjs log ${action} failed (${childLine(log)}); its pending row keeps it from being submitted again. Tell the student before any other submit today.`);
    return EXIT.needsUser;
  }
  say(`chrome: submitted item ${flags.item} of ${flags.batchId} (${outcome.detail})`);
  return EXIT.ok;
}

export const HANDLERS = { open: cmdOpen, status: cmdStatus, read: cmdRead, 'read-form': cmdReadForm, close: cmdClose, fill: cmdFill, submit: cmdSubmit };
export const COMMANDS = Object.keys(HANDLERS);
export const FLAGS = { headless: 'boolean', plan: 'string', 'batch-id': 'string', item: 'int', kind: 'string', links: 'boolean', url: 'string' };

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
