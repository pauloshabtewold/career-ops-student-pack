// Per-run feed health for the daily digest, computed from files only (no network, no model). Rows added today come from
// data/scan-history.tsv (first_seen = today), which merge-post and scan both write. Each row is credited to a feed by its
// portal or host: github:<list> to github-lists, cityjobs.nyc.gov to nyc-jobs, usajobs.gov to usajobs, anything else to scan.
// A small history of rows per feed per run is kept in data/feed-health.tsv. The caller wraps this in a try/catch: a
// health check must never fail the daily run.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTsv, serializeTsv, writeAtomic } from './tsv.mjs';

export const HISTORY_FILE = 'feed-health.tsv';
export const FEED_STEPS = Object.freeze(['github-lists', 'nyc-jobs', 'usajobs', 'scan']);
// Runs kept per feed, today included. The baseline is the earlier runs among them.
export const HISTORY_RUNS = 7;
const HEADER = ['date', 'feed', 'rows'];

const ENTITY = /&(?:[a-z][a-z0-9]{1,8}|#\d{1,6}|#x[0-9a-f]{1,6});/i;
const TAG = /<\/?[a-z][^>]*>/i;
const EMPTY_COMPANY = new Set(['', 'null', 'undefined', 'nan', 'none']);

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

export function feedOf(row) {
  const host = hostOf(row.url);
  if (String(row.portal ?? '').startsWith('github:')) return 'github-lists';
  if (host === 'cityjobs.nyc.gov' || host.endsWith('.cityjobs.nyc.gov')) return 'nyc-jobs';
  if (host === 'usajobs.gov' || host.endsWith('.usajobs.gov')) return 'usajobs';
  return 'scan';
}

const readIf = (file) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

// Rows first seen today that were added (a status column other than "added" is a skipped duplicate or title reject).
export function rowsAddedToday(dataDir, today) {
  const { rows } = parseTsv(readIf(join(dataDir, 'scan-history.tsv')));
  return rows.filter((r) => r.first_seen === today && (!r.status || r.status === 'added'));
}

// More than half of the earlier runs (at least one) had rows, so a feed that is often quiet is not flagged.
export function zeroYield(prior) {
  return prior.length > 0 && prior.filter((n) => n > 0).length * 2 > prior.length;
}

// Lines for the "## Feed health" section. results are the daily run's step results; a failed step is already in the
// digest's failures, so it is neither judged nor recorded. Updates data/feed-health.tsv.
export function feedHealth({ dataDir, today, results, keep = HISTORY_RUNS }) {
  const steps = results.filter((r) => r.ok && FEED_STEPS.includes(r.name)).map((r) => r.name);
  if (!steps.length) return ['- no feed step ran'];
  const byFeed = new Map(steps.map((s) => [s, []]));
  for (const row of rowsAddedToday(dataDir, today)) byFeed.get(feedOf(row))?.push(row);

  const historyFile = join(dataDir, HISTORY_FILE);
  const history = parseTsv(readIf(historyFile)).rows.filter((r) => r.date && r.feed && /^\d+$/.test(r.rows));
  const lines = [];
  for (const [feed, rows] of byFeed) {
    const prior = history.filter((h) => h.feed === feed && h.date !== today).sort((a, b) => a.date.localeCompare(b.date)).slice(-(keep - 1)).map((h) => Number(h.rows));
    if (rows.length === 0 && zeroYield(prior)) {
      const cmd = feed === 'scan' ? 'node scan.mjs' : `node plugins.mjs run ${feed}`;
      lines.push(`- ${feed}: 0 new rows today, ${prior.filter((n) => n > 0).length} of the last ${prior.length} runs had rows; check by hand in the career-ops folder: ${cmd}`);
    }
    const noCompany = rows.filter((r) => EMPTY_COMPANY.has(String(r.company ?? '').trim().toLowerCase())).length;
    if (noCompany) lines.push(`- ${feed}: ${noCompany} new row(s) with an empty or null company`);
    const dirty = rows.filter((r) => ENTITY.test(r.title ?? '') || TAG.test(r.title ?? '')).length;
    if (dirty) lines.push(`- ${feed}: ${dirty} new row(s) with HTML entities or tags in the title`);
  }

  const all = [...history.filter((h) => !(h.date === today && byFeed.has(h.feed))), ...[...byFeed].map(([feed, rows]) => ({ date: today, feed, rows: String(rows.length) }))];
  const recent = all.filter((h) => [...new Set(all.filter((x) => x.feed === h.feed).map((x) => x.date))].sort().slice(-keep).includes(h.date));
  writeAtomic(historyFile, serializeTsv(HEADER, recent));
  return lines.length ? lines : ['- no feed flagged'];
}
