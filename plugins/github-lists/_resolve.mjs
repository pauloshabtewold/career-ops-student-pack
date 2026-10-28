// Confirms an aggregator-only posting at the employer, or rejects it. An aggregator link is only a pointer:
// it is usable when the same role is found on the employer's public Greenhouse, Lever or Ashby board, and the
// employer URL then replaces it. Only public GETs go out, at most four in flight, and never to a forbidden host.
import { join } from 'node:path';
import { LIMITS, hostOf, isForbiddenHost } from './_limits.mjs';
import { appendStats } from './_io.mjs';

const AGGREGATORS = ['zapply.jobs', 'simplify.jobs', 'jobright.ai'];
const UNRESOLVED_HEADER = ['date', 'company', 'title', 'source'];
const BOARD_URL = {
  greenhouse: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
  lever: (slug) => `https://api.lever.co/v0/postings/${slug}?mode=json`,
  ashby: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
};
const NOISE = /\b(20\d\d|summer|fall|winter|spring|autumn|usa|us|u s|remote|hybrid|onsite|full time|fulltime|part time|new grad|new graduate|graduate)\b/g;
const LEVEL = new Set(['intern', 'internship', 'coop', 'senior', 'sr', 'staff', 'lead', 'principal', 'manager', 'director', 'i', 'ii', 'iii', 'iv', 'v', '1', '2', '3', '4', '5', 'junior', 'jr', 'associate']);
const CORP = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|lp|group|holdings|technologies|technology|labs)\b/g;
// Five hops covers aggregator -> tracker -> employer chains; longer chains are treated as no answer.
const MAX_REDIRECT_HOPS = 5;
const NO_DATA = Object.freeze({ finalUrl: null, body: null });
const ZAPPLY_PATH = /^\/l\/d\/(greenhouse|ashby|lever)-(.+)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)\/?$/i;

function nextHop(res, current) {
  const location = res.headers?.get?.('location');
  if (!location) return null;
  try {
    return new URL(location, current).href;
  } catch {
    return null;
  }
}

export function classifyUrl(url) {
  const host = hostOf(url);
  if (isForbiddenHost(host)) return 'forbidden';
  return AGGREGATORS.some((a) => host === a || host.endsWith(`.${a}`)) ? 'aggregator' : 'employer';
}

