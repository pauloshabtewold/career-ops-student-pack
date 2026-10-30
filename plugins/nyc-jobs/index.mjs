// Ingest hook: NYC Open Data "Jobs NYC Postings" (Socrata dataset kpav-sd4t) -> recent student and entry-level
// City of New York postings. One keyless request per run, no app token, nothing written to ctx.dataRoot. The plugin runs
// as a hashed copy in plugins.local/, so everything it needs lives in this file.
const ENDPOINT = 'https://data.cityofnewyork.us/resource/kpav-sd4t.json';
const USER_AGENT = 'career-ops-student-pack';
const LEVELS = ['Student', 'Entry-Level'];
const WINDOW_DAYS = 14;
const ROW_LIMIT = 500;
// The upstream host abandons an ingest hook after 15 s, so the request is cut off at 11 s.
const HOST_BUDGET_MS = 11000;
const FIELDS = ['job_id', 'agency', 'business_title', 'work_location', 'posting_date'];

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

export function mapRows(rows) {
  const seen = new Set();
  const jobs = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = clean(row?.job_id);
    const title = clean(row?.business_title);
    if (!/^\d+$/.test(id) || !title || seen.has(id)) continue;
    seen.add(id);
    const where = clean(row.work_location);
    jobs.push({
      title,
      url: `https://cityjobs.nyc.gov/job/${id}`,
      company: clean(row.agency) || 'City of New York',
      location: where ? `${where}, New York, NY` : 'New York, NY',
    });
  }
  return jobs;
}

export default {
  async ingest(ctx) {
    const today = ctx.today ?? new Date().toISOString().slice(0, 10);
    const budget = ctx.budgetMs ?? HOST_BUDGET_MS;
    try {
      const res = await ctx.fetch(queryUrl(today), {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(budget),
      });
      if (!res.ok) {
        ctx.log?.(`nyc-jobs: HTTP ${res.status}; no rows this run`);
        return [];
      }
      const rows = JSON.parse(await res.text());
      if (!Array.isArray(rows)) {
        ctx.log?.('nyc-jobs: unexpected response shape; no rows this run');
        return [];
      }
      return mapRows(rows);
    } catch (err) {
      ctx.log?.(`nyc-jobs: ${err.message}; no rows this run`);
      return [];
    }
  },
};
