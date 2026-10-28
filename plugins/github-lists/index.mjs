// Ingest hook: GitHub job lists -> postings that fit the student's cycle.
// Reads student-github-sources.json (registry) and student-cycle.json from ctx.dataRoot; ctx.preset carries
// early_career and title_rules. The plugin runs
// as a hashed copy in plugins.local/, so everything it needs lives in this directory.
import { join } from 'node:path';
import { LIMITS } from './_limits.mjs';
import { appendStats, loadSidecarKeys, readJson, upsertSidecar, urlKey } from './_io.mjs';
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
    const titleRules = ctx.preset?.title_rules ?? {};
    const earlyCareer = ctx.preset?.early_career;
    const sidecarFile = join(dataDir, 'student-rows.tsv');
    const known = loadSidecarKeys(sidecarFile);
    const seen = new Set();
    const jobs = [];
    const stats = [];
    const sidecarRows = [];

    const sources = (registry.sources ?? []).filter((s) => s.status === 'active' || s.status === 'trial');
    for (const [i, source] of sources.entries()) {
      if (i > 0) await sleep(LIMITS.request_gap_ms);
      const stat = { date: today, name: source.name, fetched: 0, eligible: 0, unique_new: 0, parse_errors: 0, failed: 0 };
      stats.push(stat);
      let parsed;
      try {
        const text = await fetchListText(ctx, rawUrl(source), sleep);
        parsed = parseSource(text, { format: source.format, kind: source.kind, field_map: source.field_map, today });
      } catch (err) {
        stat.failed = 1;
        ctx.log?.(`github-lists: ${source.name} failed: ${err.message}`);
        continue;
      }
      stat.fetched = parsed.rows.length;
      stat.parse_errors = parsed.parseErrors;
      const eligible = parsed.rows
        .filter((row) => isEligible(row, { cycle, titleRules, earlyCareer }).ok)
        .map((row) => ({ ...row, source: source.name }));
      stat.eligible = eligible.length;
      const resolved = await resolveAggregator(eligible, { fetch: ctx.fetch, sleep, dataRoot: dataDir, today, dryRun: ctx.dryRun });
      for (const row of resolved) {
        const key = urlKey(row.url);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (!known.has(key)) stat.unique_new++;
        jobs.push({ title: row.title, url: row.url, company: row.company, location: row.location });
        sidecarRows.push({ url: row.url, src: `github:${source.name}`, imported: today, extid: row.extid ?? '', notes: '' });
      }
    }

    if (!ctx.dryRun) {
      await appendStats(join(dataDir, 'student-github-stats.tsv'), STATS_HEADER, stats);
      await upsertSidecar(sidecarFile, sidecarRows);
    }
    return jobs;
  },
};