export function normTitle(t) {
  return t
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Longest common block of x and y as { best, bi, bj }, where bi and bj are the end offsets of the block.
function longestBlock(x, y) {
  let best = 0;
  let bi = 0;
  let bj = 0;
  const prev = new Array(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    for (let j = y.length; j >= 1; j--) {
      prev[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : 0;
      if (prev[j] <= best) continue;
      best = prev[j];
      bi = i;
      bj = j;
    }
  }
  return { best, bi, bj };
}

function matchedChars(x, y) {
  if (!x.length || !y.length) return 0;
  const { best, bi, bj } = longestBlock(x, y);
  if (!best) return 0;
  return best + matchedChars(x.slice(0, bi - best), y.slice(0, bj - best)) + matchedChars(x.slice(bi), y.slice(bj));
}

// Ratio of matched characters from recursive longest-common-block matching, the measure the Python original used.
export function seqRatio(a, b) {
  return a.length + b.length ? (2 * matchedChars(a, b)) / (a.length + b.length) : 1;
}

// Strict: equal after noise removal, or near-equal with identical level tokens ("Engineer II" never matches "Engineer").
export function titlesMatch(a, b) {
  const na = normTitle(a);
  const nb = normTitle(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const lv = (s) => [...new Set(s.split(' ').filter((w) => LEVEL.has(w)))].sort().join(',');
  return lv(na) === lv(nb) && seqRatio(na, nb) >= 0.93;
}

export function slugGuesses(company) {
  const base = company.toLowerCase().replace(/&/g, ' and ').replace(/\([^)]*\)/g, ' ').replace(/[.'\u2019]/g, '');
  const words = base.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
  const stripped = base.replace(CORP, ' ').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean);
  const out = [];
  for (const ws of [stripped, words]) {
    if (!ws.length) continue;
    for (const s of [ws.join(''), ws.join('-')]) if (!out.includes(s)) out.push(s);
  }
  return out.slice(0, 4);
}

const LOC_STOP = new Set(['us', 'usa', 'united', 'states', 'remote', 'and', 'or']);
const locTokens = (s) => new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !LOC_STOP.has(w)));
export function locOverlap(a, b) {
  const tb = locTokens(b);
  return [...locTokens(a)].some((t) => tb.has(t));
}

export function pickPosting(candidates, title, location) {
  let hits = candidates.filter((j) => j.url && titlesMatch(j.title, title));
  if (hits.length > 1 && location) {
    const near = hits.filter((j) => locOverlap(j.loc, location));
    hits = near.length ? near : hits;
  }
  return hits.length === 1 ? hits[0] : null;
}

// Counting gate: at most `limit` tasks run at once; waiting tasks start in arrival order.
export function createGate(limit) {
  let active = 0;
  const waiting = [];
  const state = { maxActive: 0 };
  const release = () => {
    active--;
    const next = waiting.shift();
    if (next) next();
  };
  const run = async (fn) => {
    if (active >= limit) await new Promise((resolve) => waiting.push(resolve));
    active++;
    state.maxActive = Math.max(state.maxActive, active);
    try {
      return await fn();
    } finally {
      release();
    }
  };
  return { run, state };
}

/**
 * fetch(url) must return a Response-like object (ctx.fetch). sleep(ms) is injectable for tests.
 * Returns resolve(row) -> { url, how }, with url null when the posting was not confirmed.
 */
export function createResolver({ fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), limits = LIMITS }) {
  const gate = createGate(limits.aggregator_in_flight);

  // 404 is the normal answer to a wrong slug guess, so every failure is "no data", not an error.
  // Redirects are followed by hand so each Location hop is checked against the forbidden hosts before it is requested.
  async function get(url, asJson) {
    return gate.run(async () => {
      let current = url;
      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        if (isForbiddenHost(hostOf(current))) return NO_DATA;
        await sleep(limits.resolver_pause_ms);
        let res;
        try {
          res = await fetch(current, { headers: { 'User-Agent': 'career-ops-student-pack' }, redirect: 'manual' });
        } catch {
          return NO_DATA;
        }
        if (res.status >= 300 && res.status < 400) {
          current = nextHop(res, current);
          if (!current) return NO_DATA;
          continue;
        }
        if (!res.ok) return NO_DATA;
        try {
          return { finalUrl: current, body: asJson ? await res.json() : null };
        } catch {
          return NO_DATA;
        }
      }
      return NO_DATA;
    });
  }

  async function board(kind, slug) {
    const { body: d } = await get(BOARD_URL[kind](slug), true);
    let jobs = null;
    if (kind === 'greenhouse' && d?.jobs) jobs = d.jobs.map((j) => ({ title: j.title ?? '', url: j.absolute_url ?? '', loc: j.location?.name ?? '', id: String(j.id ?? '') }));
    else if (kind === 'lever' && Array.isArray(d)) jobs = d.map((j) => ({ title: j.text ?? '', url: j.hostedUrl ?? '', loc: j.categories?.location ?? '', id: String(j.id ?? '') }));
    else if (kind === 'ashby' && d?.jobs) jobs = d.jobs.filter((j) => j.isListed !== false).map((j) => ({ title: j.title ?? '', url: j.jobUrl ?? '', loc: j.location ?? '', id: String(j.id ?? '') }));
    return jobs;
  }

  async function resolve({ company, title, location = '', url }) {
    const kind = classifyUrl(url);
    if (kind === 'forbidden') return { url: null, how: 'forbidden host: never fetched' };
    if (kind === 'employer') return { url, how: 'employer link' };

    // a. zapply redirects to the employer apply page; the other aggregators render client-side and are never requested
    if (hostOf(url).endsWith('zapply.jobs')) {
      const { finalUrl } = await get(url, false);
      if (finalUrl && classifyUrl(finalUrl) === 'employer' && new URL(finalUrl).pathname.replace(/\//g, '').length > 3) {
        return { url: finalUrl, how: 'redirect' };
      }
    }
    // b. a zapply path names the ATS and job id; the id must exist on that board with the same title
    const m = hostOf(url).endsWith('zapply.jobs') ? ZAPPLY_PATH.exec(new URL(url).pathname) : null;
    if (m) {
      const jobs = (await board(m[1].toLowerCase(), m[2].toLowerCase())) ?? [];
      const hit = jobs.find((j) => j.id === m[3] && j.url);
      if (hit && titlesMatch(hit.title, title)) return { url: hit.url, how: `zapply-id+${m[1].toLowerCase()}` };
    }
    // c. public board APIs by company-name slug, matched on a strict title
    for (const slug of slugGuesses(company)) {
      for (const k of ['greenhouse', 'lever', 'ashby']) {
        const jobs = await board(k, slug);
        if (!jobs) continue;
        const hit = pickPosting(jobs, title, location);
        if (hit) return { url: hit.url, how: `board-${k}` };
      }
    }
    return { url: null, how: 'not found at employer' };
  }

  return { resolve, gate };
}

/**
 * Employer-ATS rows pass through, aggregator rows come back with the employer posting url, and forbidden or
 * unresolved rows are dropped and appended to <dataRoot>/student-agg-unresolved.tsv unless dryRun is set.
 */
export async function resolveAggregator(rows, { fetch, sleep, dataRoot, today, dryRun = false }) {
  const resolver = createResolver({ fetch, sleep });
  const verdicts = await Promise.all(rows.map((row) => resolver.resolve(row)));
  const out = [];
  const unresolved = [];
  rows.forEach((row, i) => {
    const { url, how } = verdicts[i];
    if (url) out.push({ ...row, url });
    else unresolved.push({ date: today, company: row.company, title: row.title, source: row.source || how });
  });
  if (!dryRun && dataRoot) await appendStats(join(dataRoot, 'student-agg-unresolved.tsv'), UNRESOLVED_HEADER, unresolved);
  return out;
}
