#!/usr/bin/env node
// Zero-token unattended run. It never opens a browser, never calls a language model and never sends anything:
// upstream is reached only through its command-line scripts (lib/upstream.mjs runner) and the pack steps are
// local file work. A failed step lands in the digest and the run still exits 0, so a scheduler never retries it.
// Usage: daily.mjs [--root R] [--data-dir D] [--today YYYY-MM-DD] [--log-file F] [--via-scheduled] [--dry-run]
// --dry-run prints the planned steps and writes nothing. --via-scheduled is passed only by scheduled.mjs.
// Files: data/.student-daily.lock (run lock), data/.snapshots/<date>/, data/digest/student-<date>.md, data/run-log.md
// The digest's Today section comes from lib/digest.mjs: applied, outreach this week, replies waiting, missed runs
// (data/.missed-runs.txt from scheduled.mjs), the day's token estimate and, on Sundays, the skill gaps.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { ISO_DATE, createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { LockTimeoutError, acquireLock, releaseLock } from '../lib/dir-lock.mjs';
import { feedHealth } from '../lib/feed-health.mjs';
import { ingestStepNames, ingestSteps, presetFeedPlugins, stepRunners } from '../lib/ingest.mjs';
import { parsePipeline, sectionRows } from '../lib/pipeline-md.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { oneLine, stepErrorText } from '../lib/text.mjs';
import { defaultRunner } from '../lib/upstream.mjs';
import { effectiveLimits } from './budget.mjs';
import { readActionLog } from '../lib/action-log.mjs';
import { listBatches, readBatch } from '../lib/batch-file.mjs';
import { summaryLines } from '../lib/digest.mjs';
import { weeklySentBy } from '../lib/outreach-state.mjs';
import { skillGaps } from '../lib/skill-gap.mjs';
import { perDayEstimate } from '../lib/usage-cost.mjs';
import { append as appendLedger, zeroRow } from '../lib/usage-ledger.mjs';
import { MISSED_FILE } from './scheduled.mjs';
import { outreachState } from './outreach-state.mjs';

const HOUR_MS = 3600000;
const DAY_MS = 24 * HOUR_MS;
const SEND_ACTIONS = new Set(['apply.submit', 'apply.easy_apply']);

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
export function plannedSteps({ today, markerText, hasConfig, feeds = [] }) {
  if (!hasConfig) return ['config'];
  return ['snapshot', ...(monthlyDue(today, markerText) ? MONTHLY_STEPS : []), ...ingestStepNames({ sweep: isSunday(today), feeds })];
}

// A preset that cannot be read leaves the extra feeds out; github-lists and the scan still run.
function feedsFor(root, config) {
  try {
    return presetFeedPlugins({ root, presets: config?.presets ?? [] });
  } catch {
    return [];
  }
}

