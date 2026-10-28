#!/usr/bin/env node
// Monthly discovery of public GitHub job lists: probes new repos, promotes useful trials, retires dead lists.
// Uses the unauthenticated GitHub REST search API (10 requests per minute); a run makes at most 10 search calls
// paced 6 s apart, because the gh CLI needs a login that students do not have.
// Usage: discover-github-lists.mjs [--data-dir D] [--today YYYY-MM-DD] [--dry-run] [--no-search] [--max-add N] [--json]
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runCli } from '../lib/args.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { readCycle } from '../lib/cycle-file.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { loadMerged } from '../lib/presets.mjs';
import { readTsv, writeAtomic } from '../lib/tsv.mjs';
import { isEligible } from '../plugins/github-lists/_eligibility.mjs';
import { parseSource } from '../plugins/github-lists/_parsers.mjs';
import { rawUrl } from '../plugins/github-lists/index.mjs';

// Values mirror the discovery rows of scripts/budget.mjs CEILINGS; a test asserts they agree.
export const DISCOVERY = Object.freeze({
  max_search_calls: 10,
  search_gap_ms: 6000,
  probe_gap_ms: 1200,
  max_new_trials: 3,
  min_active_per_kind: 2,
  push_window_days: 14,
  retire_days: 30,
  failed_parses: 3,
});

const DAY_MS = 86400000;
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

function readRegistry(file) {
  if (!existsSync(file)) return { version: 1, rules: {}, sources: [] };
  return JSON.parse(readFileSync(file, 'utf8'));
}

// Retire and promote decisions for sources already in the registry.
export function maintain(registry, today) {
  const events = [];
  const activeOfKind = (kind) => registry.sources.filter((s) => s.status === 'active' && s.kind === kind).length;
  for (const s of registry.sources) {
    if (s.status !== 'active' && s.status !== 'trial') continue;
    const age = daysBetween(s.added ?? today, today);
    const quietFor = (date) => daysBetween(date, today);
    const stalePush = Boolean(s.last_push) && quietFor(s.last_push) > DISCOVERY.retire_days;
    const noUnique = Boolean(s.last_unique) && quietFor(s.last_unique) > DISCOVERY.retire_days;
    const failing = Number(s.failed_parses ?? 0) >= DISCOVERY.failed_parses;
    if (stalePush || noUnique || failing) {
      const reason = failing ? `${DISCOVERY.failed_parses} failed parses` : stalePush ? 'no push in 30 days' : 'no unique rows in 30 days';
      if (s.status === 'active' && activeOfKind(s.kind) <= DISCOVERY.min_active_per_kind) {
        events.push({ name: s.name, action: 'kept', reason: `${reason}, but fewer than ${DISCOVERY.min_active_per_kind} active ${s.kind} lists would remain` });
        continue;
      }
      s.status = 'retired';
      s.notes = `retired ${today}: ${reason}`;
      events.push({ name: s.name, action: 'retired', reason });
    } else if (s.status === 'trial' && age >= DISCOVERY.retire_days && s.last_unique) {
      s.status = 'active';
      events.push({ name: s.name, action: 'promoted', reason: 'unique rows within 30 days' });
    }
  }
  return events;
}

export function buildQueries({ searchTerms, cycle }) {
  const years = [...new Set([...cycle.internship_years, ...cycle.newgrad_years])];
  const queries = [];
  for (const term of searchTerms) for (const y of years) queries.push(`${term} ${y}`);
  return queries.slice(0, DISCOVERY.max_search_calls);
}

async function searchRepos({ fetchImpl, sleep, queries, cutoff }) {
  const found = new Map();
  for (const [i, q] of queries.entries()) {
    if (i > 0) await sleep(DISCOVERY.search_gap_ms);
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(`${q} pushed:>=${cutoff}`)}&sort=updated&per_page=20`;
    const res = await fetchImpl(url, { headers: { 'User-Agent': 'career-ops-student-pack', Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub search returned HTTP ${res.status}`);
    for (const item of (await res.json()).items ?? []) {
      if (item.pushed_at && item.pushed_at.slice(0, 10) >= cutoff) found.set(item.full_name, item);
    }
  }
  return [...found.values()];
}

