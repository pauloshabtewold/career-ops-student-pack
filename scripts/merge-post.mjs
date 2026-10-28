#!/usr/bin/env node
// Post-ingest step, run after `node plugins.mjs run github-lists` and the inbox and Handshake steps.
// 1. moves data/pipeline.staging.md rows into Pending after dedup against pipeline.md, applications.md and
//    data/blacklist.md, recording them in data/scan-history.tsv with that file's own column order
// 2. joins sidecar tokens (src, imported, extid) into Pending notes where missing, because upstream's ingest
//    keeps only title, url, company, location and salary
// 3. drops company+title duplicates already in applications.md or earlier in Pending
// 4. skips Workday reposts of a requisition already known
// 5. moves needs-url and aggregator-host rows to Flagged
// Everything runs under the pipeline lock. Usage: merge-post.mjs [--data-dir D] [--today D] [--dry-run]
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runCli } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { LockTimeoutError, withLock } from '../lib/dir-lock.mjs';
import { appendLines, ensureSections, formatRow, getSection, parsePipeline, parseRow, serializePipeline } from '../lib/pipeline-md.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { loadSidecar, lookup } from '../lib/sidecar.mjs';
import { escapeCell } from '../lib/tsv.mjs';
import { urlKey } from '../lib/url-key.mjs';
import { writeAtomic } from './apply-triage.mjs';

const AGGREGATORS = ['zapply.jobs', 'simplify.jobs', 'jobright.ai', 'linkedin.com', 'indeed.com', 'ziprecruiter.com', 'glassdoor.com', 'monster.com'];
const DEFAULT_HISTORY_COLUMNS = ['url', 'first_seen', 'portal', 'title', 'company', 'status', 'location'];
const SKELETON = '# Pipeline\n\n## Pending\n\n## Flagged\n\n## Skipped\n\n## Processed\n';

const compact = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const hostOf = (u) => {
  try {
    return new URL(u).hostname.toLowerCase();
  } catch {
    return '';
  }
};
const isAggregator = (host) => AGGREGATORS.some((a) => host === a || host.endsWith(`.${a}`));
const ctKey = (company, title) => `${compact(company)}|${compact(title)}`;
const readIf = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

// Workday appends -1 or -2 when one requisition is posted to several career sites of the same tenant.
export function workdayReq(url) {
  const host = hostOf(url);
  if (!host.endsWith('myworkdayjobs.com')) return '';
  const m = /_([A-Za-z]*-?\d[\w]*?)(?:-\d{1,2})?\/?$/.exec(new URL(url).pathname);
  return m ? `${host}#${m[1].toLowerCase()}` : '';
}

function tableFirstCells(text) {
  return text
    .split('\n')
    .filter((l) => l.trim().startsWith('|'))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()))
    .filter((c) => !c.every((x) => /^:?-+:?$/.test(x)));
}

function applicationsKeys(text) {
  const urls = new Set([...text.matchAll(/https?:\/\/[^\s|)\]>]+/g)].map((m) => urlKey(m[0])).filter(Boolean));
  const cts = new Set();
  for (const c of tableFirstCells(text).slice(1)) if (/^\d+$/.test(c[0]) && c.length >= 4) cts.add(ctKey(c[2], c[3]));
  return { urls, cts };
}

function blacklistMatcher(text) {
  const names = tableFirstCells(text).slice(1).map((c) => c[0]).filter(Boolean);
  const tokens = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const entries = names.map((n) => ({ tok: tokens(n), cmp: compact(n) }));
  // Exact name or whole-word prefix ("Big Co Securities" hits "Big Co"); never a bare substring.
  return (company) => entries.some((b) => b.cmp === compact(company) || tokens(company).startsWith(`${b.tok} `));
}

// parseRow only accepts http(s) first fields; a needs-url placeholder row is read by swapping in a stand-in url.
function parseLoose(line) {
  const m = /^((?:- )?(?:\[[ xX]\] )?)(needs-url[^|]*?)( \| .*)$/.exec(line);
  if (!m) return parseRow(line);
  const row = parseRow(`${m[1]}https://placeholder.invalid${m[3]}`);
  if (row) row.url = m[2].trim();
  return row;
}

const isPlaceholder = (url) => url.startsWith('needs-url');

function parseStaging(text) {
  const rows = [];
  for (const raw of text.split('\n')) {
    if (!raw.startsWith('- [ ] ')) continue;
    const row = parseLoose(raw);
    if (row) rows.push(row);
  }
  return rows;
}

// Existing Pending rows: join sidecar tokens, drop company+title duplicates, flag rows that cannot be applied to.
function reviewPending(doc, sidecar, known, stats, changes) {
  const pending = getSection(doc, 'Pending');
  const flagged = [];
  pending.lines = pending.lines.flatMap((line) => {
    const row = parseLoose(line);
    if (!row || row.checkbox === null) return [line];
    const changed = joinSidecar(row, sidecar, stats);
    const placeholder = isPlaceholder(row.url) || isAggregator(hostOf(row.url));
    if (!placeholder && known.ct.has(ctKey(row.company, row.title))) {
      stats.dropped++;
      changes.push(`drop duplicate ${row.company} | ${row.title}`);
      return [];
    }
    if (placeholder) {
      row.checkbox = null;
      row.notes.set('flag', 'needs-url');
      flagged.push(formatRow(row));
      stats.flagged++;
      changes.push(`flag ${row.url}`);
      return [];
    }
    known.remember(row);
    return [changed ? formatRow(row) : line];
  });
  for (const line of doc.blocks.flatMap((b) => (b.name === 'Pending' ? [] : b.lines))) {
    const row = parseLoose(line);
    const key = row && row.url && !isPlaceholder(row.url) ? urlKey(row.url) : null;
    if (key) known.urls.add(key);
  }
  return flagged;
}

