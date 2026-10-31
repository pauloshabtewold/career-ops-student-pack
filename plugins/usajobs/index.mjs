// Ingest hook: USAJOBS search API -> recent federal postings open to students and recent graduates. One request per
// run, authenticated with the student's own API key and email from ctx.env. Nothing is written to ctx.dataRoot and the
// key and email are never logged. The plugin runs as a hashed copy in plugins.local/, so everything it needs lives in
// this file.
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

function postingUrl(raw) {
  try {
    const u = new URL(clean(raw));
    return u.protocol === 'https:' && (u.hostname === 'usajobs.gov' || u.hostname.endsWith('.usajobs.gov')) ? u.href : '';
  } catch {
    return '';
  }
}

export function mapItems(body) {
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
      return mapItems(body);
    } catch (err) {
      // The error text is not logged: a failed request can echo headers or a response body.
      const what = err?.status ? `HTTP ${err.status}` : err?.name === 'SyntaxError' ? 'bad JSON' : 'request failed';
      ctx.log?.(`usajobs: ${what}; no rows this run`);
      return [];
    }
  },
};
