// Fixtures for the research-sources tests: a scratch career-ops root, a recording fake fetch keyed by URL, a fake
// upstream auditPortals and a main() runner that captures the printed lines. Fake hosts and names only.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { main } from '../../scripts/research-sources.mjs';

export const TODAY = '2026-10-27';

export const CYCLE = {
  computed_at: '2026-10-27T12:00:00.000Z',
  today: TODAY,
  phase: 'recruiting',
  terms: [{ name: 'Summer', year: 2027, start: '2027-06-01' }],
  newgrad_years: [2027],
  internship_years: [2027],
  experience_ceiling_years: 2,
};

// Merged-preset shape (lib/presets.mjs mergePresets) with a software-style include rule.
export const PRESET = {
  id: 'software-cs',
  ids: ['software-cs'],
  early_career: 'intern|new grad|university|graduate',
  title_rules: { include: ['software|data|engineer'], exclude: ['sales', 'recruiter'], exclude_unless_citizen: [] },
  search_terms: [],
  archetypes: [],
  seed_employers: [],
  sources: { github_lists: [], alerts: [], nyc_jobs: false, usajobs: false },
};

// A preset with no include title rules, as the byo-employer-list preset merges.
export const BYO_PRESET = { ...PRESET, id: 'byo-employer-list', ids: ['byo-employer-list'], title_rules: { include: [], exclude: ['recruit'], exclude_unless_citizen: [] } };

export const ANSWERS = {
  archetypes: ['Brand Strategist'],
  locations: ['Remote'],
  target_employers: [{ name: 'Target Employer Co', careers_url: 'https://careers.example.com/target' }],
};

export const PORTALS_BEFORE = `# my own notes: keep this line
title_filter:
  # student-pack:start title_filter
  positive:
    - "software"
  negative:
    - "sales"
  # student-pack:end title_filter

location_filter:
  # student-pack:start location_filter
  allow:
    - "Remote"
  # student-pack:end location_filter

tracked_companies:
  # student-pack:start tracked_companies
  - name: "Mine Seed"
    careers_url: https://boards.greenhouse.io/mineseed
    enabled: true
  # student-pack:end tracked_companies
  - name: "Mine Co"
    careers_url: https://jobs.lever.co/mineco
    enabled: true

# student text after the blocks
`;

export const REGISTRY_BEFORE = { version: 1, rules: {}, sources: [] };

export function entry(o = {}) {
  return { name: 'seed', repo: 'example-org/seed', branch: 'HEAD', path: 'README.md', format: 'markdown-table', kind: 'internship', status: 'active', added: '2026-01-01', last_push: TODAY, last_unique: TODAY, failed_parses: 0, ...o };
}

