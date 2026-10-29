// Ingest hook: GitHub job lists -> postings that fit the student's cycle.
// Reads student-github-sources.json (registry) and student-cycle.json from ctx.dataRoot; ctx.preset, when given,
// carries early_career and title_rules. The plugin runs
// as a hashed copy in plugins.local/, so everything it needs lives in this directory.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { LIMITS } from './_limits.mjs';
import { appendStats, loadSidecarKeys, readJson, upsertSidecar, urlKey, writeJsonAtomic } from './_io.mjs';
import { parseSource } from './_parsers.mjs';
import { isEligible } from './_eligibility.mjs';
import { resolveAggregator } from './_resolve.mjs';

const STATS_HEADER = ['date', 'name', 'fetched', 'eligible', 'unique_new', 'parse_errors', 'failed'];
const REAL_SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

export function rawUrl(source) {
  return `https://raw.githubusercontent.com/${source.repo}/${source.branch || 'HEAD'}/${source.path}`;
}

// 429 and 5xx back off 3000 ms times the attempt number; three attempts, then the source counts as failed.
export async function fetchListText(ctx, url, sleep) {
  let lastError = new Error('no attempt made');
  for (let attempt = 1; attempt <= LIMITS.max_attempts; attempt++) {
    try {
      const res = await ctx.fetch(url, { headers: { 'User-Agent': 'career-ops-student-pack' } });
      if (res.ok) return await res.text();
      lastError = new Error(`HTTP ${res.status}`);
      if (res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastError = err;
    }
    if (attempt < LIMITS.max_attempts) await sleep(LIMITS.backoff_ms_per_attempt * attempt);
  }
  throw lastError;
}

async function fetchSource(ctx, source, stat, env) {
  try {
    const text = await fetchListText(ctx, rawUrl(source), env.sleep);
    const hash = createHash('sha256').update(text).digest('hex');
    const parsed = parseSource(text, { format: source.format, kind: source.kind, field_map: source.field_map, today: env.today });
    return { hash, parsed };
  } catch (err) {
    stat.failed = 1;
    source.failed_parses = Number(source.failed_parses ?? 0) + 1;
    ctx.log?.(`github-lists: ${source.name} failed: ${err.message}`);
    return null;
  }
}

function collectUnique(resolved, source, stat, env, acc) {
  for (const row of resolved) {
    const key = urlKey(row.url);
    if (!key || acc.seen.has(key)) continue;
    acc.seen.add(key);
    if (!env.known.has(key)) stat.unique_new++;
    acc.jobs.push({ title: row.title, url: row.url, company: row.company, location: row.location });
    acc.sidecarRows.push({ url: row.url, src: `github:${source.name}`, imported: env.today, extid: row.extid ?? '', notes: '' });
  }
}

async function ingestSource(ctx, source, env, acc) {
  const stat = { date: env.today, name: source.name, fetched: 0, eligible: 0, unique_new: 0, parse_errors: 0, failed: 0 };
  const fetched = await fetchSource(ctx, source, stat, env);
  if (!fetched) return stat;
  const { hash, parsed } = fetched;
  source.failed_parses = 0;
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
  const resolved = await resolveAggregator(eligible, { fetch: ctx.fetch, sleep: env.sleep, dataRoot: env.dataDir, today: env.today, dryRun: ctx.dryRun });
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

export default {
  async ingest(ctx) {
    const sleep = ctx.sleep ?? REAL_SLEEP;
    const today = ctx.today ?? new Date().toISOString().slice(0, 10);
    const dataDir = ctx.dataRoot;
    const registry = readJson(join(dataDir, 'student-github-sources.json'));
    const cycle = readJson(join(dataDir, 'student-cycle.json'));
    if (!registry || !cycle) {
      ctx.log?.('github-lists: registry or cycle file missing; run the personalization interview first');
      return [];
    }
    const sidecarFile = join(dataDir, 'student-rows.tsv');
    const env = { sleep, today, dataDir, cycle, titleRules: titleRulesFor(ctx, registry), earlyCareer: ctx.preset?.early_career ?? registry.rules?.early_career, known: loadSidecarKeys(sidecarFile) };
    const acc = { seen: new Set(), jobs: [], sidecarRows: [] };
    const stats = [];

    const sources = (registry.sources ?? []).filter((s) => s.status === 'active' || s.status === 'trial');
    for (const [i, source] of sources.entries()) {
      if (i > 0) await sleep(LIMITS.request_gap_ms);
      stats.push(await ingestSource(ctx, source, env, acc));
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
