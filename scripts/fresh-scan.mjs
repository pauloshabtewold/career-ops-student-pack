#!/usr/bin/env node
// Hourly fresh-jobs scan with zero model calls. It reads the public Greenhouse, Lever and Ashby boards of the companies
// in portals.yml, keeps only postings not seen before (data/fresh-seen.tsv), drops rows already in the queue by url key or
// company plus title, runs the free prefilter rules and merges the rest into Pending under the pipeline lock. When the
// schedule reaches Chrome (chrome_in_schedule yes) and the automation Chrome is up, it also reads one LinkedIn past-hour
// saved-search page through chrome.mjs read --links, after budget.mjs allows linkedin.fresh_search and logs it (before the
// read, so a failed read still counts), and takes the job cards from that text by code: the same seen-file and pipeline
// dedupe as the boards, then Pending, then a digest line naming the new LinkedIn rows. A failed board, and a LinkedIn read
// the budget did not allow, is named in the digest and on stdout and the scan goes on. A model sees a row only later, in
// the daily triage or the fresh-jobs mode, and only if it is new.
// The scan writes its own digest, data/digest/fresh-<today>.md, which the daily run never overwrites; a run that found
// nothing writes one line. data/fresh-seen.tsv records each posting's first-seen date, its company plus title and its
// board, so a repost of one title under a new id on a later scan date is counted (reposts= note, one per scan date) and
// the title's earliest scan date is kept (title_since= note) beside the posting's own date (posted= note); daily-triage
// passes the count and the title's age to the ghost rule. A repost dropped by the company-plus-title dedupe is still
// recorded in the seen file and refreshes those notes on its title's Pending row. The first scan of a board adds only
// the newest fresh_first_scan (default 25) open postings and marks the rest seen.
// Usage: fresh-scan.mjs [--linkedin] [--root R] [--data-dir D] [--today YYYY-MM-DD] [--log-file F]
// --linkedin reads only the LinkedIn page, whatever chrome_in_schedule says: a session in which the student asked for
// fresh LinkedIn jobs reaches the automation Chrome even when the schedule does not.
// The hourly run asks budget.mjs only inside the LinkedIn window (08:00 to 22:00 local): a window refusal is logged and
// would stop the student's LinkedIn work for the whole day. It waits a random 0 to 10 minutes first, so the read does
// not land on the same minute every hour; the wait never crosses into the next clock hour, and the window is asked
// again after it.
// Exit 0 always, so the hourly schedule never retries.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
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
import { appendLines, ensureSections, formatRow, getSection, parsePipeline, sectionRows, serializePipeline } from '../lib/pipeline-md.mjs';
import { loadMerged } from '../lib/presets.mjs';
import { politeFetch } from '../lib/robots.mjs';
import { runText } from '../lib/run.mjs';
import { appendTsv, readTsv, writeAtomic } from '../lib/tsv.mjs';
import { urlKey } from '../lib/url-key.mjs';
import { append as appendLedger, zeroRow } from '../lib/usage-ledger.mjs';
import { freshSearchUrl, readArchetypes } from './alert-plan.mjs';
import { applyTriageFile, parseResults } from './apply-triage.mjs';
import { CEILINGS, effectiveLimits } from './budget.mjs';
import { prefilter } from './prefilter.mjs';

export const SEEN_FILE = 'fresh-seen.tsv';
const SEEN_HEADER = ['url_key', 'first_seen', 'title_key', 'board'];
const LINKEDIN_BOARD = 'linkedin';
const JITTER_MS = 10 * 60 * 1000;
const SKELETON = '# Pipeline\n\n## Pending\n\n## Flagged\n\n## Skipped\n\n## Processed\n';
const SECTIONS = ['Pending', 'Flagged', 'Skipped', 'Processed'];

// Boards for the tracked_companies entries in portals.yml text.
export function boardsFrom(portalsText) {
  const doc = portalsText.trim() ? yaml.load(portalsText) : {};
  const companies = Array.isArray(doc?.tracked_companies) ? doc.tracked_companies : [];
  return companies.filter((c) => c && c.enabled !== false && typeof c.name === 'string').map((c) => ({ company: c.name, ...boardOf(c.careers_url ?? '') })).filter((b) => b.kind);
}