export function scratch({ portals = PORTALS_BEFORE, registry = REGISTRY_BEFORE, answers = ANSWERS, presets = ['software-cs'], cycle = true, sources = true, rows = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'research-'));
  const data = join(root, 'data');
  mkdirSync(join(root, 'config'), { recursive: true });
  mkdirSync(data, { recursive: true });
  writeFileSync(join(root, 'config', 'student.yml'), `timezone: America/Chicago\npresets: [${presets.join(', ')}]\nlocations: [Remote]\n`);
  if (cycle) writeFileSync(join(data, 'student-cycle.json'), `${JSON.stringify(CYCLE, null, 2)}\n`);
  if (sources) writeFileSync(join(data, 'student-github-sources.json'), `${JSON.stringify(registry, null, 2)}\n`);
  writeFileSync(join(data, 'interview-answers.json'), `${JSON.stringify(answers, null, 2)}\n`);
  writeFileSync(join(root, 'portals.yml'), portals);
  if (rows) writeFileSync(join(data, 'student-rows.tsv'), `url\tcompany\ttitle\n${rows.map((u) => `${u}\tKnown Co\tKnown Role`).join('\n')}\n`);
  return {
    root,
    data,
    portals: () => readFileSync(join(root, 'portals.yml'), 'utf8'),
    registry: () => JSON.parse(readFileSync(join(data, 'student-github-sources.json'), 'utf8')),
    registryText: () => readFileSync(join(data, 'student-github-sources.json'), 'utf8'),
    writeCandidates: (obj, name = 'research-candidates.json') => {
      const file = join(data, name);
      writeFileSync(file, typeof obj === 'string' ? obj : JSON.stringify(obj));
      return file;
    },
    researchFiles: () => readdirSync(data).filter((f) => /^research-\d{4}-\d{2}-\d{2}\.json$/.test(f)),
    files: () => readdirSync(data).sort(),
    exists: (rel) => existsSync(join(root, rel)),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

// Fake fetch keyed by URL. routes: [[predicate(url) -> bool, body | (url) -> Response]]. Unmatched URLs answer 404, so a
// host with no robots route has no rules. Every requested URL is recorded.
export function fakeFetch(routes = []) {
  const calls = [];
  async function fetch(input) {
    const url = String(input?.url ?? input);
    calls.push(url);
    for (const [match, answer] of routes) {
      if (!match(url)) continue;
      const res = typeof answer === 'function' ? await answer(url) : answer;
      return res instanceof Response ? res : new Response(String(res), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }
  return { fetch, calls };
}

export const route = (re, answer) => [(u) => re.test(u), answer];
export const robots = (host, text, status = 200) => route(new RegExp(`^https://${host.replace(/\./g, '\\.')}/robots\\.txt$`), () => new Response(text, { status }));

// Fake upstream: auditPortals(args) reads the temp yml named after --file at call time and answers like upstream
// audit-portals.mjs 1.39.0 --json: an indented JSON array of { name, provider, careers_url, verdict, count, detail,
// samples }. statuses maps a board name to its verdict (default ok); an ok board has 12 postings, any other 0.
export function fakeUpstream(statuses = {}) {
  const calls = [];
  return {
    calls,
    auditPortals: (args = []) => {
      const file = args[args.indexOf('--file') + 1];
      const entries = yaml.load(readFileSync(file, 'utf8'))?.tracked_companies ?? [];
      calls.push({ args, names: entries.map((c) => c.name) });
      const rows = entries.map((c) => {
        const verdict = statuses[c.name] ?? 'ok';
        return { name: c.name, provider: 'greenhouse', careers_url: c.careers_url, verdict, count: verdict === 'ok' ? 12 : 0, detail: verdict === 'ok' ? '12 postings' : verdict, samples: [] };
      });
      return JSON.stringify(rows, null, 2) + '\n';
    },
  };
}

export function sleeper() {
  const calls = [];
  return { sleep: async (ms) => void calls.push(ms), calls };
}

const rowLine = (title, url) => `| [Example Co](https://example.com/co) | ${title} | Remote | [Apply](${url}) | 2026-10-20 |`;

// A markdown-table list file holding rows[i] = [title, url].
export function mdList(rows) {
  return ['| Company | Role | Location | Application | Date Posted |', '| --- | --- | --- | --- | --- |', ...rows.map(([t, u]) => rowLine(t, u))].join('\n') + '\n';
}

// n unique rows whose titles are `${word} Intern N - Summer 2027`.
export const uniqueRows = (n, word, tag) => Array.from({ length: n }, (_, i) => [`${word} Intern ${i + 1} - Summer 2027`, `https://boards.greenhouse.io/${tag}/jobs/${1000 + i}`]);

export const rawRoute = (repoName, body) => route(new RegExp(`^https://raw\\.githubusercontent\\.com/example-org/${repoName}/`), () => new Response(body, { status: 200 }));

// Runs main(argv, deps) in-process with console output captured. A thrown error counts as exit 1 (a UsageError as 2),
// the way node exits on an uncaught rejection; the message is added to stderr.
export async function runMain(s, args, deps = {}) {
  const out = [];
  const err = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  let code;
  try {
    code = await main(['--root', s.root, '--data-dir', s.data, '--today', TODAY, ...args], deps);
  } catch (e) {
    err.push(String(e?.message ?? e));
    code = e?.name === 'UsageError' ? 2 : 1;
  } finally {
    console.log = log;
    console.error = error;
  }
  return { code, out, err, text: out.join('\n'), errText: err.join('\n') };
}

// A fetch that fails the test run if it is ever used.
export const neverFetch = () => {
  throw new Error('no request expected');
};
