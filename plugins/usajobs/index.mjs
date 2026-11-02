// Ingest hook: USAJOBS search API -> recent federal postings open to students and recent graduates. One request per
// run, authenticated with the student's own API key and email from ctx.env. The only file written under ctx.dataRoot is the close-date sidecar below, and the
// key and email are never logged. The plugin runs as a hashed copy in plugins.local/, so everything it needs lives in
// this file.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const ENDPOINT = 'https://data.usajobs.gov/api/search';
const HIRING_PATHS = ['student', 'graduates'];
const WINDOW_DAYS = 14;
const RESULTS_PER_PAGE = 500;
// The upstream host abandons an ingest hook after 15 s, so the request is cut off at 11 s.
const HOST_BUDGET_MS = 11000;

export function queryUrl(days = WINDOW_DAYS) {
  const params = new URLSearchParams({
    HiringPath: HIRING_PATHS.join(';'),
    DatePosted: String(days),
    SortField: 'opendate',
    SortDirection: 'desc',
    ResultsPerPage: String(RESULTS_PER_PAGE),
  });
  return `${ENDPOINT}?${params}`;
}

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// ApplicationCloseDate looks like 2026-11-20T23:59:59.9300; only a real calendar date is kept.
function closeDate(raw) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(clean(raw));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? m[0] : '';
}

// Close dates go to the pack's URL-keyed sidecar (data/student-rows.tsv, notes column) as a closes=YYYY-MM-DD token,
// because upstream's ingest keeps only title, url, company and location. rank-queue reads the token. The file is shared
// with the github-lists plugin: its columns are kept and only the closes token of a posting's notes is replaced.
const SIDECAR_FILE = 'student-rows.tsv';
const SIDECAR_HEADER = ['url_key', 'url', 'src', 'imported', 'extid', 'notes'];

function sidecarDir(dataRoot) {
  const nested = join(dataRoot, 'data');
  return existsSync(join(nested, SIDECAR_FILE)) || existsSync(join(nested, 'student-github-sources.json')) ? nested : dataRoot;
}

function writeCloses(dataRoot, closes) {
  if (!dataRoot || !closes.size) return;
  const file = join(sidecarDir(dataRoot), SIDECAR_FILE);
  const byKey = new Map();
  if (existsSync(file)) {
    const [head, ...lines] = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l !== '');
    const cols = (head ?? '').split('\t');
    for (const l of lines) {
      const cells = l.split('\t');
      const r = Object.fromEntries(SIDECAR_HEADER.map((h) => [h, cells[cols.indexOf(h)] ?? '']));
      byKey.set(r.url_key, r);
    }
  }
  for (const [url, date] of closes) {
    const prev = byKey.get(url) ?? { url_key: url, url, src: '', imported: '', extid: '', notes: '' };
    const others = prev.notes.split(';').map((t) => t.trim()).filter((t) => t && !t.startsWith('closes='));
    byKey.set(url, { ...prev, notes: [...others, `closes=${date}`].join('; ') });
  }
  mkdirSync(dirname(file), { recursive: true });
  const body = [...byKey.values()].map((r) => SIDECAR_HEADER.map((h) => String(r[h] ?? '').replace(/[\t\r\n]/g, ' ')).join('\t'));
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${[SIDECAR_HEADER.join('\t'), ...body].join('\n')}\n`);
  renameSync(tmp, file);
}

function postingUrl(raw) {
  try {
    const u = new URL(clean(raw));
    return u.protocol === 'https:' && (u.hostname === 'usajobs.gov' || u.hostname.endsWith('.usajobs.gov')) ? u.href : '';
  } catch {
    return '';
  }
}

export function mapItems(body, closes = new Map()) {
  const items = body?.SearchResult?.SearchResultItems;
  const seen = new Set();
  const jobs = [];
  for (const item of Array.isArray(items) ? items : []) {
    const d = item?.MatchedObjectDescriptor;
    const id = clean(item?.MatchedObjectId || d?.PositionID);
    const title = clean(d?.PositionTitle);
    const url = postingUrl(d?.PositionURI);
    if (!id || !title || !url || seen.has(id)) continue;
    seen.add(id);
    const closeOn = closeDate(d.ApplicationCloseDate);
    if (closeOn) closes.set(url, closeOn);
    jobs.push({
      title,
      url,
      company: clean(d.OrganizationName) || clean(d.DepartmentName) || 'US Federal Government',
      location: clean(d.PositionLocationDisplay),
    });
  }
  return jobs;
}

export default {
  async ingest(ctx) {
    const key = clean(ctx.env?.USAJOBS_API_KEY);
    const email = clean(ctx.env?.USAJOBS_EMAIL);
    if (!key || !email) {
      ctx.log?.('usajobs: key or email missing; no rows this run');
      return [];
    }
    const budget = ctx.budgetMs ?? HOST_BUDGET_MS;
    try {
      const res = await ctx.fetch(queryUrl(), {
        // fetch sets Host from the URL itself and ignores a Host header, so none is sent.
        headers: { 'User-Agent': email, 'Authorization-Key': key, Accept: 'application/json' },
        timeoutMs: budget,
        signal: AbortSignal.timeout(budget),
      });
      if (!res.ok) {
        ctx.log?.(`usajobs: HTTP ${res.status}; no rows this run`);
        return [];
      }
      const body = JSON.parse(await res.text());
      if (!Array.isArray(body?.SearchResult?.SearchResultItems)) {
        ctx.log?.('usajobs: unexpected response shape; no rows this run');
        return [];
      }
      const closes = new Map();
      const jobs = mapItems(body, closes);
      if (!ctx.dryRun) {
        try {
          writeCloses(ctx.dataRoot, closes);
        } catch {
          ctx.log?.('usajobs: close dates not saved');
        }
      }
      return jobs;
    } catch (err) {
      // The error text is not logged: a failed request can echo headers or a response body.
      const what = err?.status ? `HTTP ${err.status}` : err?.name === 'SyntaxError' ? 'bad JSON' : 'request failed';
      ctx.log?.(`usajobs: ${what}; no rows this run`);
      return [];
    }
  },
};
