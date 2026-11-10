#!/usr/bin/env node
// Per-major source research: vets the job boards and GitHub lists the student's agent found by web search (plus the
// preset catalog and a bounded GitHub search) and writes the survivors into portals.yml and the GitHub list registry.
// The agent supplies candidates; this script decides, so a hallucinated or unreadable source never reaches the scan.
// Every candidate must pass robots.txt, be readable by upstream's audit (boards) or yield MIN_MATCHED_ROWS eligible
// rows (lists), and not duplicate a source the student already has. No model call is made here.
// Usage: research-sources.mjs [--candidates F] [--root R] [--data-dir D] [--today YYYY-MM-DD] [--dry-run] [--no-search]
// Exit 0 after the summary, 1 when a prerequisite file is missing or data/research-candidates.json is malformed.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { upsertPortalsBlock } from '../interview/apply-answers.mjs';
import { parseArgs, runCli, isMain } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { companyKey } from '../lib/company-key.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { readCycle } from '../lib/cycle-file.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { loadMerged } from '../lib/presets.mjs';
import { createRobotsChecker } from '../lib/robots.mjs';
import { withTempDir } from '../lib/temp-dir.mjs';
import { readTsv, writeAtomic } from '../lib/tsv.mjs';
import { createUpstream } from '../lib/upstream.mjs';
import { isEligible } from '../plugins/github-lists/_eligibility.mjs';
import { LIMITS as LIST_LIMITS } from '../plugins/github-lists/_limits.mjs';
import { parseSource } from '../plugins/github-lists/_parsers.mjs';
import { rawUrl } from '../plugins/github-lists/index.mjs';
import { DISCOVERY, buildQueries, searchRepos } from './discover-github-lists.mjs';

// The documented keep rule for a list: fewer matched rows means the list does not fit this student's field.
export const MIN_MATCHED_ROWS = 5;
export const RESEARCH_LIMITS = Object.freeze({ max_boards: 20, max_lists: 15, deadline_ms: 5 * 60 * 1000 });

const NO_CANDIDATES = Object.freeze({ web_searches: 0, boards: [], github_lists: [] });
const STOP_WORDS = new Set(['and', 'the', 'for', 'of', 'in', 'to', 'at']);
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class ResearchError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ResearchError';
  }
}

// Public board APIs the pack can read; the API URL is what robots.txt is checked against.
const PROVIDERS = [
  { id: 'greenhouse', host: /^(job-boards|boards)\.greenhouse\.io$/, api: (slug) => `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs` },
  { id: 'lever', host: /^jobs\.lever\.co$/, api: (slug) => `https://api.lever.co/v0/postings/${slug}` },
  { id: 'ashby', host: /^jobs\.ashbyhq\.com$/, api: (slug) => `https://api.ashbyhq.com/posting-api/job-board/${slug}` },
];

export function boardFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const provider = PROVIDERS.find((p) => p.host.test(parsed.hostname.toLowerCase()));
  const slug = parsed.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
  return provider && slug ? { provider: provider.id, slug, careersUrl: `https://${parsed.hostname.toLowerCase()}/${slug}`, apiUrl: provider.api(slug) } : null;
}

