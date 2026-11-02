// Ingest hook: NYC Open Data "Jobs NYC Postings" (Socrata dataset kpav-sd4t) -> recent student and entry-level
// City of New York postings. One keyless request per run, no app token; the only file written under ctx.dataRoot is the close-date sidecar. The plugin runs
// as a hashed copy in plugins.local/, so everything it needs lives in this file.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const ENDPOINT = 'https://data.cityofnewyork.us/resource/kpav-sd4t.json';
const USER_AGENT = 'career-ops-student-pack';
const LEVELS = ['Student', 'Entry-Level'];
const WINDOW_DAYS = 14;
const ROW_LIMIT = 500;
// The upstream host abandons an ingest hook after 15 s, so the request is cut off at 11 s.
const HOST_BUDGET_MS = 11000;
const FIELDS = ['job_id', 'agency', 'business_title', 'work_location', 'posting_date', 'post_until'];

export function cutoffDate(today, days = WINDOW_DAYS) {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export function queryUrl(today) {
  const levels = LEVELS.map((l) => `'${l}'`).join(',');
  const params = new URLSearchParams({
    $select: FIELDS.join(','),
    $where: `posting_type='External' AND career_level in(${levels}) AND posting_date >= '${cutoffDate(today)}T00:00:00'`,
    $order: 'posting_date DESC',
    $limit: String(ROW_LIMIT),
  });
  return `${ENDPOINT}?${params}`;
}

// The dataset's work_location is a street address with no city, and upstream's location filter reads the text, so the
// city is added. Every posting is a City of New York job.
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

// post_until is the posting's last day. The live dataset returns DD-MON-YYYY (08-DEC-2026, checked 2026-11-02); a
// floating timestamp (2026-11-20T00:00:00.000) is also read in case Socrata retypes the column. Anything else gives no date.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function closeDate(raw) {
  const text = clean(raw);
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  const dmy = /^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{4})$/.exec(text);
  let parts = null;
  if (iso) parts = [+iso[1], +iso[2], +iso[3]];
  else if (dmy) parts = [+dmy[3], MONTHS.indexOf(dmy[2].toLowerCase()) + 1, +dmy[1]];
  if (!parts) return '';
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return m >= 1 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : '';
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

export function mapRows(rows, closes = new Map()) {
  const seen = new Set();
  const jobs = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = clean(row?.job_id);
    const title = clean(row?.business_title);
    if (!/^\d+$/.test(id) || !title || seen.has(id)) continue;
    seen.add(id);
    const where = clean(row.work_location);
    const url = `https://cityjobs.nyc.gov/job/${id}`;
    const closeOn = closeDate(row.post_until);
    if (closeOn) closes.set(url, closeOn);
    jobs.push({
      title,
      url,
      company: clean(row.agency) || 'City of New York',
      location: where ? `${where}, New York, NY` : 'New York, NY',
    });
  }
  return jobs;
}

// Upstream clears its fetch timer once headers arrive, so a body that stalls is bounded here against the same budget.
async function textWithin(res, ms) {
  let timer;
  const cutoff = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`response body not complete within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([res.text(), cutoff]);
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async ingest(ctx) {
    const today = ctx.today ?? new Date().toISOString().slice(0, 10);
    const budget = ctx.budgetMs ?? HOST_BUDGET_MS;
    const deadline = Date.now() + budget;
    try {
      const res = await ctx.fetch(queryUrl(today), {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        timeoutMs: Math.max(500, budget),
      });
      // Upstream ctx.fetch throws on any non-2xx, so a response that reaches this line is a 2xx.
      const rows = JSON.parse(await textWithin(res, Math.max(500, deadline - Date.now())));
      if (!Array.isArray(rows)) {
        ctx.log?.('nyc-jobs: unexpected response shape; no rows this run');
        return [];
      }
      const closes = new Map();
      const jobs = mapRows(rows, closes);
      if (!ctx.dryRun) {
        try {
          writeCloses(ctx.dataRoot, closes);
        } catch {
          ctx.log?.('nyc-jobs: close dates not saved');
        }
      }
      return jobs;
    } catch (err) {
      ctx.log?.(`nyc-jobs: ${err.message}; no rows this run`);
      return [];
    }
  },
};
