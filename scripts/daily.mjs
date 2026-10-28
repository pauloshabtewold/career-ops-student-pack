#!/usr/bin/env node
// Zero-token unattended run. It never opens a browser, never calls a language model and never sends anything:
// upstream is reached only through its command-line scripts (lib/upstream.mjs runner) and the pack steps are
// local file work. A failed step lands in the digest and the run still exits 0, so a scheduler never retries it.
// Usage: daily.mjs [--root R] [--data-dir D] [--today YYYY-MM-DD] [--log-file F]
// Files: data/.student-daily.lock (run lock), data/.snapshots/<date>/, data/digest/student-<date>.md, data/run-log.md
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runCli } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { LockTimeoutError, acquireLock, releaseLock } from '../lib/dir-lock.mjs';
import { parsePipeline, sectionRows } from '../lib/pipeline-md.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { defaultRunner } from '../lib/upstream.mjs';
import { effectiveLimits } from './budget.mjs';

const STEP_TIMEOUT_MS = 30 * 60 * 1000;
const HOUR_MS = 3600000;
const SNAPSHOT_DIR = /^\d{4}-\d{2}-\d{2}$/;

const oneLine = (text, max = 160) => String(text ?? '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, max) ?? '';
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
  const folders = readdirSync(snaps, { withFileTypes: true }).filter((e) => e.isDirectory() && SNAPSHOT_DIR.test(e.name)).map((e) => e.name).sort();
  const dropped = folders.slice(0, Math.max(0, folders.length - keep));
  for (const name of dropped) rmSync(join(snaps, name), { recursive: true, force: true });
  return dropped.length;
}

export async function dailyRun({ root, dataDir, packRoot, today, now, logFile, runner = defaultRunner }) {
  const say = (line) => {
    console.log(line);
    if (logFile) appendFileSync(logFile, `${line}\n`);
  };
  const stamp = () => now().toISOString();
  const runLog = join(dataDir, 'run-log.md');
  mkdirSync(dataDir, { recursive: true });
  const log = (line) => appendFileSync(runLog, `${line}\n`);

  const config = await loadStudentConfig({ root });
  const limits = config ? effectiveLimits(config).values : effectiveLimits({}).values;
  const staleMs = limits.run_lock_hours * HOUR_MS;
  const lockOptions = { staleMs, timeoutMs: 0 };
  const lockFile = join(dataDir, '.student-daily');
  let lock;
  try {
    lock = await acquireLock(lockFile, lockOptions);
  } catch (err) {
    if (!(err instanceof LockTimeoutError)) throw err;
    const startedAt = Date.parse(err.owner?.started_at ?? '');
    if (Number.isFinite(startedAt) && Date.now() - startedAt >= staleMs && err.owner?.token) {
      // A holder past the run lock age is a hung run: its lock is replaced.
      releaseLock(err.lockDir, err.owner.token);
      lock = await acquireLock(lockFile, lockOptions).catch(() => null);
    }
    if (!lock) {
      log(`ABORT ${stamp()} student-daily: another run holds the lock (pid ${err.owner?.pid ?? 'unknown'})`);
      say('student-daily: another run is in progress; nothing ran');
      return 0;
    }
  }

  const results = [];
  const step = (name, fn) => {
    try {
      results.push({ name, ok: true, detail: oneLine(fn()) });
    } catch (err) {
      results.push({ name, ok: false, detail: oneLine(err.stderr || err.stdout || err.message) || 'failed' });
    }
  };
  const upstream = (script, args = []) => runner(process.execPath, [join(root, script), ...args], { cwd: root, timeout: STEP_TIMEOUT_MS });
  const pack = (script, args = []) => runner(process.execPath, [join(packRoot, 'scripts', script), ...args, '--root', root, '--data-dir', dataDir], { cwd: root, timeout: STEP_TIMEOUT_MS });

  try {
    log(`START ${stamp()} student-daily ${today}`);
    if (!config) {
      results.push({ name: 'config', ok: false, detail: 'config/student.yml is missing; run the personalization interview' });
    } else {
      let dropped = 0;
      step('snapshot', () => {
        dropped = snapshot({ dataDir, today, keep: limits.snapshots_kept });
        return `kept the newest ${limits.snapshots_kept}, removed ${dropped}`;
      });
      const markerFile = join(dataDir, '.student-monthly');
      const monthly = monthlyDue(today, readIf(markerFile));
      if (monthly) {
        step('cycle', () => pack('cycle.mjs'));
        step('discover-github-lists', () => pack('discover-github-lists.mjs'));
        step('audit-portals', () => upstream('audit-portals.mjs', ['--summary']));
        writeFileSync(markerFile, `${today.slice(0, 7)}\n`);
      }
      step('github-lists', () => upstream('plugins.mjs', ['run', 'github-lists']));
      step('scan', () => upstream('scan.mjs'));
      if (isSunday(today)) step('liveness-sweep', () => pack('liveness-sweep.mjs'));
      step('merge-post', () => pack('merge-post.mjs', ['--today', today]));
      step('prefilter+triage', () => {
        const verdicts = pack('prefilter.mjs');
        if (!verdicts.trim()) return 'no title-level rejects';
        const tmp = mkdtempSync(join(tmpdir(), 'daily-triage-'));
        try {
          const file = join(tmp, 'prefilter.txt');
          writeFileSync(file, verdicts);
          return pack('apply-triage.mjs', [file]);
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      });
    }

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
      '## Pipeline',
      `- Pending rows: ${pending}`,
      '',
    ].join('\n');
    mkdirSync(join(dataDir, 'digest'), { recursive: true });
    writeFileSync(join(dataDir, 'digest', `student-${today}.md`), digest);
    log(`END ${stamp()} student-daily ok=${results.length - failed.length} failed=${failed.length}`);
    say(`student-daily: ${results.length - failed.length} step(s) ok, ${failed.length} failed; digest at data/digest/student-${today}.md`);
  } catch (err) {
    log(`END ${stamp()} student-daily error=${oneLine(err.message)}`);
    say(`student-daily: stopped early (${oneLine(err.message)})`);
  } finally {
    lock.release();
  }
  return 0;
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { 'log-file': 'string' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  let timezone = '';
  try {
    timezone = (await loadStudentConfig({ root: paths.root }))?.timezone ?? '';
  } catch {
    timezone = '';
  }
  const clock = createClock({ today: flags.today, timezone });
  return dailyRun({ root: paths.root, dataDir: paths.dataDir, packRoot: paths.packRoot, today: clock.today(), now: clock.now, logFile: flags.logFile });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  // Config problems and unexpected errors are logged by the run; the scheduler must still see exit 0.
  await runCli(() => main().catch((err) => {
    console.log(`student-daily: stopped (${oneLine(err.message)})`);
    return 0;
  }));
}