const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d ?? '');
const knownCompany = (c) => Boolean(String(c ?? '').trim()) && !/^unknown$/i.test(String(c).trim());
// Company plus title, or null when the company is unknown (a LinkedIn card whose company neither a company link nor the
// page text named): those rows dedupe on their job id alone, so two different postings with one common title both stay.
export const titleKey = (r) => (knownCompany(r.company) ? `${String(r.company).toLowerCase().trim()}|${String(r.title).toLowerCase().trim()}` : null);

// Splits postings not seen by an earlier scan and not in the pipeline by url key into new rows and title repeats (T13).
// A repeat is a new url key whose company plus title is already in the pipeline or taken earlier in this scan: it stays
// out of the queue but is recorded in the seen file, so a title reposted on later scan dates builds up a repost count.
// Company plus title is compared here, before rows enter the queue, and not in daily-triage (RULING SHOULD-9).
export function splitNew(jobs, { seen, pipelineRows }) {
  const inPipeline = new Set(pipelineRows.flatMap((r) => [urlKey(r.url), titleKey(r)]).filter(Boolean));
  const fresh = [];
  const repeats = [];
  const taken = new Set();
  for (const j of jobs) {
    const key = urlKey(j.url);
    const tk = titleKey(j);
    if (!key || seen.has(key) || inPipeline.has(key) || taken.has(key)) continue;
    taken.add(key);
    if (tk && (inPipeline.has(tk) || taken.has(tk))) {
      repeats.push(j);
      continue;
    }
    if (tk) taken.add(tk);
    fresh.push(j);
  }
  return { fresh, repeats };
}

// Keeps postings neither seen by an earlier scan nor already in the pipeline by url key or company plus title (T13).
export const newRows = (jobs, opts) => splitNew(jobs, opts).fresh;

// Repost history of a row already in the queue, from every seen row: the distinct scan dates on which its company plus
// title appeared under another url key, and the title's earliest scan date (its own included). null when none.
export function queuedHistory(row, allSeen) {
  const tk = titleKey(row);
  if (!tk) return null;
  const own = urlKey(row.url);
  const same = allSeen.filter((r) => r.title_key === tk && isDay(r.first_seen));
  const dates = [...new Set(same.filter((r) => r.url_key !== own).map((r) => r.first_seen))].sort();
  if (!dates.length) return null;
  const all = [...dates, ...same.filter((r) => r.url_key === own).map((r) => r.first_seen), row.notes?.get('imported')].filter(isDay).sort();
  return { reposts: dates.length, titleSince: all[0] };
}

// Repost history per job from the seen rows. A repost is the same company plus title under another url key first seen on
// an earlier scan date, and it counts once per scan date: same-title openings in several cities seen in one scan
// (the first, seeding scan included) are one date, not reposts of each other. posted stays the job's own board date, else
// today (its first-seen date), so a new posting is never backdated; titleSince carries the title's earliest scan date.
export function withHistory(jobs, seenRows, today = '') {
  const byTitle = new Map();
  for (const r of seenRows) {
    if (!r.title_key) continue;
    const list = byTitle.get(r.title_key) ?? [];
    list.push(r);
    byTitle.set(r.title_key, list);
  }
  return jobs.map((j) => {
    const tk = titleKey(j);
    const earlier = (tk && byTitle.get(tk)?.filter((r) => r.url_key !== urlKey(j.url) && isDay(r.first_seen) && (!today || r.first_seen < today))) ?? [];
    const dates = [...new Set(earlier.map((r) => r.first_seen))].sort();
    const posted = isDay(j.posted) ? j.posted : isDay(today) ? today : '';
    return { ...j, reposts: dates.length, posted, titleSince: dates[0] ?? '' };
  });
}

const cell = (s) => String(s ?? '').replace(/[|;\n]/g, ',').trim();
const historyNotes = (j) =>
  [j.posted && `posted=${j.posted}`, j.reposts > 0 && `reposts=${j.reposts}`, j.reposts > 0 && j.titleSince && `title_since=${j.titleSince}`]
    .filter(Boolean)
    .map((n) => `; ${n}`)
    .join('');
export const rowLine = (j, today) => `- [ ] ${j.url} | ${cell(j.company)} | ${cell(j.title)} | ${cell(j.location) || 'unknown'} | note: src=${j.src ?? 'fresh-scan'}; imported=${today}${historyNotes(j)}`;

