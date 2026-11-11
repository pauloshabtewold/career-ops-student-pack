// Ingest hook: GitHub job lists -> postings that fit the student's cycle.
// Reads student-github-sources.json (registry) and student-cycle.json from ctx.dataRoot; ctx.preset, when given,
// carries early_career and title_rules. The plugin runs
// as a hashed copy in plugins.local/, so everything it needs lives in this directory.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LIMITS } from './_limits.mjs';
import { appendStats, loadSidecarKeys, readJson, upsertSidecar, urlKey, writeJsonAtomic } from './_io.mjs';
import { parseSource } from './_parsers.mjs';
import { isEligible } from './_eligibility.mjs';
import { resolveAggregator } from './_resolve.mjs';

const STATS_HEADER = ['date', 'name', 'fetched', 'eligible', 'unique_new', 'parse_errors', 'failed', 'deferred', 'already_queued'];
// The upstream host abandons an ingest hook after 15 s and then keeps nothing, so the plugin stops requesting at 11 s and
// returns what it has. Lists never read go first (research-added ones before the rest), then failed lists, then lists with
// deferred rows, then the least recently read, so every list is read within a few runs.
const HOST_BUDGET_MS = 11000;
// While another list is still unread or failed, one list may spend at most this long resolving aggregator rows, so a list with
// many rows left over cannot take the whole budget and starve the lists behind it.
const RESOLVE_CAP_MS = 3000;
const REAL_SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

export function rawUrl(source) {
  return `https://raw.githubusercontent.com/${source.repo}/${source.branch || 'HEAD'}/${source.path}`;
}

// 429 and 5xx back off 3000 ms times the attempt number; three attempts, then the source counts as failed. Upstream
// ctx.fetch throws on any non-2xx with err.status set, so a 4xx other than 429 is final and ends the loop at once.
// timeoutMs keeps one request from running past the host budget; upstream reads no other abort option.
const isFinalStatus = (status) => status >= 400 && status < 500 && status !== 429;
export async function fetchListText(ctx, url, sleep, deadline = Infinity) {
  let lastError = new Error('no attempt made');
  for (let attempt = 1; attempt <= LIMITS.max_attempts; attempt++) {
    try {
      const res = await ctx.fetch(url, { headers: { 'User-Agent': 'career-ops-student-pack' }, timeoutMs: Math.max(500, deadline - Date.now()), maxBytes: LIMITS.max_list_bytes });
      if (res.ok) return await res.text();
      lastError = new Error(`HTTP ${res.status}`);
      if (isFinalStatus(res.status)) break;
    } catch (err) {
      lastError = err;
      if (isFinalStatus(err?.status)) break;
    }
    if (attempt < LIMITS.max_attempts) {
      const wait = LIMITS.backoff_ms_per_attempt * attempt;
      // A retry that would start after the budget ends is not made: waiting past it costs the whole run its rows.
      if (Date.now() + wait >= deadline) break;
      await sleep(wait);
    }
  }
  throw lastError;
}

async function fetchSource(ctx, source, stat, env) {
  try {
    const text = await fetchListText(ctx, rawUrl(source), env.sleep, env.deadline);
    const hash = createHash('sha256').update(text).digest('hex');
    const parsed = parseSource(text, { format: source.format, kind: source.kind, field_map: source.field_map, today: env.today });
    return { hash, parsed };
  } catch (err) {
    stat.failed = 1;
    // last_attempt moves a broken source behind the lists that were read, without touching failed_parses retirement.
    source.last_attempt = env.today;
    source.failed_parses = Number(source.failed_parses ?? 0) + 1;
    ctx.log?.(`github-lists: ${source.name} failed: ${err.message}`);
    return null;
  }
}

function collectUnique(resolved, source, stat, env, acc) {
  for (const row of resolved) {
    const key = urlKey(row.url);
    if (!key) continue;
    // Already in the queue: another list added it earlier in this run, or it is in the sidecar from an earlier run.
    if (acc.seen.has(key)) {
      stat.already_queued++;
      continue;
    }
    acc.seen.add(key);
    if (env.known.has(key)) stat.already_queued++;
    if (!env.known.has(key)) stat.unique_new++;
    acc.jobs.push({ title: row.title, url: row.url, company: row.company, location: row.location });
    acc.sidecarRows.push({ url: row.url, src: `github:${source.name}`, imported: env.today, extid: row.extid ?? '', notes: '' });
  }
}

async function ingestSource(ctx, source, env, acc, capResolve = false) {
  const stat = { date: env.today, name: source.name, fetched: 0, eligible: 0, unique_new: 0, parse_errors: 0, failed: 0, deferred: 0, already_queued: 0 };
  const fetched = await fetchSource(ctx, source, stat, env);
  if (!fetched) return stat;
  const { hash, parsed } = fetched;
  source.failed_parses = 0;
  // A read that worked ends the failed state, so a last_attempt dated by an older release (UTC) cannot keep the list in the retry group.
  delete source.last_attempt;
  // last_read marks any successful read, including one whose rows the budget deferred, so that source stops outranking
  // lists that were never read.
  source.last_read = env.today;
  if (hash !== source.last_hash) source.last_push = env.today;
  source.last_push ??= env.today;
  source.last_hash = hash;
  stat.fetched = parsed.rows.length;
  stat.parse_errors = parsed.parseErrors;
  const { cycle, titleRules, earlyCareer } = env;
  const eligible = parsed.rows
    .filter((row) => isEligible(row, { cycle, titleRules, earlyCareer }).ok)
    .map((row) => ({ ...row, source: source.name }));
  stat.eligible = eligible.length;
  let deferred = 0;
  const deadline = capResolve ? Math.min(env.deadline, Date.now() + env.resolveCapMs) : env.deadline;
  const resolved = await resolveAggregator(eligible, { fetch: ctx.fetch, sleep: env.sleep, dataRoot: env.dataDir, today: env.today, dryRun: ctx.dryRun, deadline, onDeferred: (n) => { deferred = n; } });
  // A source with rows the time budget cut off keeps its old last_ingest; its last_read still moves it behind unread lists.
  stat.deferred = deferred;
  if (deferred) ctx.log?.(`github-lists: ${source.name}: ${deferred} row(s) deferred, time budget reached`);
  else source.last_ingest = env.today;
  collectUnique(resolved, source, stat, env, acc);
  return stat;
}

