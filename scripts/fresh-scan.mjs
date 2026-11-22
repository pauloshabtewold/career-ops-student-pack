#!/usr/bin/env node
// Hourly fresh-jobs scan with zero model calls. It reads the public Greenhouse, Lever and Ashby boards of the companies
// in portals.yml, keeps only postings not seen before (data/fresh-seen.tsv), drops rows already in the queue by url key or
// company plus title, runs the free prefilter rules and merges the rest into Pending under the pipeline lock. When the
// schedule reaches Chrome (chrome_in_schedule yes) and the automation Chrome is up, it also reads one LinkedIn past-hour
// saved-search page through chrome.mjs read --links, after budget.mjs allows linkedin.fresh_search, and takes the job cards
// from that text by code: the same seen-file and pipeline dedupe as the boards, then Pending, then a digest line naming
// the new LinkedIn rows. A failed board is named in the digest and the scan goes on. A model sees a row only later, in
// the daily triage or the fresh-jobs mode, and only if it is new.
// Usage: fresh-scan.mjs [--linkedin] [--root R] [--data-dir D] [--today YYYY-MM-DD] [--log-file F]
// --linkedin reads only the LinkedIn page, whatever chrome_in_schedule says: a session in which the student asked for
// fresh LinkedIn jobs reaches the automation Chrome even when the schedule does not.
// The hourly run asks budget.mjs only inside the LinkedIn window (08:00 to 22:00 local): a window refusal is logged and
// would stop the student's LinkedIn work for the whole day.
// Exit 0 always, so the hourly schedule never retries.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { isMain, parseArgs, runCli } from '../lib/args.mjs';
import { boardOf, readBoard } from '../lib/ats-boards.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { readCycle } from '../lib/cycle-file.mjs';
import { withLock } from '../lib/dir-lock.mjs';
import { isOn } from '../lib/levers.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { appendLines, ensureSections, parsePipeline, sectionRows, serializePipeline } from '../lib/pipeline-md.mjs';
import { loadMerged } from '../lib/presets.mjs';
import { politeFetch } from '../lib/robots.mjs';
import { runText } from '../lib/run.mjs';
import { appendDigestLines } from '../lib/triage-budget.mjs';
import { appendTsv, readTsv, writeAtomic } from '../lib/tsv.mjs';
import { urlKey } from '../lib/url-key.mjs';
import { append as appendLedger, zeroRow } from '../lib/usage-ledger.mjs';
import { freshSearchUrl, readArchetypes } from './alert-plan.mjs';
import { applyTriageFile, parseResults } from './apply-triage.mjs';
import { CEILINGS, effectiveLimits } from './budget.mjs';
import { prefilter } from './prefilter.mjs';

export const SEEN_FILE = 'fresh-seen.tsv';
const SEEN_HEADER = ['url_key', 'first_seen'];
const SKELETON = '# Pipeline\n\n## Pending\n\n## Flagged\n\n## Skipped\n\n## Processed\n';
const SECTIONS = ['Pending', 'Flagged', 'Skipped', 'Processed'];

// Boards for the tracked_companies entries in portals.yml text.
export function boardsFrom(portalsText) {
  const doc = portalsText.trim() ? yaml.load(portalsText) : {};
  const companies = Array.isArray(doc?.tracked_companies) ? doc.tracked_companies : [];
  return companies.filter((c) => c && c.enabled !== false && typeof c.name === 'string').map((c) => ({ company: c.name, ...boardOf(c.careers_url ?? '') })).filter((b) => b.kind);
}

const titleKey = (r) => `${String(r.company).toLowerCase().trim()}|${String(r.title).toLowerCase().trim()}`;

// Keeps postings neither seen by an earlier scan nor already in the pipeline by url key or company plus title (T13).
export function newRows(jobs, { seen, pipelineRows }) {
  const inPipeline = new Set(pipelineRows.flatMap((r) => [urlKey(r.url), titleKey(r)]));
  const out = [];
  const taken = new Set();
  for (const j of jobs) {
    const key = urlKey(j.url);
    if (!key || seen.has(key) || inPipeline.has(key) || inPipeline.has(titleKey(j)) || taken.has(key) || taken.has(titleKey(j))) continue;
    taken.add(key);
    taken.add(titleKey(j));
    out.push(j);
  }
  return out;
}

const cell = (s) => String(s ?? '').replace(/[|;\n]/g, ',').trim();
export const rowLine = (j, today) => `- [ ] ${j.url} | ${cell(j.company)} | ${cell(j.title)} | ${cell(j.location) || 'unknown'} | note: src=${j.src ?? 'fresh-scan'}; imported=${today}`;