function runSteps({ root, dataDir, packRoot, today, config, limits, runner, results, flags }) {
  const step = (name, fn) => {
    try {
      const out = fn();
      // github-lists puts its count line first; a time-budget deferral warning is shown as an extra line.
      const extra = name === 'github-lists' ? String(out ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(1) : [];
      results.push({ name, ok: true, detail: oneLine(out), extra });
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
  ingestSteps({ root, dataDir, packRoot, today, runner, step, sweep: isSunday(today), feeds: feedsFor(root, config), flag: (line) => flags.push(line) });
}

// A health check that throws becomes one digest line; it never fails the run.
function healthLines({ dataDir, today, results }) {
  try {
    return feedHealth({ dataDir, today, results });
  } catch (err) {
    return [`- not checked (${oneLine(err.message)})`];
  }
}

// Saved job text of matched (triage 4.0 and up) rows whose jd= file changed in the last 7 days, for the skill-gap list.
function recentMatchedTexts(dataDir, nowMs) {
  const doc = parsePipeline(readIf(join(dataDir, 'pipeline.md')) || '# Pipeline\n');
  const texts = [];
  for (const { row } of [...sectionRows(doc, 'Pending'), ...sectionRows(doc, 'Processed')]) {
    const jd = row.notes.get('jd');
    if (!jd || !(Number(row.notes.get('triage')) >= 4)) continue;
    const file = join(dataDir, 'jds', jd);
    if (existsSync(file) && nowMs - statSync(file).mtimeMs <= 7 * DAY_MS) texts.push(readFileSync(file, 'utf8'));
  }
  return texts;
}

// The code-built summary (lib/digest.mjs). Any read failure becomes one line; the run never fails on it. Steps waiting
// for Chrome are appended by the autopilot, which knows whether Chrome was reached.
async function digestSummary({ root, dataDir, today, nowMs, config, limits }) {
  try {
    const actions = await readActionLog(join(dataDir, 'action-log.tsv'));
    const state = await outreachState(dataDir, nowMs);
    const sunday = isSunday(today);
    return summaryLines({
      applied: actions.filter((r) => SEND_ACTIONS.has(r.action) && r.date === today).length,
      outreach: { ...weeklySentBy(actions, nowMs), connectLimit: limits.connect_per_rolling_7d },
      replies: state.due.filter((d) => d.action === 'reply' || d.action === 'referral-ask').length,
      missed: readIf(join(dataDir, MISSED_FILE)).trim() || null,
      estimate: perDayEstimate(config),
      sunday,
      skillGaps: sunday ? skillGaps(recentMatchedTexts(dataDir, nowMs), readIf(join(root, 'cv.md'))) : [],
      batchesWaiting: listBatches(dataDir).map((id) => readBatch(dataDir, id)).filter((b) => b && !b.approved && b.items.length).length,
    });
  } catch (err) {
    return ['## Today', `- summary not built (${oneLine(err.message)})`, ''];
  }
}

// Writes the digest and returns the number of failed steps.
function writeDigest({ dataDir, today, results, notes, flags = [], summary = [] }) {
  const pending = sectionRows(parsePipeline(readIf(join(dataDir, 'pipeline.md')) || '# Pipeline\n'), 'Pending').length;
  const failed = results.filter((r) => !r.ok);
  const digest = [
    `# Student daily run ${today}`,
    '',
    '## Steps',
    ...results.flatMap((r) => [`- ${r.name}: ${r.ok ? 'ok' : 'FAILED'}${r.detail ? ` (${r.detail})` : ''}`, ...(r.extra ?? []).map((e) => `- ${r.name}: ${e}`)]),
    '',
    '## Failures',
    ...(failed.length || flags.length ? [...failed.map((r) => `- ${r.name}`), ...flags.map((f) => `- ${f}`)] : ['- none']),
    '',
    ...(notes.length ? ['## Notes', ...notes.map((n) => `- ${n}`), ''] : []),
    '## Feed health',
    ...healthLines({ dataDir, today, results }),
    '',
    '## Pipeline',
    `- Pending rows: ${pending}`,
    '',
    ...summary,
  ].join('\n');
  mkdirSync(join(dataDir, 'digest'), { recursive: true });
  writeFileSync(join(dataDir, 'digest', `student-${today}.md`), digest);
  return failed.length;
}

// Read-only: no lock, snapshot, digest, run log or log file is touched.
async function dryRunReport({ root, dataDir, today }) {
  let hasConfig = false;
  let configError = '';
  let feeds = [];
  try {
    const config = await loadStudentConfig({ root });
    hasConfig = Boolean(config);
    feeds = feedsFor(root, config);
  } catch (err) {
    configError = oneLine(err.message);
  }
  const steps = plannedSteps({ today, markerText: readIf(join(dataDir, '.student-monthly')), hasConfig, feeds });
  console.log(`student-daily dry run: ${steps.length} step(s) would run: ${steps.join(', ')}`);
  if (configError) console.log(`student-daily dry run: config/student.yml is unreadable (${configError}); a real run would stop at the config step`);
  return 0;
}

// The steps, the digest and the zero-token ledger rows of one locked run; returns how many steps failed and ran.
async function lockedRun({ root, dataDir, packRoot, today, now, config, limits, runner, notes }) {
  const results = [];
  const flags = [];
  runSteps({ root, dataDir, packRoot, today, config, limits, runner, results, flags });
  const summary = config ? await digestSummary({ root, dataDir, today, nowMs: now().getTime(), config, limits }) : [];
  const failedCount = writeDigest({ dataDir, today, results, notes, flags, summary });
  if (config) {
    const zero = (step, feature) => zeroRow({ date: today, step, feature, rows: 1 });
    await appendLedger(dataDir, [zero('digest', 'U5'), zero('catch-up', 'G5'), zero('reply-rates', 'G4'), ...(isSunday(today) ? [zero('skill-gap', 'H5')] : [])]);
  }
  return { failedCount, ran: results.length };
}

// Always returns 0, so a scheduler never retries; a failed step is a line in the digest.
export async function dailyRun({ root, dataDir, packRoot, today, now, logFile, runner = defaultRunner, dryRun = false, viaScheduled = false }) {
  const say = (line) => {
    console.log(line);
    if (logFile) appendFileSync(logFile, `${line}\n`);
  };
  if (dryRun) return dryRunReport({ root, dataDir, today });
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
  // scheduled.mjs passes --via-scheduled; without it this is a manual run or a schedule from before the triage wrapper, and neither triages.
  const notes = !viaScheduled && config?.automation === 'scheduled-discovery-plus-triage'
    ? ['this run did not triage: triage runs only when the schedule starts scheduled.mjs; if update.mjs says the schedule is from an older pack, run node student/scripts/schedule.mjs install again']
    : [];
  try {
    log(`START ${stamp()} student-daily ${today}`);
    const { failedCount, ran } = await lockedRun({ root, dataDir, packRoot, today, now, config, limits, runner, notes });
    log(`END ${stamp()} student-daily ok=${ran - failedCount} failed=${failedCount}`);
    say(`student-daily: ${ran - failedCount} step(s) ok, ${failedCount} failed; digest at data/digest/student-${today}.md`);
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