async function probe({ fetchImpl, sleep, repo, cycle, rules, knownKeys, today }) {
  const kind = /intern/i.test(repo.full_name) ? 'internship' : 'newgrad';
  const source = { name: repo.full_name.replace('/', '-').toLowerCase(), repo: repo.full_name, branch: repo.default_branch || 'HEAD', path: 'README.md', kind };
  await sleep(DISCOVERY.probe_gap_ms);
  const res = await fetchImpl(rawUrl(source), { headers: { 'User-Agent': 'career-ops-student-pack' } });
  if (!res.ok) return null;
  const text = await res.text();
  source.format = /<table/i.test(text) ? 'html-table' : 'markdown-table';
  const { rows } = parseSource(text, { format: source.format, kind: source.kind, today });
  const unique = rows.filter((r) => {
    const ok = isEligible(r, { cycle, titleRules: rules, earlyCareer: rules.early_career }).ok;
    return ok && !knownKeys.has(r.url);
  });
  return unique.length ? { source, unique: unique.length, pushed: repo.pushed_at.slice(0, 10) } : null;
}

function digest({ today, events, added, queries }) {
  const lines = [`# GitHub job lists, ${today.slice(0, 7)}`, '', `Run on ${today}. Search queries: ${queries.length}.`, '', '## Added as trials', ''];
  lines.push(...(added.length ? added.map((a) => `- ${a.source.repo} (${a.source.kind}, ${a.unique} unique eligible rows)`) : ['- none']));
  lines.push('', '## Changes to existing lists', '');
  lines.push(...(events.length ? events.map((e) => `- ${e.name}: ${e.action} (${e.reason})`) : ['- none']));
  return `${lines.join('\n')}\n`;
}

export async function discover({ dataDir, root, preset, today, dryRun = false, noSearch = false, maxAdd = DISCOVERY.max_new_trials, fetchImpl = globalThis.fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const cycle = readCycle(join(dataDir, 'student-cycle.json'));
  if (!cycle) throw new Error('data/student-cycle.json is missing: run scripts/cycle.mjs first');
  const registryFile = join(dataDir, 'student-github-sources.json');
  const registry = readRegistry(registryFile);
  const events = maintain(registry, today);

  let added = [];
  let queries = [];
  let searched = false;
  if (!noSearch) {
    const merged = preset ?? loadMerged((await loadStudentConfig({ root }))?.presets ?? [], { root }) ?? { search_terms: [], title_rules: {}, early_career: '' };
    const rules = { ...merged.title_rules, early_career: merged.early_career };
    queries = buildQueries({ searchTerms: merged.search_terms, cycle });
    const have = new Set(registry.sources.map((s) => s.repo.toLowerCase()));
    const candidates = (await searchRepos({ fetchImpl, sleep, queries, cutoff: addDays(today, -DISCOVERY.push_window_days) })).filter((r) => !have.has(r.full_name.toLowerCase()));
    searched = true;
    const knownKeys = new Set((await readTsv(join(dataDir, 'student-rows.tsv'))).rows.map((r) => r.url));
    const probed = [];
    for (const repo of candidates.slice(0, DISCOVERY.max_search_calls)) {
      const hit = await probe({ fetchImpl, sleep, repo, cycle, rules, knownKeys, today });
      if (hit) probed.push(hit);
    }
    probed.sort((a, b) => b.unique - a.unique);
    added = probed.slice(0, Math.min(maxAdd, DISCOVERY.max_new_trials));
    for (const a of added) registry.sources.push({ ...a.source, status: 'trial', added: today, last_push: a.pushed, last_unique: today, failed_parses: 0, notes: 'discovered' });
  }

  if (!dryRun) {
    writeAtomic(registryFile, `${JSON.stringify(registry, null, 2)}\n`);
    if (searched) writeAtomic(join(dataDir, `digest-github-sources-${today.slice(0, 7)}.md`), digest({ today, events, added, queries }));
  }
  return { events, added: added.map((a) => a.source.repo), searched };
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const { flags } = parseArgs(argv, { flags: { 'no-search': 'boolean', 'max-add': 'int' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const today = flags.today ?? new Date().toISOString().slice(0, 10);
  const result = await discover({
    dataDir: paths.dataDir,
    root: paths.root,
    preset: deps.preset,
    today,
    dryRun: flags.dryRun,
    noSearch: flags.noSearch,
    maxAdd: Math.min(flags.maxAdd ?? DISCOVERY.max_new_trials, DISCOVERY.max_new_trials),
    ...(deps.fetch ? { fetchImpl: deps.fetch } : {}),
    ...(deps.sleep ? { sleep: deps.sleep } : {}),
  });
  console.log(flags.json ? JSON.stringify(result) : `discover: ${result.added.length} added, ${result.events.length} changes`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(() => main());
