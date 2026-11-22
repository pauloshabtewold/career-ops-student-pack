#!/usr/bin/env node
// The setup checklist after install, run by plain code with zero model calls: install state, interview done, resume
// built from the template and passing check-resume, automation Chrome open, the student's one-time sign-ins (LinkedIn,
// Gmail, Handshake), schedule installed. It fixes what it can itself (folders, defaults, the resume build) and stops only
// at a step that is the student's: a sign-in. Every run ends with the Next/Type/Why block.
// Usage: setup-flow.mjs [--signed-in LinkedIn,Gmail,Handshake] [--slot-cmd CMD] [--root R] [--data-dir D] [--today D]
// Exit 0 always; the block says what is next.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, parseArgs, runCli } from '../lib/args.mjs';
import { listBatches, readBatch } from '../lib/batch-file.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig, writeConfigKey } from '../lib/config.mjs';
import { isOn, readOverrides } from '../lib/levers.mjs';
import { SIGN_IN_SITES, guidedFooter, nextStep } from '../lib/next-step.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { matchQuestion, normalize, readProfileAnswers } from '../lib/profile-answers.mjs';
import { runResult } from '../lib/run.mjs';
import { append, zeroRow } from '../lib/usage-ledger.mjs';

export const STATE_FILE = 'setup-state.json';
export const CACHE_FILE = '.profile-cache.json';

// Parsed setup state, or an empty sign-in map when no file exists.
// A missing or unreadable state file reads as nothing done yet, so session-start keeps going and setup-flow redoes the
// steps.
export function readSetupState(dataDir) {
  const file = join(dataDir, STATE_FILE);
  if (!existsSync(file)) return { signins: {} };
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'));
    return state && typeof state === 'object' && !Array.isArray(state) ? state : { signins: {} };
  } catch {
    return { signins: {} };
  }
}

const writeState = (dataDir, state) => {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
};

const sha = (text) => createHash('sha256').update(text).digest('hex');

