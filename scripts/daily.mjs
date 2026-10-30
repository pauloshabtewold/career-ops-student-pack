#!/usr/bin/env node
// Zero-token unattended run. It never opens a browser, never calls a language model and never sends anything:
// upstream is reached only through its command-line scripts (lib/upstream.mjs runner) and the pack steps are
// local file work. A failed step lands in the digest and the run still exits 0, so a scheduler never retries it.
// Usage: daily.mjs [--root R] [--data-dir D] [--today YYYY-MM-DD] [--log-file F] [--via-scheduled] [--dry-run]
// --dry-run prints the planned steps and writes nothing. --via-scheduled is passed only by scheduled.mjs.
// Files: data/.student-daily.lock (run lock), data/.snapshots/<date>/, data/digest/student-<date>.md, data/run-log.md
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { ISO_DATE, createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { LockTimeoutError, acquireLock, releaseLock } from '../lib/dir-lock.mjs';
import { ingestStepNames, ingestSteps, stepRunners } from '../lib/ingest.mjs';
import { parsePipeline, sectionRows } from '../lib/pipeline-md.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { oneLine, stepErrorText } from '../lib/text.mjs';
import { defaultRunner } from '../lib/upstream.mjs';
import { effectiveLimits } from './budget.mjs';

const HOUR_MS = 3600000;

const readIf = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

export const isSunday = (today) => new Date(`${today}T00:00:00Z`).getUTCDay() === 0;

// The monthly steps run once, on the first run in days 1 to 7 of a month, so a laptop asleep on the 1st still catches up.
export function monthlyDue(today, marker) {
  return Number(today.slice(8, 10)) <= 7 && marker.trim() !== today.slice(0, 7);
}

export function snapshot({ dataDir, today, keep }) {
  const snaps = join(dataDir, '.snapshots');
  const dir = join(snaps, today);
  mkdirSync(dir, { recursive: true });
  for (const name of ['applications.md', 'pipeline.md']) {
    if (existsSync(join(dataDir, name))) copyFileSync(join(dataDir, name), join(dir, name));
  }
  const folders = readdirSync(snaps, { withFileTypes: true }).filter((e) => e.isDirectory() && ISO_DATE.test(e.name)).map((e) => e.name).sort();
  const dropped = folders.slice(0, Math.max(0, folders.length - keep));
  for (const name of dropped) rmSync(join(snaps, name), { recursive: true, force: true });
  return dropped.length;
}

// Returns the held lock, or null when a live run owns it; a holder past the run lock age is a hung run and is replaced.
async function acquireRunLock(lockFile, staleMs, now) {
  const lockOptions = { staleMs, timeoutMs: 0 };
  try {
    return { lock: await acquireLock(lockFile, lockOptions), owner: null };
  } catch (err) {
    if (!(err instanceof LockTimeoutError)) throw err;
    const startedAt = Date.parse(err.owner?.started_at ?? '');
    if (Number.isFinite(startedAt) && now().getTime() - startedAt >= staleMs && err.owner?.token) {
      releaseLock(err.lockDir, err.owner.token);
      const lock = await acquireLock(lockFile, lockOptions).catch(() => null);
      if (lock) return { lock, owner: null };
    }
    return { lock: null, owner: err.owner };
  }
}

const MONTHLY_STEPS = ['cycle', 'discover-github-lists', 'audit-portals'];

// Step names in run order. Monthly and Sunday steps are listed only on the days they run.
export function plannedSteps({ today, markerText, hasConfig }) {
  if (!hasConfig) return ['config'];
  return ['snapshot', ...(monthlyDue(today, markerText) ? MONTHLY_STEPS : []), ...ingestStepNames({ sweep: isSunday(today) })];
}

function runSteps({ root, dataDir, packRoot, today, config, limits, runner, results }) {
  const step = (name, fn) => {
    try {
      results.push({ name, ok: true, detail: oneLine(fn()) });
    } catch (err) {
      results.push({ name, ok: false, detail: stepErrorText(err) });
    }
  };
  const { upstream, pack } = stepRunners({ root, dataDir, packRoot, runner });

  if (!config) {
    results.push({ name: 'config', ok: false, detail: 'config/student.yml is missing; run the personalization interview' });
    return;
  }
  let dropped = 0;
  step('snapshot', () => {
    dropped = snapshot({ dataDir, today, keep: limits.snapshots_kept });
    return `kept the newest ${limits.snapshots_kept}, removed ${dropped}`;
  });
  const markerFile = join(dataDir, '.student-monthly');
  if (monthlyDue(today, readIf(markerFile))) {
    step('cycle', () => pack('cycle.mjs'));
    step('discover-github-lists', () => pack('discover-github-lists.mjs'));
    step('audit-portals', () => upstream('audit-portals.mjs', ['--summary']));
    writeFileSync(markerFile, `${today.slice(0, 7)}\n`);
  }
  ingestSteps({ root, dataDir, packRoot, today, runner, step, sweep: isSunday(today) });
}

// Writes the digest and returns the number of failed steps.
function writeDigest({ dataDir, today, results, notes }) {
  const pending = sectionRows(parsePipeline(readIf(join(dataDir, 'pipeline.md')) || '# Pipeline\n'), 'Pending').length;
  const failed = results.filter((r) => !r.ok);
  const digest = [
    `# Student daily run ${today}`,
    '',
    '## Steps',
    ...results.map((r) => `- ${r.name}: ${r.ok ? 'ok' : 'FAILED'}${r.detail ? ` (${r.detail})` : ''}`),
    '',
    '## Failures',
    ...(failed.length ? failed.map((r) => `- ${r.name}`) : ['- none']),
    '',
    ...(notes.length ? ['## Notes', ...notes.map((n) => `- ${n}`), ''] : []),
    '## Pipeline',
    `- Pending rows: ${pending}`,
    '',
  ].join('\n');
  mkdirSync(join(dataDir, 'digest'), { recursive: true });
  writeFileSync(join(dataDir, 'digest', `student-${today}.md`), digest);
  return failed.length;
}

// Always returns 0, so a scheduler never retries; a failed step is a line in the digest.
export async function dailyRun({ root, dataDir, packRoot, today, now, logFile, runner = defaultRunner, dryRun = false, viaScheduled = false }) {
  const say = (line) => {
    console.log(line);
    if (logFile) appendFileSync(logFile, `${line}\n`);
  };
  if (dryRun) {
    // Read-only: no lock, snapshot, digest, run log or log file is touched.
    let hasConfig = false;
    let configError = '';
    try {
      hasConfig = Boolean(await loadStudentConfig({ root }));
    } catch (err) {
      configError = oneLine(err.message);
    }
    const steps = plannedSteps({ today, markerText: readIf(join(dataDir, '.student-monthly')), hasConfig });
    console.log(`student-daily dry run: ${steps.length} step(s) would run: ${steps.join(', ')}`);
    if (configError) console.log(`student-daily dry run: config/student.yml is unreadable (${configError}); a real run would stop at the config step`);
    return 0;
  }
  const stamp = () => now().toISOString();
  const runLog = join(dataDir, 'run-log.md');
  mkdirSync(dataDir, { recursive: true });
  if (logFile) mkdirSync(dirname(logFile), { recursive: true });
  const log = (line) => appendFileSync(runLog, `${line}\n`);

  const config = await loadStudentConfig({ root });
  const limits = config ? effectiveLimits(config).values : effectiveLimits({}).values;
  const { lock, owner } = await acquireRunLock(join(dataDir, '.student-daily'), limits.run_lock_hours * HOUR_MS, now);
  if (!lock) {
    log(`ABORT ${stamp()} student-daily: another run holds the lock (pid ${owner?.pid ?? 'unknown'})`);
    say('student-daily: another run is in progress; nothing ran');
    return 0;
  }

  const results = [];
  // Only a schedule-installed job passes --log-file; one that still starts daily.mjs directly predates the triage wrapper.
  const notes = logFile && !viaScheduled && config?.automation === 'scheduled-discovery-plus-triage'
    ? ['daily triage did not run: run node student/scripts/schedule.mjs install again to start it']
    : [];
  try {
    log(`START ${stamp()} student-daily ${today}`);
    runSteps({ root, dataDir, packRoot, today, config, limits, runner, results });
    const failedCount = writeDigest({ dataDir, today, results, notes });
    log(`END ${stamp()} student-daily ok=${results.length - failedCount} failed=${failedCount}`);
    say(`student-daily: ${results.length - failedCount} step(s) ok, ${failedCount} failed; digest at data/digest/student-${today}.md`);
  } catch (err) {
    log(`END ${stamp()} student-daily error=${oneLine(err.message)}`);
    say(`student-daily: stopped early (${oneLine(err.message)})`);
  } finally {
    lock.release();
  }
  return 0;
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { 'log-file': 'string', 'via-scheduled': 'boolean' } });
  let paths = null;
  try {
    paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
    let timezone = '';
    try {
      timezone = (await loadStudentConfig({ root: paths.root }))?.timezone ?? '';
    } catch {
      timezone = '';
    }
    const clock = createClock({ today: flags.today, timezone });
    return await dailyRun({ root: paths.root, dataDir: paths.dataDir, packRoot: paths.packRoot, today: clock.today(), now: clock.now, logFile: flags.logFile, dryRun: flags.dryRun, viaScheduled: flags.viaScheduled });
  } catch (err) {
    // The scheduler must see exit 0 even when a step or the setup fails, so unexpected errors are logged and swallowed.
    // Usage errors are the caller's mistake and still exit 2 through runCli.
    if (err instanceof UsageError) throw err;
    const line = `student-daily: stopped (${oneLine(err.message)})`;
    // A dry run promises to write nothing, so its failure is printed and never logged.
    if (paths && !flags.dryRun) {
      try {
        mkdirSync(paths.dataDir, { recursive: true });
        appendFileSync(join(paths.dataDir, 'run-log.md'), `END ${new Date().toISOString()} ${line}\n`);
      } catch {
        // the console line below is the only record left
      }
    }
    console.log(line);
    return 0;
  }
}

if (isMain(import.meta.url)) {
  await runCli(main);
}