const JOB_VIEW = /\/jobs\/view\/(?:[^/?#\s]*-)?(\d{6,})/;

const LINK_REF = /^\[\d+\]\s*(.*?)\s*->\s*(\S+)$/;
const VERIFIED = /\s+with verification$/i;

// Classic search cards put the visible title, a hidden copy and a "with verification" badge in one anchor's innerText.
function cleanTitle(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim().replace(VERIFIED, '');
  const half = (t.length - 1) / 2;
  return Number.isInteger(half) && t[half] === ' ' && t.slice(0, half) === t.slice(half + 1) ? t.slice(0, half) : t;
}

const sane = (s) => Boolean(s) && s.length < 100 && !s.includes('://');

// Finds a card in the page text, searching only from `from` on: cards and their anchors come in the same order, so a
// cursor keeps two cards with one title (or one 60-character prefix) on their own lines. chrome.mjs linkRefs cuts link
// text to 60 characters, so a classic card's doubled title arrives cut inside the first copy, the hidden copy or the
// badge; the card's title line names it whole. The first line from the cursor on that equals the cleaned title, that
// the link text starts with at a word boundary, or that starts with the link text is the card. Badge lines are never a
// title. Returns the title, the company line after it (or '') and where the next card's search starts; with no match,
// the cleaned title, no company and the same cursor.
function cardFromText(pageLines, text, from) {
  const cleaned = cleanTitle(text);
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  const fits = (l) => l === cleaned || (l.length >= 3 && !VERIFIED.test(l) && ((t.startsWith(l) && (t.length === l.length || t[l.length] === ' ')) || l.startsWith(t)));
  let at = from;
  while (at < pageLines.length && !fits(pageLines[at])) at++;
  if (at >= pageLines.length) return { title: cleaned, company: '', next: from };
  const title = pageLines[at];
  const repeats = new Set([title.toLowerCase(), `${title} with verification`.toLowerCase()]);
  let i = at + 1;
  while (i < pageLines.length && (!pageLines[i] || repeats.has(pageLines[i].toLowerCase()))) i++;
  return sane(pageLines[i]) ? { title, company: pageLines[i], next: i + 1 } : { title, company: '', next: i };
}

// Job cards from chrome.mjs read --links output: a jobs/view link opens a card and the next company link names its
// employer, else the page text before the refs does. Only url, company and title are kept; a posting's own text is read
// later, for new rows only.
export function linkedinJobs(readOutput) {
  const jobs = [];
  const ids = new Set();
  const pageLines = [];
  for (const line of String(readOutput ?? '').split('\n')) {
    const m = LINK_REF.exec(line.trim());
    if (!m) {
      pageLines.push(line.trim());
      continue;
    }
    if (!m[1]) continue;
    const id = JOB_VIEW.exec(m[2])?.[1];
    if (id) {
      if (!ids.has(id)) jobs.push({ url: `https://www.linkedin.com/jobs/view/${id}/`, title: m[1], company: '', src: 'fresh-linkedin' });
      ids.add(id);
      continue;
    }
    const last = jobs[jobs.length - 1];
    if (last && !last.company && /linkedin\.com\/company\//.test(m[2])) last.company = m[1];
  }
  let cursor = 0;
  return jobs.map((j) => {
    const card = cardFromText(pageLines, j.title, cursor);
    cursor = card.next;
    return { ...j, title: card.title, company: j.company || card.company || 'unknown' };
  });
}

// Adds the new rows to Pending and, for each title repeated in this scan, refreshes the reposts= and title_since= notes of
// that title's Pending row, the one that still reaches triage. Rows already triaged keep their verdict and notes.
async function mergeRows(dataDir, rows, today, { repeatTitles = new Set(), allSeen = [] } = {}) {
  const file = join(dataDir, 'pipeline.md');
  return withLock(file, () => {
    const doc = ensureSections(parsePipeline(existsSync(file) ? readFileSync(file, 'utf8') : SKELETON));
    const present = new Set(SECTIONS.flatMap((s) => sectionRows(doc, s).map(({ row }) => urlKey(row.url))));
    const fresh = rows.filter((r) => !present.has(urlKey(r.url)));
    const pending = getSection(doc, 'Pending');
    for (const { index, row } of sectionRows(doc, 'Pending')) {
      const hist = repeatTitles.has(titleKey(row)) && queuedHistory(row, allSeen);
      if (!hist) continue;
      row.notes.set('reposts', String(hist.reposts));
      row.notes.set('title_since', hist.titleSince);
      pending.lines[index] = formatRow(row);
    }
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

// Up to JITTER_MS of random wait, cut so the read stays inside the run's local clock hour with a minute to spare.
// budget.mjs allows one fresh read per clock hour and at least 50 minutes between reads, so hourly runs whose reads each
// stay in their own clock hour, at most 10 minutes late, are never refused for the jitter.
export function jitterRoom(config, now) {
  const t = createClock({ timezone: config.timezone }).localTime(now);
  const leftMs = (60 - t.minute) * 60000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds() - 60000;
  return Math.max(0, Math.min(JITTER_MS, leftMs));
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

const firstLine = (res) => res.out.trim().split('\n')[0] || `exit ${res.code}`;

// One LinkedIn past-hour page, only when the schedule reaches Chrome and the budget allows the hourly read. The read is
// logged before it starts (budget.mjs log is a compare-and-set under the action-log lock), so a read that fails or
// times out still uses the hour. Returns the job cards read (empty when nothing was read) and whether a page was read.
async function linkedinFresh({ paths, config, runner, notes, nowFn, sleep, force = false, rng = Math.random }) {
  if (!force && (config.chrome_in_schedule !== 'yes' || !inLinkedinWindow(config, nowFn()))) return { pages: 0, jobs: [] };
  if (!force) {
    await sleep(Math.floor(rng() * jitterRoom(config, nowFn())));
    // The window is asked again after the wait: a check that lands at 22:00 would log a refusal for the whole day.
    if (!inLinkedinWindow(config, nowFn())) return { pages: 0, jobs: [] };
  }
  const url = freshSearchUrl({ config, archetypes: readArchetypes(paths.dataDir) });
  for (const command of ['check', 'log']) {
    const res = packScript(paths, runner, 'budget.mjs', [command, 'linkedin.fresh_search', '--target', 'fresh-search']);
    if (!res.ok) {
      notes.push(`fresh scan: LinkedIn read not allowed (${firstLine(res)})`);
      return { pages: 0, jobs: [] };
    }
  }
  const read = packScript(paths, runner, 'chrome.mjs', ['read', url, '--links'], 120 * 1000);
  if (!read.ok) {
    notes.push(`fresh scan: LinkedIn page not read (${firstLine(read)})`);
    return { pages: 0, jobs: [] };
  }
  return { pages: 1, jobs: linkedinJobs(read.out) };
}

// Postings neither seen by an earlier scan nor in the pipeline; T13 off keeps the seen-file check only.
function freshOf(jobs, { seen, pipelineRows }) {
  return isOn('T13') ? splitNew(jobs, { seen, pipelineRows }) : { fresh: jobs.filter((j) => !seen.has(urlKey(j.url))), repeats: [] };
}

function readPipelineRows(dataDir) {
  const file = join(dataDir, 'pipeline.md');
  if (!existsSync(file)) return [];
  const doc = parsePipeline(readFileSync(file, 'utf8'));
  return SECTIONS.flatMap((s) => sectionRows(doc, s).map(({ row }) => row));
}

const boardKey = (b) => `${b.kind}:${b.slug}`;

// Board rows tagged with their board key. On the first scan of a board (no seen row names it) only the newest
// `firstMax` postings go on; the rest come back in `seedOnly`, to be marked seen without entering the queue.
async function readBoards(boards, fetchFn, notes, { seenBoards, firstMax }) {
  const jobs = [];
  const seedOnly = [];
  let boardFailures = 0;
  for (const b of boards) {
    try {
      const rows = (await readBoard(b, fetchFn)).map((j) => ({ ...j, board: boardKey(b) }));
      if (seenBoards.has(boardKey(b)) || rows.length <= firstMax) jobs.push(...rows);
      else {
        const newest = [...rows].sort((x, y) => String(y.posted ?? '').localeCompare(String(x.posted ?? '')));
        jobs.push(...newest.slice(0, firstMax));
        seedOnly.push(...newest.slice(firstMax));
      }
    } catch (err) {
      boardFailures += 1;
      notes.push(`fresh scan: ${b.company} board failed (${String(err.message).split('\n')[0]}); the other boards still scanned`);
    }
  }
  return { jobs, seedOnly, boardFailures };
}

// Appends the scan's lines to data/digest/fresh-<today>.md, a file of its own so the daily digest never erases them.
export function appendFreshDigest({ dataDir, today, lines }) {
  const file = join(dataDir, 'digest', `fresh-${today}.md`);
  mkdirSync(join(dataDir, 'digest'), { recursive: true });
  const top = existsSync(file) ? '' : `# Fresh scan ${today}\n\n`;
  appendFileSync(file, `${top}${lines.map((l) => `- ${l}`).join('\n')}\n`);
}

const seenRow = (j, today) => ({ url_key: urlKey(j.url), first_seen: today, title_key: titleKey(j) ?? '', board: j.board ?? LINKEDIN_BOARD });

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

/** deps: fetchFn (fetch-shaped), robots ({ check }), sleep, runner (child processes), now, rng. Returns { added, failed (rows that failed the free rules), boardFailures, linkedinPages, linkedinNew, notes }. */
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
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const seenFile = join(paths.dataDir, SEEN_FILE);
  const seenRows = (await readTsv(seenFile)).rows;
  const seen = new Set(seenRows.map((r) => r.url_key));
  const seenBoards = new Set(seenRows.map((r) => r.board).filter(Boolean));
  const { jobs, seedOnly, boardFailures } = await readBoards(boards, fetchFn, notes, { seenBoards, firstMax: config.fresh_first_scan ?? 25 });
  const linkedin = await linkedinFresh({ paths, config, runner, notes, sleep, rng: deps.rng, nowFn: deps.now ?? (() => new Date()), force: linkedinOnly });
  const split = freshOf([...jobs, ...linkedin.jobs], { seen, pipelineRows: readPipelineRows(paths.dataDir) });
  const fresh = withHistory(split.fresh, seenRows, today);
  const seed = seedOnly.filter((j) => !seen.has(urlKey(j.url)));
  const newSeen = [...fresh, ...split.repeats, ...seed].map((j) => seenRow(j, today));
  const repeatTitles = new Set(split.repeats.map(titleKey).filter(Boolean));
  const added = fresh.length || repeatTitles.size ? await mergeRows(paths.dataDir, fresh, today, { repeatTitles, allSeen: [...seenRows, ...newSeen] }) : 0;
  await appendTsv(seenFile, SEEN_HEADER, newSeen);
  const failed = added ? await runPrefilter(paths, config) : 0;
  const newLinkedin = fresh.filter((j) => j.src === 'fresh-linkedin').length;
  const linkedinLine = linkedin.pages ? [`fresh LinkedIn page: ${linkedin.jobs.length} job card(s) read, ${newLinkedin} new row(s) in Pending noted src=fresh-linkedin`] : [];
  const summary = `fresh scan: ${boards.length} board(s), ${added} new row(s), ${failed} failed the free rules${seed.length ? `, ${seed.length} older posting(s) marked seen on a first scan` : ''}`;
  appendFreshDigest({ dataDir: paths.dataDir, today, lines: [summary, ...linkedinLine, ...notes] });
  await appendLedger(paths.dataDir, [zeroRow({ date: today, step: 'fresh-scan', feature: 'U1', rows: boards.length }), zeroRow({ date: today, step: 'fresh-linkedin', feature: 'M12', rows: linkedin.pages })]);
  return { added, failed, boardFailures, linkedinPages: linkedin.pages, linkedinNew: newLinkedin, notes };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { 'log-file': 'string', linkedin: 'boolean' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const config = await loadStudentConfig({ root: paths.root }).catch(() => null);
  const today = createClock({ today: flags.today, timezone: config?.timezone }).today();
  try {
    const res = await freshScan({ paths, today, linkedinOnly: Boolean(flags.linkedin) });
    console.log(`fresh-scan: ${res.added} new row(s)`);
    for (const note of res.notes) console.log(note);
  } catch (err) {
    console.log(`fresh-scan: stopped (${String(err.message).split('\n')[0]})`);
  }
  return 0;
}

if (isMain(import.meta.url)) await runCli(main);