// The upstream host passes neither ctx.preset nor ctx.config, so a real run reads the rules apply-answers wrote into the
// registry (already folded through effectiveTitleRules). A caller that does pass a preset gets the same folding here,
// because this directory is a self-contained copy and cannot import the pack's lib.
function titleRulesFor(ctx, registry) {
  const rules = ctx.preset?.title_rules;
  if (!rules) return { include: registry.rules?.include ?? [], exclude: registry.rules?.exclude ?? [] };
  const citizen = ctx.config?.us_citizen === true;
  return { include: rules.include ?? [], exclude: [...(rules.exclude ?? []), ...(citizen ? [] : (rules.exclude_unless_citizen ?? []))] };
}

// The upstream host passes the career-ops root as ctx.dataRoot, while the pack keeps its files in <root>/data. A caller
// that passes the data directory itself (the tests) is used as given.
function studentDataDir(dataRoot) {
  const nested = join(dataRoot, 'data');
  return existsSync(join(nested, 'student-github-sources.json')) ? nested : dataRoot;
}

// Dates are local, the same convention first-run.mjs, daily.mjs and the upstream host use. The pack passes its own date in
// STUDENT_TODAY so a configured timezone gives one date everywhere.
export function localDate(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function runDate(ctx) {
  if (ctx.today) return ctx.today;
  const pinned = process.env.STUDENT_TODAY;
  return /^\d{4}-\d{2}-\d{2}$/.test(pinned ?? '') ? pinned : localDate();
}

export default {
  async ingest(ctx) {
    const sleep = ctx.sleep ?? REAL_SLEEP;
    const today = runDate(ctx);
    const dataDir = studentDataDir(ctx.dataRoot);
    const registry = readJson(join(dataDir, 'student-github-sources.json'));
    const cycle = readJson(join(dataDir, 'student-cycle.json'));
    if (!registry || !cycle) {
      ctx.log?.('github-lists: registry or cycle file missing; run the personalization interview first');
      return [];
    }
    const sidecarFile = join(dataDir, 'student-rows.tsv');
    const deadline = Date.now() + (ctx.budgetMs ?? HOST_BUDGET_MS);
    const env = { deadline, resolveCapMs: ctx.resolveCapMs ?? RESOLVE_CAP_MS, sleep, today, dataDir, cycle, titleRules: titleRulesFor(ctx, registry), earlyCareer: ctx.preset?.early_career ?? registry.rules?.early_career, known: loadSidecarKeys(sidecarFile) };
    const acc = { seen: new Set(), jobs: [], sidecarRows: [] };
    const stats = [];

    const sources = (registry.sources ?? []).filter((s) => s.status === 'active' || s.status === 'trial');
    // Order: research-added lists nobody has touched, other untouched lists, lists whose last attempt failed, lists with rows
    // the time budget deferred, then lists already fully read; inside a tier the least recently touched goes first and
    // equal ones keep their registry position. A failed list is retried before deferred ones so one broken or slow list
    // is never starved by lists that only have leftovers.
    const lastRead = (x) => [x.last_ingest, x.last_read].map((d) => String(d ?? '')).sort().at(-1);
    const lastTouched = (x) => [lastRead(x), String(x.last_attempt ?? '')].sort().at(-1);
    const failed = (x) => Boolean(x.last_attempt && String(x.last_attempt) >= lastRead(x));
    const deferredLeft = (x) => Boolean(x.last_read) && String(x.last_ingest ?? '') < String(x.last_read);
    const tier = (x) => (!lastTouched(x) ? (x.notes === 'research' ? 0 : 1) : failed(x) ? 2 : deferredLeft(x) ? 3 : 4);
    const order = [...sources].sort((x, y) => tier(x) - tier(y) || lastTouched(x).localeCompare(lastTouched(y)));
    for (const [i, source] of order.entries()) {
      if (Date.now() > deadline) {
        ctx.log?.(`github-lists: time budget reached; ${order.length - i} source(s) wait for the next run`);
        break;
      }
      if (i > 0) await sleep(LIMITS.request_gap_ms);
      stats.push(await ingestSource(ctx, source, env, acc, order.slice(i + 1).some((x) => tier(x) <= 2)));
    }

    for (const source of sources) {
      const stat = stats.find((t) => t.name === source.name);
      if (stat && !stat.failed) source.last_unique = stat.unique_new > 0 ? today : (source.last_unique ?? today);
    }

    if (!ctx.dryRun) {
      writeJsonAtomic(join(dataDir, 'student-github-sources.json'), registry);
      await appendStats(join(dataDir, 'student-github-stats.tsv'), STATS_HEADER, stats);
      await upsertSidecar(sidecarFile, acc.sidecarRows);
    }
    return acc.jobs;
  },
};