function joinSidecar(row, sidecar, stats) {
  const hit = sidecar.lookup(row.url);
  let changed = false;
  if (!hit) return changed;
  for (const col of ['src', 'imported', 'extid']) {
    if (hit[col] && !row.notes.has(col)) {
      row.notes.set(col, hit[col]);
      changed = true;
      stats.joined++;
    }
  }
  return changed;
}

// Why a staged row is skipped, as the stats counter to bump; null when the row is new.
function skipReason(row, known, blacklisted) {
  if (!/^https?:\/\//i.test(row.url) && !isPlaceholder(row.url)) return 'malformed';
  const key = isPlaceholder(row.url) ? null : urlKey(row.url);
  if (key && known.urls.has(key)) return 'dupUrl';
  if (key && known.blacklistedUrls.has(key)) return 'blacklisted';
  if (known.ct.has(ctKey(row.company, row.title))) return workdayReq(row.url) ? 'workdayRepost' : 'dupCT';
  if (blacklisted(row.company)) return 'blacklisted';
  const req = workdayReq(row.url);
  if (req && known.req.has(req)) return 'workdayRepost';
  return null;
}

export function plan({ doc, stagingText, applicationsText, blacklistText, sidecar }) {
  const stats = { staged: 0, dupUrl: 0, dupCT: 0, workdayRepost: 0, blacklisted: 0, malformed: 0, joined: 0, dropped: 0, flagged: 0, added: 0 };
  const apps = applicationsKeys(applicationsText);
  const blacklisted = blacklistMatcher(blacklistText);
  const blacklistedUrls = new Set([...blacklistText.matchAll(/https?:\/\/[^\s|)\]>]+/g)].map((m) => urlKey(m[0])).filter(Boolean));
  const known = { urls: new Set(apps.urls), ct: new Set(apps.cts), req: new Set(), blacklistedUrls };
  known.remember = (row) => {
    const key = isPlaceholder(row.url) ? null : urlKey(row.url);
    if (key) known.urls.add(key);
    known.ct.add(ctKey(row.company, row.title));
    const req = workdayReq(row.url);
    if (req) known.req.add(req);
  };
  const changes = [];
  const flagged = reviewPending(doc, sidecar, known, stats, changes);

  const added = [];
  const history = [];
  const staged = parseStaging(stagingText);
  stats.staged = staged.length;
  for (const row of staged) {
    const skip = skipReason(row, known, blacklisted);
    if (skip) {
      stats[skip]++;
      continue;
    }
    known.remember(row);
    if (isPlaceholder(row.url) || isAggregator(hostOf(row.url))) {
      const flaggedRow = { ...row, checkbox: null, notes: new Map([['flag', 'needs-url'], ...row.notes]) };
      flagged.push(formatRow(flaggedRow));
      stats.flagged++;
    } else {
      added.push(formatRow(row));
      stats.added++;
    }
    history.push(row);
    changes.push(`add ${row.company} | ${row.title}`);
  }
  appendLines(doc, 'Pending', added);
  appendLines(doc, 'Flagged', flagged);
  return { stats, history, changes };
}

function historyLine(row, columns, today) {
  const cells = Object.fromEntries(columns.map((c) => [c, '']));
  Object.assign(cells, { url: row.url, first_seen: today, portal: row.notes.get('src') ?? 'staging', title: row.title, company: row.company, status: 'added', location: row.location });
  return columns.map((c) => escapeCell(cells[c])).join('\t');
}

export async function mergePost({ dataDir, today, dryRun = false, lockOptions }) {
  const pipelineFile = join(dataDir, 'pipeline.md');
  const stagingFile = join(dataDir, 'pipeline.staging.md');
  const historyFile = join(dataDir, 'scan-history.tsv');
  mkdirSync(dataDir, { recursive: true });
  return withLock(
    pipelineFile,
    async () => {
      const doc = ensureSections(parsePipeline(readIf(pipelineFile) || SKELETON));
      const stagingText = readIf(stagingFile);
      const sidecarData = await loadSidecar(join(dataDir, 'student-rows.tsv'));
      const result = plan({
        doc,
        stagingText,
        applicationsText: readIf(join(dataDir, 'applications.md')),
        blacklistText: readIf(join(dataDir, 'blacklist.md')),
        sidecar: { lookup: (url) => lookup(sidecarData, url) },
      });
      if (dryRun) return { ...result, changes: result.changes.slice(0, 10) };
      writeAtomic(pipelineFile, serializePipeline(doc));
      if (result.history.length) {
        const current = readIf(historyFile);
        const columns = current ? current.split('\n')[0].split('\t') : DEFAULT_HISTORY_COLUMNS;
        const prefix = !current ? `${columns.join('\t')}\n` : current.endsWith('\n') ? '' : '\n';
        appendFileSync(historyFile, `${prefix}${result.history.map((r) => historyLine(r, columns, today)).join('\n')}\n`);
      }
      // Only the part read above is removed; anything a feed appended meanwhile stays for the next run.
      const after = readIf(stagingFile);
      if (stagingText && after.startsWith(stagingText)) writeFileSync(stagingFile, after.slice(stagingText.length));
      return result;
    },
    lockOptions,
  );
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: {} });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const today = createClock({ today: flags.today }).today();
  let res;
  try {
    res = await mergePost({ dataDir: paths.dataDir, today, dryRun: flags.dryRun });
  } catch (err) {
    if (!(err instanceof LockTimeoutError)) throw err;
    console.error(`merge-post: ${err.lockDir} is held by another process; nothing changed`);
    return 1;
  }
  console.log(JSON.stringify(res.stats));
  if (flags.dryRun) for (const c of res.changes) console.log(`  ${c}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(main);