const JOB_VIEW = /\/jobs\/view\/(?:[^/?#\s]*-)?(\d{6,})/;

// Job cards from chrome.mjs read --links output: a jobs/view link opens a card and the next company link names its
// employer. Only url, company and title are kept; a posting's own text is read later, for new rows only.
export function linkedinJobs(readOutput) {
  const jobs = [];
  const ids = new Set();
  for (const line of String(readOutput ?? '').split('\n')) {
    const m = /^\[\d+\]\s*(.*?)\s*->\s*(\S+)$/.exec(line.trim());
    if (!m || !m[1]) continue;
    const id = JOB_VIEW.exec(m[2])?.[1];
    if (id) {
      if (!ids.has(id)) jobs.push({ url: `https://www.linkedin.com/jobs/view/${id}/`, title: m[1], company: '', src: 'fresh-linkedin' });
      ids.add(id);
      continue;
    }
    const last = jobs[jobs.length - 1];
    if (last && !last.company && /linkedin\.com\/company\//.test(m[2])) last.company = m[1];
  }
  return jobs.map((j) => ({ ...j, company: j.company || 'unknown' }));
}

async function mergeRows(dataDir, rows, today) {
  const file = join(dataDir, 'pipeline.md');
  return withLock(file, () => {
    const doc = ensureSections(parsePipeline(existsSync(file) ? readFileSync(file, 'utf8') : SKELETON));
    const present = new Set(SECTIONS.flatMap((s) => sectionRows(doc, s).map(({ row }) => urlKey(row.url))));
    const fresh = rows.filter((r) => !present.has(urlKey(r.url)));
    appendLines(doc, 'Pending', fresh.map((r) => rowLine(r, today)));
    writeAtomic(file, serializePipeline(doc));
    return fresh.length;
  });
}

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};

// True inside budget.mjs's LinkedIn window, in the student's time zone.
function inLinkedinWindow(config, now) {
  const t = createClock({ timezone: config.timezone }).localTime(now);
  const mins = t.hour * 60 + t.minute;
  return mins >= toMinutes(CEILINGS.window_start.value) && mins < toMinutes(CEILINGS.window_end.value);
}

// Runs a pack script through the runner (stdout, or a throw like execFileSync); returns { ok, out, code }.
function packScript(paths, runner, script, args, timeout) {
  try {
    const out = runner(process.execPath, [join(paths.packRoot, 'scripts', script), ...args, '--root', paths.root, '--data-dir', paths.dataDir], { cwd: paths.root, ...(timeout ? { timeout } : {}) });
    return { ok: true, out: String(out ?? ''), code: 0 };
  } catch (err) {
    return { ok: false, out: String(err.stdout ?? err.message ?? ''), code: err.status ?? 1 };
  }
}

// One LinkedIn past-hour page, only when the schedule reaches Chrome and the budget allows the hourly read. Returns the
// job cards read (empty when nothing was read) and whether a page was read.
function linkedinFresh({ paths, config, runner, notes, now, force = false }) {
  if (!force && (config.chrome_in_schedule !== 'yes' || !inLinkedinWindow(config, now))) return { pages: 0, jobs: [] };
  const url = freshSearchUrl({ config, archetypes: readArchetypes(paths.dataDir) });
  const check = packScript(paths, runner, 'budget.mjs', ['check', 'linkedin.fresh_search']);
  if (!check.ok) return { pages: 0, jobs: [] };
  const read = packScript(paths, runner, 'chrome.mjs', ['read', url, '--links'], 120 * 1000);
  if (!read.ok) {
    notes.push(`fresh scan: LinkedIn page not read (${read.out.trim().split('\n')[0] || `exit ${read.code}`})`);
    return { pages: 0, jobs: [] };
  }
  packScript(paths, runner, 'budget.mjs', ['log', 'linkedin.fresh_search']);
  return { pages: 1, jobs: linkedinJobs(read.out) };
}

// Postings neither seen by an earlier scan nor in the pipeline; T13 off keeps the seen-file check only.
function freshOf(jobs, { seen, pipelineRows }) {
  return isOn('T13') ? newRows(jobs, { seen, pipelineRows }) : jobs.filter((j) => !seen.has(urlKey(j.url)));
}

function readPipelineRows(dataDir) {
  const file = join(dataDir, 'pipeline.md');
  if (!existsSync(file)) return [];
  const doc = parsePipeline(readFileSync(file, 'utf8'));
  return SECTIONS.flatMap((s) => sectionRows(doc, s).map(({ row }) => row));
}

async function readBoards(boards, fetchFn, notes) {
  const jobs = [];
  for (const b of boards) {
    try {
      jobs.push(...(await readBoard(b, fetchFn)));
    } catch (err) {
      notes.push(`fresh scan: ${b.company} board failed (${String(err.message).split('\n')[0]}); the other boards still scanned`);
    }
  }
  return jobs;
}

// The free title and row rules of prefilter.mjs, run in this process on the merged pipeline; failed rows move to
// Skipped through apply-triage's own writer under the pipeline lock. Returns how many rows failed.
async function runPrefilter(paths, config) {
  const read = (name) => (existsSync(join(paths.dataDir, name)) ? readFileSync(join(paths.dataDir, name), 'utf8') : '');
  const lines = prefilter({
    pipelineText: read('pipeline.md'),
    applicationsText: read('applications.md'),
    preset: loadMerged(config.presets ?? [], { root: paths.root }),
    config,
    cycle: readCycle(join(paths.dataDir, 'student-cycle.json')),
  });
  if (!lines.length) return 0;
  await applyTriageFile({ pipelineFile: join(paths.dataDir, 'pipeline.md'), verdicts: parseResults(lines.join('\n')) });
  return lines.length;
}

/** deps: fetchFn (fetch-shaped), robots ({ check }), sleep, runner (child processes), now. Returns { added, failed, linkedinPages, linkedinNew }. */
export async function freshScan({ paths, today, deps = {}, linkedinOnly = false }) {
  const config = (await loadStudentConfig({ root: paths.root })) ?? {};
  const runner = deps.runner ?? runText;
  const fetchFn = politeFetch({
    ...(deps.fetchFn ? { fetch: deps.fetchFn } : {}),
    ...(deps.robots ? { checker: deps.robots } : {}),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
    gapMs: effectiveLimits(config).values.request_gap_ms,
  });
  const boards = linkedinOnly ? [] : boardsFrom(existsSync(paths.portalsFile) ? readFileSync(paths.portalsFile, 'utf8') : '');
  const notes = [];
  const jobs = await readBoards(boards, fetchFn, notes);
  const linkedin = linkedinFresh({ paths, config, runner, notes, now: (deps.now ?? (() => new Date()))(), force: linkedinOnly });
  const seenFile = join(paths.dataDir, SEEN_FILE);
  const seen = new Set((await readTsv(seenFile)).rows.map((r) => r.url_key));
  const fresh = freshOf([...jobs, ...linkedin.jobs], { seen, pipelineRows: readPipelineRows(paths.dataDir) });
  const added = fresh.length ? await mergeRows(paths.dataDir, fresh, today) : 0;
  await appendTsv(seenFile, SEEN_HEADER, fresh.map((j) => ({ url_key: urlKey(j.url), first_seen: today })));
  const failed = added ? await runPrefilter(paths, config) : 0;
  const newLinkedin = fresh.filter((j) => j.src === 'fresh-linkedin').length;
  const linkedinLine = linkedin.pages ? [`fresh LinkedIn page: ${linkedin.jobs.length} job card(s) read, ${newLinkedin} new row(s) in Pending noted src=fresh-linkedin`] : [];
  appendDigestLines({ dataDir: paths.dataDir, today, heading: 'Fresh scan', lines: [`fresh scan: ${boards.length} board(s), ${added} new row(s), ${failed} failed the free rules`, ...linkedinLine, ...notes] });
  await appendLedger(paths.dataDir, [zeroRow({ date: today, step: 'fresh-scan', feature: 'U1', rows: boards.length }), zeroRow({ date: today, step: 'fresh-linkedin', feature: 'M12', rows: linkedin.pages })]);
  return { added, failed: notes.length, linkedinPages: linkedin.pages, linkedinNew: newLinkedin };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { 'log-file': 'string', linkedin: 'boolean' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const config = await loadStudentConfig({ root: paths.root }).catch(() => null);
  const today = createClock({ today: flags.today, timezone: config?.timezone }).today();
  try {
    const res = await freshScan({ paths, today, linkedinOnly: Boolean(flags.linkedin) });
    console.log(`fresh-scan: ${res.added} new row(s)`);
  } catch (err) {
    console.log(`fresh-scan: stopped (${String(err.message).split('\n')[0]})`);
  }
  return 0;
}

if (isMain(import.meta.url)) await runCli(main);