// First problem as a sentence, or null when the object has the {web_searches, boards, github_lists} shape.
function candidateProblem(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return 'expected an object';
  for (const key of Object.keys(c)) if (!['web_searches', 'boards', 'github_lists'].includes(key)) return `unknown key ${key}`;
  if (c.web_searches !== undefined && !(Number.isInteger(c.web_searches) && c.web_searches >= 0 && c.web_searches <= 5)) return 'web_searches must be a whole number from 0 to 5';
  if (c.boards !== undefined && !Array.isArray(c.boards)) return 'boards must be a list';
  for (const [i, b] of (c.boards ?? []).entries()) {
    if (!b || typeof b.name !== 'string' || !b.name.trim()) return `boards[${i}].name must be a non-empty string`;
    if (typeof b.careers_url !== 'string' || !/^https:\/\//.test(b.careers_url)) return `boards[${i}].careers_url must be an https URL`;
  }
  if (c.github_lists !== undefined && !Array.isArray(c.github_lists)) return 'github_lists must be a list';
  for (const [i, g] of (c.github_lists ?? []).entries()) {
    if (!g || typeof g.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(g.repo)) return `github_lists[${i}].repo must look like owner/name`;
    if (g.path !== undefined && typeof g.path !== 'string') return `github_lists[${i}].path must be a string`;
    if (g.kind !== undefined && !['internship', 'newgrad'].includes(g.kind)) return `github_lists[${i}].kind must be internship or newgrad`;
  }
  return null;
}

// A missing file means the agent found nothing; a present file must be well formed.
export function readCandidates(file) {
  if (!existsSync(file)) return NO_CANDIDATES;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new ResearchError(`research-candidates.json: not valid JSON (${err.message}); fix the file and run again`);
  }
  const problem = candidateProblem(parsed);
  if (problem) throw new ResearchError(`research-candidates.json: ${problem}; fix the file and run again`);
  return { web_searches: parsed.web_searches ?? 0, boards: parsed.boards ?? [], github_lists: parsed.github_lists ?? [] };
}

