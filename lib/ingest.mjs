// The ordered steps that bring new postings into data/pipeline.md. The unattended daily run and the first run share
// this list so the two can never drift apart. Upstream is reached only through its command-line scripts.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { loadMerged } from './presets.mjs';
import { scanErrorLine, scanFileCounts } from './scan-errors.mjs';
import { withTempDir } from './temp-dir.mjs';

// Ceiling for one child step. A step that runs past it is killed and recorded as failed; the later steps still run.
export const STEP_TIMEOUT_MS = 30 * 60 * 1000;

// Child-process helpers rooted at the career-ops folder: one for upstream scripts, one for pack scripts.
export function stepRunners({ root, dataDir, packRoot, runner }) {
  return {
    upstream: (script, args = [], opts = {}) => runner(process.execPath, [join(root, script), ...args], { cwd: root, timeout: STEP_TIMEOUT_MS, ...opts }),
    pack: (script, args = []) => runner(process.execPath, [join(packRoot, 'scripts', script), ...args, '--root', root, '--data-dir', dataDir], { cwd: root, timeout: STEP_TIMEOUT_MS }),
  };
}

// One invocation of the sliced scan stops starting companies after this long, and a single company is cut off after at
// most SLICE_COMPANY_MS beyond it, so a slice ends well inside a 10-minute command limit.
export const SCAN_SLICE_MS = 5 * 60 * 1000;
const SLICE_COMPANY_MS = 90 * 1000;
const SLICE_MIN_START_MS = 30 * 1000;
const SLICE_STATE = 'student-first-scan.json';

const wasKilled = (err) => err?.code === 'ETIMEDOUT' || err?.killed || err?.signal;

// The interview reads at most this many slices; what is left stays for the daily run, which scans everything.
export const INTERVIEW_MAX_SLICES = 2;

const RESEARCH_BLOCK = /^[ \t]*# student-pack:start research_companies\n([\s\S]*?)^[ \t]*# student-pack:end research_companies[ \t]*$/m;
const squash = (text) => String(text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Names of the boards research added, from the research_companies block of portals.yml.
function researchNames(portalsText) {
  const hit = RESEARCH_BLOCK.exec(portalsText);
  const list = hit ? yaml.load(hit[1]) : null;
  return new Set((Array.isArray(list) ? list : []).map((c) => c?.name).filter((n) => typeof n === 'string'));
}

// The order a slice reads the companies in: the boards research just added, then the student's target employers, then the
// rest with the ones whose name or careers URL holds a city from the student's locations first (the earlier the location,
// the earlier the board). The preset seeds carry no location, so a name or URL that names a city is the only hint there is.
// The order inside each group is the file's.
export function scanOrder(companies, { researched = new Set(), targets = [], locations = [] }) {
  const targetKeys = new Set(targets.map(squash));
  const cities = locations.map((l) => squash(String(l).split(',')[0])).filter((c) => c && !/^remote/.test(c));
  const rank = (c) => {
    if (researched.has(c.name)) return 0;
    if (targetKeys.has(squash(c.name))) return 1;
    const hay = squash(`${c.name} ${c.careers_url ?? ''}`);
    const near = cities.findIndex((city) => hay.includes(city));
    return near === -1 ? 3 + cities.length : 2 + near;
  };
  return companies.map((c, i) => ({ c, i, r: rank(c) })).sort((a, b) => a.r - b.r || a.i - b.i).map(({ c }) => c.name);
}

// The first run's scan in slices: one upstream `scan.mjs --company <name>` per enabled company in portals.yml, as many as
// fit in budgetMs, then a line saying how many are left. data/student-first-scan.json keeps the companies done today and
// the slices used, so the next call continues where this one stopped. Companies go in scanOrder; maxSlices stops the pass
// after that many slices and leaves the rest to the daily run. A company that is cut off by its own limit or fails twice
// is left to the daily run, which scans everything. reset starts a fresh pass. The result is a one-line detail for the
// step report.
export function sliceScan({ root, dataDir, upstream, today, budgetMs = SCAN_SLICE_MS, now = Date.now, reset = false, maxSlices = Infinity, targets = [], locations = [] }) {
  const portals = join(root, 'portals.yml');
  const portalsText = existsSync(portals) ? readFileSync(portals, 'utf8') : '';
  const doc = portalsText ? yaml.load(portalsText) : null;
  const enabled = (Array.isArray(doc?.tracked_companies) ? doc.tracked_companies : []).filter((c) => c && c.enabled !== false && typeof c.name === 'string');
  const names = scanOrder([...new Map(enabled.map((c) => [c.name, c])).values()], { researched: researchNames(portalsText), targets, locations });
  const file = join(dataDir, SLICE_STATE);
  let state = { today, done: [], slow: [], slices: 0 };
  if (!reset && existsSync(file)) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (saved.today === today && Array.isArray(saved.done) && Array.isArray(saved.slow)) state = { slices: 0, ...saved };
    } catch {
      // An unreadable state file starts a fresh pass.
    }
  }
  const slow = () => (state.slow.length ? `; ${state.slow.length} not finished (${state.slow.join(', ')}), left to the daily run` : '');
  const report = () => {
    const remaining = names.filter((n) => !state.done.includes(n)).length;
    const done = names.length - remaining;
    if (!remaining) return `scan complete: ${names.length} companies${slow()}`;
    if (state.slices >= maxSlices) return `scan stopped after ${state.slices} slices: ${done} of ${names.length} companies done, ${remaining} left to the daily run; go on to the next step${slow()}`;
    return `scan partial: ${done} of ${names.length} companies done, ${remaining} left; run the same command again${slow()}`;
  };
  if (state.slices >= maxSlices) return report();
  const started = now();
  for (const name of names) {
    if (state.done.includes(name)) continue;
    const left = budgetMs - (now() - started);
    if (left < SLICE_MIN_START_MS) break;
    const timeout = Math.min(STEP_TIMEOUT_MS, Math.max(left, SLICE_COMPANY_MS));
    try {
      try {
        upstream('scan.mjs', ['--company', name], { timeout });
      } catch (err) {
        if (wasKilled(err)) throw err;
        upstream('scan.mjs', ['--company', name], { timeout });
      }
    } catch {
      state.slow.push(name);
    }
    state.done.push(name);
    writeFileSync(file, JSON.stringify(state));
  }
  state.slices += 1;
  writeFileSync(file, JSON.stringify(state));
  return report();
}