// cv.md and profile.yml are parsed once per content hash, so later steps read the cache instead of the files (T15).
export function cachedProfile({ root, dataDir, cacheOn = true }) {
  const read = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');
  const cv = read(join(root, 'cv.md'));
  const profile = read(join(root, 'config', 'profile.yml'));
  const key = sha(`${cv}\0${profile}`);
  const file = join(dataDir, CACHE_FILE);
  if (cacheOn && existsSync(file)) {
    const cached = JSON.parse(readFileSync(file, 'utf8'));
    if (cached.key === key) return { ...cached, fromCache: true };
  }
  const facts = { key, name: /^#\s+(.+)$/m.exec(cv)?.[1]?.trim() ?? '', sections: [...cv.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim()), hasProfile: Boolean(profile) };
  if (cacheOn) {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(file, `${JSON.stringify(facts)}\n`);
  }
  return { ...facts, fromCache: false };
}

// The pipeline half of the next-step state: batches waiting, finish-yourself items.
// Unknown questions are read from the fill plans of batches still waiting for approval; with answers given, a question
// the answer bank now covers no longer counts.
export function pipelineState(dataDir, { answers = null } = {}) {
  const batches = listBatches(dataDir).map((id) => readBatch(dataDir, id)).filter(Boolean);
  const waiting = batches.filter((b) => !b.approved && b.items.length);
  const unknown = new Set();
  for (const it of waiting.flatMap((b) => b.items)) {
    if (!it.plan || !existsSync(it.plan)) continue;
    try {
      for (const q of JSON.parse(readFileSync(it.plan, 'utf8')).unknown ?? []) if (!answers || matchQuestion(answers, q) === undefined) unknown.add(normalize(q));
    } catch {
      // an unreadable plan adds no question
    }
  }
  return { batchesWaiting: waiting.length, unknownQuestions: unknown.size, finishYourself: batches.reduce((n, b) => n + (b.finishYourself?.length ?? 0), 0) };
}

export const setupComplete = (state) => Boolean(state.installed && state.interview && state.resume && state.chrome && state.schedule && SIGN_IN_SITES.every((s) => state.signins?.[s]));

// Default steps. Imported on use so session-start, which reads only the state helpers, loads none of them.
function defaultDeps({ paths, config }) {
  const script = (name) => join(paths.packRoot, 'scripts', name);
  return {
    buildResume: async ({ cvFile, outDir }) => (await import('./build-resume.mjs')).buildResume({ root: paths.root, cvFile, outDir, config }),
    atsCheck: async (files) => (await import('./fill-plan.mjs')).atsCheck(files),
    // chrome.mjs open runs the browser-slot gate itself and returns at once when the automation Chrome is already up.
    chrome: async () => runResult(process.execPath, [script('chrome.mjs'), 'open', '--root', paths.root, '--data-dir', paths.dataDir], { cwd: paths.root }),
    // Only checks: installing the schedule picks a time, which is the interview's Part D answer.
    schedule: async () => ({ code: (await import('./schedule.mjs')).readJob() ? 0 : 1 }),
    say: (line) => console.log(line),
  };
}

const lastLine = (res) => String(res?.error || res?.stdout || res?.stderr || '').trim().split('\n').pop();

/**
 * Runs the steps in order and stops at the first one that is not done; deps { buildResume, atsCheck, chrome, schedule,
 * say } are injected by tests. Returns { lines, state, next }.
 */
export async function setupFlow({ paths: given, flags = {}, today, deps = {} }) {
  const paths = { ...resolvePaths({ root: given.root, dataDir: given.dataDir }), ...given };
  mkdirSync(paths.dataDir, { recursive: true });
  const config = await loadStudentConfig({ root: paths.root }).catch(() => null);
  const d = { ...defaultDeps({ paths, config }), ...deps };
  const lines = [];
  const say = (line) => {
    lines.push(line);
    d.say(line);
  };

  const slot = String(flags.slotCmd ?? process.env.BROWSER_SLOT_CMD ?? '').trim();
  if (config && slot && config.browser?.slot_cmd !== slot) {
    writeConfigKey({ root: paths.root }, 'browser.slot_cmd', slot);
    say('setup: browser slot command saved to config/student.yml');
  }

  const state = { signins: {}, ...readSetupState(paths.dataDir) };
  for (const site of String(flags.signedIn ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const known = SIGN_IN_SITES.find((s) => s.toLowerCase() === site.toLowerCase());
    if (known) state.signins = { ...state.signins, [known]: true };
  }

  const cvFile = join(paths.root, 'cv.md');
  const resumeDir = join(paths.dataDir, 'resume');
  const steps = [
    ['installed', async () => existsSync(join(paths.packRoot, 'scripts', 'budget.mjs'))],
    ['interview', async () => Boolean(config?.onboarding?.complete)],
    ['resume', async () => {
      if (state.resume && existsSync(join(resumeDir, 'resume.pdf'))) return true;
      if (!existsSync(cvFile)) return say('setup: resume waits for cv.md in your career-ops folder'), false;
      cachedProfile({ root: paths.root, dataDir: paths.dataDir, cacheOn: isOn('T15', { overrides: readOverrides(paths.root) }) });
      const built = await d.buildResume({ root: paths.root, cvFile, outDir: resumeDir, config });
      if (!built?.pdf || (built.code !== undefined && built.code !== 0)) return say(`setup: resume could not be built (${lastLine(built)})`), false;
      const check = await d.atsCheck({ pdf: built.pdf, html: built.html });
      if (!check?.ok) return say(`setup: resume built but failed the ATS check: ${(check?.problems ?? []).join('; ')}`), false;
      say('setup: resume built from the template and passed the ATS check');
      return true;
    }],
    ['chrome', async () => {
      const res = await d.chrome({ root: paths.root, dataDir: paths.dataDir });
      if (res?.code !== 0) say(`setup: automation Chrome did not open (${lastLine(res) || `exit ${res?.code}`})`);
      return res?.code === 0;
    }],
    // Sign-ins are the student's: recorded from --signed-in, never attempted.
    ['signins', async () => SIGN_IN_SITES.every((s) => state.signins[s])],
    ['schedule', async () => (await d.schedule({ root: paths.root }))?.code === 0],
  ];
  // Steps after the first one not done are not re-run; they keep the result saved by an earlier run.
  let stopped = false;
  for (const [name, run] of steps) {
    if (name !== 'signins') state[name] = Boolean(state[name]);
    if (stopped) continue;
    const done = await run();
    if (name !== 'signins') state[name] = done;
    stopped = !done;
  }
  writeState(paths.dataDir, state);

  const report = [['install', state.installed], ['interview', state.interview], ['resume', state.resume], ['automation Chrome', state.chrome], ...SIGN_IN_SITES.map((s) => [`sign-in ${s}`, Boolean(state.signins[s])]), ['schedule', state.schedule]];
  for (const [name, done] of report) say(`setup ${name}: ${done ? 'done' : 'not yet'}`);
  let answers = {};
  try {
    answers = readProfileAnswers(paths.root) ?? {};
  } catch (err) {
    say(`setup: config/profile.yml could not be read (${err.message}); fix it or move it aside, then run setup again. Saved answers are not counted until then.`);
  }
  const next = nextStep({ setup: state, pipeline: pipelineState(paths.dataDir, { answers }) });
  say('');
  for (const line of guidedFooter(next)) say(line);
  await append(paths.dataDir, zeroRow({ date: today, step: 'setup', feature: 'setup', rows: report.length, source: 'session' }));
  return { lines, state, next };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { 'signed-in': 'string', 'slot-cmd': 'string' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const today = createClock({ today: flags.today }).today();
  await setupFlow({ paths, flags, today });
  return 0;
}

if (isMain(import.meta.url)) await runCli(main);