const wordRegex = (archetypes) => {
  const words = [...new Set(archetypes.flatMap((a) => a.toLowerCase().split(/[^a-z0-9+#]+/)).filter((w) => w.length > 2 && !STOP_WORDS.has(w)))];
  return words.length ? [`\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`] : [];
};

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const RESEARCH_BLOCK = /^[ \t]*# student-pack:start research_companies\n([\s\S]*?)^[ \t]*# student-pack:end research_companies[ \t]*$/m;

function priorResearchEntries(portalsText) {
  const hit = RESEARCH_BLOCK.exec(portalsText);
  const list = hit ? yaml.load(hit[1]) : null;
  return Array.isArray(list) ? list : [];
}

const entryLines = ({ name, careers_url: url }) => [`  - name: ${JSON.stringify(name)}`, `    careers_url: ${url}`, '    enabled: true'];

// Every employer the student already has, as provider+slug and normalized-name keys.
function knownEmployerKeys({ merged, portalsText, targets }) {
  const keys = new Set();
  const add = (name, url) => {
    if (name) keys.add(`name:${companyKey(name)}`);
    const board = url ? boardFromUrl(url) : null;
    if (board) keys.add(`${board.provider}:${board.slug}`);
  };
  for (const e of merged?.seed_employers ?? []) add(e.name, e.careers_url);
  for (const e of targets) add(e.name, e.careers_url);
  const doc = portalsText.trim() ? yaml.load(portalsText) : null;
  for (const e of Array.isArray(doc?.tracked_companies) ? doc.tracked_companies : []) add(e?.name, e?.careers_url);
  return keys;
}

async function auditBoards(upstream, entries) {
  return withTempDir('career-ops-research-', async (dir) => {
    const file = join(dir, 'portals.yml');
    writeAtomic(file, yaml.dump({ tracked_companies: entries.map((e) => ({ name: e.name, careers_url: e.careers_url, enabled: true })) }, { lineWidth: -1 }));
    const raw = await upstream.auditPortals(['--json', '--file', file]);
    const parsed = typeof raw === 'string' ? JSON.parse(raw.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop() ?? '{}') : raw;
    return new Map((parsed.boards ?? []).map((b) => [b.name, b]));
  });
}

// The source's format: the catalog's when it has one, else from the file name and content. A .json or .csv list needs
// the catalog's field_map, so an unknown one is not guessed.
function formatFor(candidate, text) {
  if (candidate.format) return { format: candidate.format };
  const path = candidate.path.toLowerCase();
  if (path.endsWith('listings.json')) return { format: 'simplify-json' };
  if (path.endsWith('.md')) return { format: /<table/i.test(text) ? 'html-table' : 'markdown-table' };
  return { skip: 'needs a field map' };
}

// Everything research reads before it makes a request: prerequisites, the student's rules and the sources already held.
async function loadContext({ paths, preset }) {
  const cycle = readCycle(join(paths.dataDir, 'student-cycle.json'));
  const registryFile = join(paths.dataDir, 'student-github-sources.json');
  if (!cycle || !existsSync(registryFile)) throw new ResearchError('run apply-answers.mjs --stage queue first');
  const registry = readJson(registryFile);
  const config = await loadStudentConfig({ root: paths.root });
  const merged = preset ?? loadMerged(config?.presets ?? [], { root: paths.root });
  const answersFile = join(paths.dataDir, 'interview-answers.json');
  const answers = existsSync(answersFile) ? readJson(answersFile) : {};
  const archetypes = answers.archetypes ?? [];
  const mergedRules = merged?.title_rules ?? {};
  const include = registry.rules?.include?.length ? registry.rules.include : mergedRules.include?.length ? mergedRules.include : wordRegex(archetypes);
  const portalsText = existsSync(paths.portalsFile) ? readFileSync(paths.portalsFile, 'utf8') : '';
  return {
    cycle,
    registry,
    registryFile,
    merged,
    archetypes,
    portalsText,
    titleRules: { include, exclude: registry.rules?.exclude ?? mergedRules.exclude ?? [] },
    earlyCareer: registry.rules?.early_career ?? merged?.early_career,
    knownRows: new Set((await readTsv(join(paths.dataDir, 'student-rows.tsv'))).rows.map((r) => r.url)),
    known: knownEmployerKeys({ merged, portalsText, targets: answers.target_employers ?? [] }),
  };
}

// The audit result for the boards that passed the cheap checks; one upstream call covers them all.
async function auditSurvivors({ survivors, upstream, root, added, skip }) {
  try {
    const audit = await auditBoards(upstream ?? createUpstream({ root }), survivors);
    for (const s of survivors) {
      const status = audit.get(s.name)?.status ?? 'error';
      if (status === 'ok' || status === 'small') added.push({ ...s, type: 'board', detail: `${s.provider}, ${audit.get(s.name)?.postings ?? 0} postings` });
      else skip(s.name, `audit: ${status}`);
    }
  } catch (err) {
    for (const s of survivors) skip(s.name, `audit: error (${String(err.message).split('\n')[0]})`);
  }
}

// One board candidate through the cheap checks. Returns the survivor to audit, or null after recording why it was skipped.
async function checkBoard(c, { known, checker, skip }) {
  const board = boardFromUrl(c.careers_url);
  if (!board) return skip(c.name, 'no supported public board, check by hand');
  const keys = [`${board.provider}:${board.slug}`, `name:${companyKey(c.name)}`];
  if (keys.some((k) => known.has(k))) return skip(c.name, 'already in your list');
  const verdict = await checker.check(board.apiUrl);
  if (!verdict.allowed) return skip(c.name, verdict.reason);
  keys.forEach((k) => known.add(k));
  return { name: c.name, careers_url: board.careersUrl, provider: board.provider };
}

// Boards: cheap local checks first, robots next, one audit call for everything that is left.
async function vetBoards({ boards, ctx, checker, upstream, root, now, deadline, added, skip }) {
  const survivors = [];
  for (const [i, c] of boards.entries()) {
    if (i >= RESEARCH_LIMITS.max_boards) skip(c.name, 'cap reached');
    else if (now() >= deadline) skip(c.name, 'time limit reached');
    else {
      const survivor = await checkBoard(c, { known: ctx.known, checker, skip });
      if (survivor) survivors.push(survivor);
    }
  }
  if (survivors.length) await auditSurvivors({ survivors, upstream, root, added, skip });
}

// The lists to probe: the agent's, then the catalog of preset lists not yet in the registry, then a bounded GitHub search.
async function listCandidates({ githubLists, ctx, today, counted, sleep, noSearch, skip }) {
  const have = new Set(ctx.registry.sources.map((s) => `${s.repo.toLowerCase()}/${s.path}`));
  const queue = [];
  const enqueue = (c) => {
    const key = `${c.repo.toLowerCase()}/${c.path ?? 'README.md'}`;
    if (have.has(key)) return;
    have.add(key);
    queue.push({ ...c, path: c.path ?? 'README.md' });
  };
  githubLists.forEach(enqueue);
  (ctx.merged?.sources.github_lists ?? []).forEach(enqueue);
  if (noSearch) return queue;
  const terms = ctx.merged?.search_terms?.length ? ctx.merged.search_terms : ctx.archetypes.flatMap((a) => [`${a} internship`, `${a} new grad`]);
  const queries = buildQueries({ searchTerms: terms, cycle: ctx.cycle });
  if (!queries.length) return queue;
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - DISCOVERY.push_window_days * 86400000).toISOString().slice(0, 10);
  try {
    for (const r of await searchRepos({ fetchImpl: counted, sleep, queries, cutoff })) enqueue({ repo: r.full_name });
  } catch (err) {
    skip('GitHub search', `unavailable (${String(err.message).split('\n')[0]})`);
  }
  return queue;
}

// Reads one list file and counts the rows that fit the student. Returns { source, matched } or { reason } for a skip.
async function probeList(c, { ctx, today, checker, counted }) {
  const source = { name: c.name ?? c.repo.replace('/', '-').toLowerCase(), repo: c.repo, branch: 'HEAD', path: c.path, kind: c.kind ?? (/intern/i.test(c.repo) ? 'internship' : 'newgrad'), field_map: c.field_map ?? {} };
  const url = rawUrl(source);
  const verdict = await checker.check(url);
  if (!verdict.allowed) return { reason: verdict.reason };
  let text;
  try {
    const res = await counted(url, { headers: { 'User-Agent': 'career-ops-student-pack' } });
    if (!res.ok) return { reason: `list unreadable (HTTP ${res.status})` };
    text = await res.text();
  } catch (err) {
    return { reason: `list unreadable (${err.message})` };
  }
  const fmt = formatFor(c, text);
  if (fmt.skip) return { reason: fmt.skip };
  source.format = fmt.format;
  let rows;
  try {
    ({ rows } = parseSource(text, { format: source.format, kind: source.kind, field_map: source.field_map, today }));
  } catch (err) {
    return { reason: `list unreadable (${String(err.message).split('\n')[0]})` };
  }
  const eligible = rows.filter((r) => isEligible(r, { cycle: ctx.cycle, titleRules: ctx.titleRules, earlyCareer: ctx.earlyCareer }).ok && !ctx.knownRows.has(r.url));
  return { source, matched: new Set(eligible.map((r) => r.url)).size };
}

async function vetLists({ queue, ctx, today, checker, counted, sleep, now, deadline, added, skip }) {
  const fresh = [];
  let probes = 0;
  for (const c of queue) {
    const label = c.name ?? c.repo;
    if (probes >= RESEARCH_LIMITS.max_lists) skip(label, 'cap reached');
    else if (now() >= deadline) skip(label, 'time limit reached');
    else {
      if (probes > 0) await sleep(LIST_LIMITS.request_gap_ms);
      probes += 1;
      const hit = await probeList(c, { ctx, today, checker, counted });
      if (hit.reason) skip(label, hit.reason);
      else if (hit.matched < MIN_MATCHED_ROWS) skip(label, `${hit.matched} matching rows, needs ${MIN_MATCHED_ROWS}`);
      else {
        added.push({ name: hit.source.name, type: 'list', detail: `${hit.matched} matching rows` });
        fresh.push({ ...hit.source, status: 'trial', added: today, last_push: null, last_unique: null, failed_parses: 0, notes: 'research' });
      }
    }
  }
  return fresh;
}

// Writes the research_companies block, the registry entries and the day's summary file. A flow-style tracked_companies
// list cannot take a block, so its boards are reported as skipped instead.
function writeResults({ paths, ctx, today, added, skipped, fresh, cost }) {
  const boards = added.filter((a) => a.type === 'board');
  if (boards.length) {
    const merge = [...priorResearchEntries(ctx.portalsText), ...boards.map((b) => ({ name: b.name, careers_url: b.careers_url }))];
    const res = upsertPortalsBlock(ctx.portalsText, 'research_companies', 'tracked_companies', merge.flatMap(entryLines));
    if (res.kept) {
      for (const b of boards) skipped.push({ name: b.name, reason: 'tracked_companies in portals.yml is a flow-style list; rewrite it in block form' });
      added.splice(0, added.length, ...added.filter((a) => a.type !== 'board'));
    } else {
      yaml.load(res.text);
      writeAtomic(paths.portalsFile, res.text);
    }
  }
  if (fresh.length) writeAtomic(ctx.registryFile, `${JSON.stringify({ ...ctx.registry, sources: [...ctx.registry.sources, ...fresh] }, null, 2)}\n`);
  const result = { added: added.map(({ source: _s, ...rest }) => rest), skipped, cost };
  mkdirSync(paths.dataDir, { recursive: true });
  writeAtomic(join(paths.dataDir, `research-${today}.json`), `${JSON.stringify(result, null, 2)}\n`);
}

export async function research({ paths, today, candidates = NO_CANDIDATES, fetch = globalThis.fetch, sleep = realSleep, now = Date.now, upstream, dryRun = false, noSearch = false, preset }) {
  const ctx = await loadContext({ paths, preset });
  const startedAt = now();
  const deadline = startedAt + RESEARCH_LIMITS.deadline_ms;
  let requests = 0;
  const counted = async (url, init) => {
    requests += 1;
    return fetch(url, init);
  };
  const checker = createRobotsChecker({ fetch: counted });
  const added = [];
  const skipped = [];
  const skip = (name, reason) => {
    skipped.push({ name, reason });
    return null;
  };
  await vetBoards({ boards: candidates.boards, ctx, checker, upstream, root: paths.root, now, deadline, added, skip });
  const queue = await listCandidates({ githubLists: candidates.github_lists, ctx, today, counted, sleep, noSearch, skip });
  const fresh = await vetLists({ queue, ctx, today, checker, counted, sleep, now, deadline, added, skip });
  const cost = { requests, seconds: Math.round((now() - startedAt) / 100) / 10, web_searches: candidates.web_searches };
  if (!dryRun) writeResults({ paths, ctx, today, added, skipped, fresh, cost });
  return { added: added.map(({ source: _s, ...rest }) => rest), skipped, cost };
}

export function summaryLines({ added, skipped, cost }) {
  const boards = added.filter((a) => a.type === 'board').length;
  return [
    `research: added ${boards} boards, ${added.length - boards} GitHub lists`,
    ...added.map((a) => `added: ${a.name} (${a.type === 'board' ? 'board' : 'GitHub list'}, ${a.detail})`),
    ...skipped.map((s) => `skipped: ${s.name}: ${s.reason}`),
    `cost: ${cost.requests} requests, ${cost.seconds} s, ${cost.web_searches} web searches in this chat; no model call in this script`,
  ];
}

const pick = ({ fetch, sleep, now, upstream, preset }) => Object.fromEntries(Object.entries({ fetch, sleep, now, upstream, preset }).filter(([, v]) => v !== undefined));

export async function main(argv = process.argv.slice(2), deps = {}) {
  const { flags } = parseArgs(argv, { flags: { candidates: 'string', 'no-search': 'boolean' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const config = await loadStudentConfig({ root: paths.root });
  const today = flags.today ?? createClock({ timezone: config?.timezone, nowFn: deps.nowFn }).today();
  try {
    const candidates = readCandidates(flags.candidates ?? join(paths.dataDir, 'research-candidates.json'));
    const result = await research({ paths, today, candidates, dryRun: flags.dryRun, noSearch: flags.noSearch, ...deps.research, ...pick(deps) });
    for (const line of summaryLines(result)) console.log(line);
    return 0;
  } catch (err) {
    if (!(err instanceof ResearchError)) throw err;
    console.error(err.message);
    return 1;
  }
}

if (isMain(import.meta.url)) await runCli(() => main());