const UPSTREAM_COUNT = /github-lists ingest: \d+ found, \d+ new\.?/;
const STATS_FILE = 'student-github-stats.tsv';

const statsLines = (dataDir) => {
  const file = join(dataDir, STATS_FILE);
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
};

// Upstream counts what the host admitted after its own gate, which is 0 for a list the pack already merged. The plugin's
// own stats rows (date name fetched eligible unique_new parse_errors failed) written during this step say what was read.
export function withListStats(output, dataDir, linesBefore) {
  const rows = statsLines(dataDir).slice(linesBefore).map((l) => l.split('\t')).filter((r) => r[0] !== 'date');
  const read = rows.filter((r) => r[6] !== '1');
  const sum = (i) => read.reduce((n, r) => n + (Number(r[i]) || 0), 0);
  const failed = rows.length - read.length;
  const text = `github-lists: ${read.length} list(s) read, ${sum(3)} eligible postings, ${sum(4)} new rows${failed ? `, ${failed} failed` : ''}`;
  if (!UPSTREAM_COUNT.test(output)) return output;
  // Any other output (a time-budget deferral warning) follows the count line, so a step's first line is always the count.
  const rest = output.replace(UPSTREAM_COUNT, '').split('\n').map((l) => l.trim()).filter(Boolean);
  return [text, ...rest].join('\n');
}

// sweep adds the weekly liveness check between the scan and the merge; the first run has no postings old enough to sweep.
export function ingestStepNames({ sweep = false, feeds = [] } = {}) {
  return ['github-lists', ...feeds, 'scan', ...(sweep ? ['liveness-sweep'] : []), 'merge-post', 'prefilter+triage'];
}

// step(name, fn) runs one step and records its outcome; the caller decides what a failure means.
// scan, when given, replaces the one-shot scan step (the first run passes the sliced scan).
export function ingestSteps({ root, dataDir, packRoot, today, runner, step, sweep = false, feeds = [], scan = null, flag = () => {} }) {
  const { upstream, pack } = stepRunners({ root, dataDir, packRoot, runner });
  step('github-lists', () => {
    const before = statsLines(dataDir).length;
    return withListStats(upstream('plugins.mjs', ['run', 'github-lists']), dataDir, before);
  });
  for (const id of feeds) step(id, () => upstream('plugins.mjs', ['run', id]));
  // A board fetch that dies mid-scan ("terminated") makes scan.mjs exit non-zero after it has recorded the boards that
  // worked. One more pass reads only what is still unseen, so a flaky board does not cost the student that run. Only an
  // exit the scan chose itself is retried: a STEP_TIMEOUT_MS kill or a signal is not, so the step costs at most one
  // timeout.
  // flag(line) reports a problem the step's exit code does not show (boards the scan could not read).
  step('scan', () => {
    if (scan) return scan(upstream);
    const before = scanFileCounts(dataDir);
    try {
      return upstream('scan.mjs');
    } catch (err) {
      if (err?.code === 'ETIMEDOUT' || err?.killed || err?.signal) throw err;
      return upstream('scan.mjs');
    } finally {
      try {
        const line = scanErrorLine(dataDir, before);
        if (line) flag(line);
      } catch {
        // An unreadable scan record must not turn a finished scan into a failed step.
      }
    }
  });
  if (sweep) step('liveness-sweep', () => pack('liveness-sweep.mjs'));
  step('merge-post', () => pack('merge-post.mjs', ['--today', today]));
  step('prefilter+triage', () => {
    const verdicts = pack('prefilter.mjs');
    if (!verdicts.trim()) return 'no title-level rejects';
    return withTempDir('ingest-triage-', (tmp) => {
      const file = join(tmp, 'prefilter.txt');
      writeFileSync(file, verdicts);
      return pack('apply-triage.mjs', [file]);
    });
  });
}

// Feed plugins besides github-lists that this student's presets ask for and the student enabled. A plugin the
// student has not enabled is left out, so the run does not report a refusal every day.
export function presetFeedPlugins({ root, presets = [] }) {
  const file = join(root, 'config', 'plugins.yml');
  if (!existsSync(file)) return [];
  const enabled = (yaml.load(readFileSync(file, 'utf8')) ?? {}).plugins ?? {};
  const merged = presets.length ? loadMerged(presets) : null;
  const feeds = [];
  if (merged?.sources?.nyc_jobs && enabled['nyc-jobs']?.enabled === true) feeds.push('nyc-jobs');
  if (merged?.sources?.usajobs && enabled.usajobs?.enabled === true) feeds.push('usajobs');
  return feeds;
}
