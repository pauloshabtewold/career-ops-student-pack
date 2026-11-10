// scripts/research-sources.mjs, driven through main(argv, { fetch, sleep, now, upstream, preset }) with every network
// and upstream call faked (tests/helpers/research-harness.mjs). Output lines asserted are the ones the spec names:
// 'research: added N boards, M GitHub lists', 'added: ...', 'skipped: <name>: <reason>' and 'cost: ...'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as yaml from 'js-yaml';
import * as H from '../helpers/research-harness.mjs';

const BOARD = (name, careers_url) => ({ name, careers_url });
const cands = (o = {}) => ({ web_searches: 0, boards: [], github_lists: [], ...o });

// Writes the candidates file, runs main and returns the captured run plus the fakes it used.
async function go(s, candidates, { routes = [], statuses = {}, preset = H.PRESET, args = [], nowFor } = {}) {
  s.writeCandidates(candidates);
  const f = H.fakeFetch(routes);
  const up = H.fakeUpstream(statuses);
  const sl = H.sleeper();
  const r = await H.runMain(s, ['--no-search', ...args], { fetch: f.fetch, sleep: sl.sleep, upstream: up, preset, ...(nowFor ? { now: nowFor(f) } : {}) });
  return { ...r, f, up, sl };
}

const hasLine = (r, re) => r.out.some((l) => re.test(l));
const RESEARCH_BLOCK = /\n[ \t]*# student-pack:start research_companies[\s\S]*?# student-pack:end research_companies/;
const tracked = (s) => yaml.load(s.portals()).tracked_companies ?? [];

// M-001-S4-cdel
test('M-001-S4-cdel a Greenhouse board that robots allows and audit rates ok is written into the research_companies block and the summary', async () => {
  const s = H.scratch();
  try {
    const r = await go(s, cands({ web_searches: 2, boards: [BOARD('Fresh Board', 'https://job-boards.greenhouse.io/freshboard')] }));
    assert.equal(r.code, 0, r.errText);
    assert.ok(hasLine(r, /^research: added 1 boards, 0 GitHub lists$/), r.text);
    assert.ok(hasLine(r, /^added: .*Fresh Board/), r.text);
    assert.ok(hasLine(r, /^cost: \d+ requests, [\d.]+ s, 2 web searches in this chat; no model call in this script$/), r.text);
    const text = s.portals();
    assert.match(text, /# student-pack:start research_companies/);
    assert.match(text, /# student-pack:end research_companies/);
    const entry = tracked(s).find((c) => c.name === 'Fresh Board');
    assert.ok(entry, 'Fresh Board is a tracked company');
    assert.match(entry.careers_url, /freshboard/);
    assert.equal(r.up.calls.length, 1, 'one audit-portals call for all survivors');
    assert.deepEqual(r.up.calls[0].names, ['Fresh Board']);
    const files = s.researchFiles();
    assert.deepEqual(files, ['research-2026-10-27.json']);
  } finally {
    s.cleanup();
  }
});

// M-001-S4-cdel
test('M-001-S4-cdel Greenhouse, Lever and Ashby boards pass with ok or small, each after a robots check of its API host', async () => {
  const s = H.scratch();
  try {
    const r = await go(
      s,
      cands({ boards: [BOARD('Gh Board', 'https://boards.greenhouse.io/ghboard'), BOARD('Lv Board', 'https://jobs.lever.co/lvboard'), BOARD('Ab Board', 'https://jobs.ashbyhq.com/abboard')] }),
      { statuses: { 'Ab Board': 'small' } },
    );
    assert.ok(hasLine(r, /^research: added 3 boards, 0 GitHub lists$/), r.text);
    assert.deepEqual(tracked(s).map((c) => c.name).filter((n) => /Board$/.test(n)).sort(), ['Ab Board', 'Gh Board', 'Lv Board']);
    for (const host of ['boards-api.greenhouse.io', 'api.lever.co', 'api.ashbyhq.com']) assert.ok(r.f.calls.includes(`https://${host}/robots.txt`), `robots.txt of ${host} requested`);
    assert.equal(r.up.calls.length, 1);
  } finally {
    s.cleanup();
  }
});

// M-001-S5-cdel
test('M-001-S5-cdel a GitHub list with 5 unique eligible rows is added as a trial with notes research and one with 4 is skipped naming the count', async () => {
  const s = H.scratch();
  try {
    const five = H.uniqueRows(5, 'Software', 'five');
    const four = [...H.uniqueRows(4, 'Software', 'four'), ['Senior Software Engineer Intern - Summer 2027', 'https://boards.greenhouse.io/four/jobs/9'], ['Staff Engineer Intern - Summer 2027', 'https://boards.greenhouse.io/four/jobs/8']];
    const dupes = [...H.uniqueRows(3, 'Software', 'dupes'), ...H.uniqueRows(3, 'Software', 'dupes')];
    const r = await go(
      s,
      cands({ github_lists: [{ repo: 'example-org/list-five', path: 'README.md', kind: 'internship' }, { repo: 'example-org/list-four', path: 'README.md', kind: 'internship' }, { repo: 'example-org/list-dupes', path: 'README.md', kind: 'internship' }] }),
      { routes: [H.rawRoute('list-five', H.mdList(five)), H.rawRoute('list-four', H.mdList(four)), H.rawRoute('list-dupes', H.mdList(dupes))] },
    );
    assert.equal(r.code, 0, r.errText);
    assert.ok(hasLine(r, /^research: added 0 boards, 1 GitHub lists$/), r.text);
    assert.ok(hasLine(r, /^added: .*list-five/), r.text);
    assert.ok(hasLine(r, /^skipped: .*list-four.*: 4 matching rows, needs 5$/), r.text);
    assert.ok(hasLine(r, /^skipped: .*list-dupes.*: 3 matching rows, needs 5$/), r.text);
    const { sources } = s.registry();
    assert.equal(sources.length, 1);
    assert.deepEqual(
      { repo: sources[0].repo, branch: sources[0].branch, path: sources[0].path, format: sources[0].format, kind: sources[0].kind, status: sources[0].status, notes: sources[0].notes, added: sources[0].added, failed_parses: sources[0].failed_parses },
      { repo: 'example-org/list-five', branch: 'HEAD', path: 'README.md', format: 'markdown-table', kind: 'internship', status: 'trial', notes: 'research', added: '2026-10-27', failed_parses: 0 },
    );
  } finally {
    s.cleanup();
  }
});

// M-001-S5-cdel
test('M-001-S5-cdel rows already in data/student-rows.tsv are not counted as new', async () => {
  const five = H.uniqueRows(5, 'Software', 'known');
  const s = H.scratch({ rows: [five[0][1], five[1][1]] });
  try {
    const r = await go(s, cands({ github_lists: [{ repo: 'example-org/list-known', path: 'README.md', kind: 'internship' }] }), { routes: [H.rawRoute('list-known', H.mdList(five))] });
    assert.ok(hasLine(r, /^skipped: .*list-known.*: 3 matching rows, needs 5$/), r.text);
    assert.deepEqual(s.registry().sources, []);
  } finally {
    s.cleanup();
  }
});

// M-001-S6-cdel
test('M-001-S6-cdel with no include title rules a list row counts only when its title holds a word of an archetype', async () => {
  const s = H.scratch({ presets: ['byo-employer-list'] });
  try {
    const mixedA = [...H.uniqueRows(5, 'Brand', 'la1'), ...H.uniqueRows(3, 'Welder', 'la2')];
    const mixedB = [...H.uniqueRows(3, 'Brand', 'lb1'), ...H.uniqueRows(4, 'Welder', 'lb2')];
    const r = await go(
      s,
      cands({ github_lists: [{ repo: 'example-org/list-a', path: 'README.md', kind: 'internship' }, { repo: 'example-org/list-b', path: 'README.md', kind: 'internship' }] }),
      { preset: H.BYO_PRESET, routes: [H.rawRoute('list-a', H.mdList(mixedA)), H.rawRoute('list-b', H.mdList(mixedB))] },
    );
    assert.equal(r.code, 0, r.errText);
    assert.ok(hasLine(r, /^added: .*list-a/), r.text);
    assert.ok(hasLine(r, /^skipped: .*list-b.*: 3 matching rows, needs 5$/), `7 rows but only 3 hold an archetype word\n${r.text}`);
    assert.deepEqual(s.registry().sources.map((x) => x.repo), ['example-org/list-a']);
  } finally {
    s.cleanup();
  }
});

// M-001-S7-cdel
test('M-001-S7-cdel candidates matching a preset seed, a target employer or a portals.yml entry are skipped as already in your list', async () => {
  const preset = { ...H.PRESET, seed_employers: [{ name: 'Seed Robotics', careers_url: 'https://boards.greenhouse.io/seedrobotics' }] };
  const s = H.scratch();
  try {
    const r = await go(
      s,
      cands({
        boards: [
          BOARD('Seed Robotics Holdings', 'https://job-boards.greenhouse.io/seedrobotics'),
          BOARD('Target Employer Co', 'https://jobs.lever.co/targetlever'),
          BOARD('Whatever Name', 'https://jobs.lever.co/mineco'),
          BOARD('MINE CO', 'https://jobs.ashbyhq.com/otherslug'),
          BOARD('Other Name Entirely', 'https://boards.greenhouse.io/mineseed'),
          BOARD('Brand New Board', 'https://jobs.ashbyhq.com/brandnew'),
        ],
      }),
      { preset },
    );
    for (const name of ['Seed Robotics Holdings', 'Target Employer Co', 'Whatever Name', 'MINE CO', 'Other Name Entirely']) {
      assert.ok(r.out.includes(`skipped: ${name}: already in your list`), `${name}\n${r.text}`);
    }
    assert.ok(hasLine(r, /^research: added 1 boards, 0 GitHub lists$/), r.text);
    assert.deepEqual(r.up.calls[0].names, ['Brand New Board']);
  } finally {
    s.cleanup();
  }
});

// M-001-S7-cdel
test('M-001-S7-cdel a second run skips what the first run added and writes portals.yml unchanged', async () => {
  const s = H.scratch();
  try {
    const candidates = cands({ boards: [BOARD('Brand New Board', 'https://jobs.ashbyhq.com/brandnew')] });
    await go(s, candidates);
    const afterFirst = s.portals();
    const second = await go(s, candidates);
    assert.ok(second.out.includes('skipped: Brand New Board: already in your list'), second.text);
    assert.equal(s.portals(), afterFirst);
    assert.equal(tracked(s).filter((c) => c.name === 'Brand New Board').length, 1);
  } finally {
    s.cleanup();
  }
});

// M-001-S8-cdel
test('M-001-S8-cdel a Workday or unknown host is skipped as no supported public board and is never requested', async () => {
  const s = H.scratch();
  try {
    const r = await go(s, cands({ boards: [BOARD('Workday Co', 'https://example.wd1.myworkdayjobs.com/en-US/careers'), BOARD('Unknown Host Co', 'https://careers.example.com/jobs')] }));
    assert.ok(r.out.includes('skipped: Workday Co: no supported public board, check by hand'), r.text);
    assert.ok(r.out.includes('skipped: Unknown Host Co: no supported public board, check by hand'), r.text);
    assert.deepEqual(r.f.calls.filter((u) => /myworkdayjobs|careers\.example\.com/.test(u)), []);
  } finally {
    s.cleanup();
  }
});

// M-001-S8-cdel
test('M-001-S8-cdel a robots-disallowed board and audit empty, error and no-provider boards are skipped naming the reason', async () => {
  const s = H.scratch();
  try {
    const r = await go(
      s,
      cands({
        boards: [
          BOARD('Blocked Co', 'https://jobs.lever.co/blockedco'),
          BOARD('Error Co', 'https://jobs.ashbyhq.com/errorco'),
          BOARD('Empty Co', 'https://boards.greenhouse.io/emptyco'),
          BOARD('No Provider Co', 'https://jobs.lever.co/noprovco'),
          BOARD('Good Co', 'https://jobs.ashbyhq.com/goodco'),
        ],
      }),
      { routes: [H.robots('api.lever.co', 'User-agent: *\nDisallow: /v0/postings/blockedco\n')], statuses: { 'Error Co': 'error', 'Empty Co': 'empty', 'No Provider Co': 'no-provider' } },
    );
    assert.ok(hasLine(r, /^skipped: Blocked Co: .*robots/i), r.text);
    assert.ok(r.out.includes('skipped: Error Co: audit: error'), r.text);
    assert.ok(r.out.includes('skipped: Empty Co: audit: empty'), r.text);
    assert.ok(r.out.includes('skipped: No Provider Co: audit: no-provider'), r.text);
    assert.ok(hasLine(r, /^added: .*Good Co/), r.text);
    assert.equal(r.up.calls.length, 1);
    assert.deepEqual([...r.up.calls[0].names].sort(), ['Empty Co', 'Error Co', 'Good Co', 'No Provider Co'], 'the robots-disallowed board never reaches audit');
  } finally {
    s.cleanup();
  }
});

// M-001-S9-cdel
test('M-001-S9-cdel boards past the 20-board cap are skipped as cap reached', async () => {
  const s = H.scratch();
  try {
    const boards = Array.from({ length: 21 }, (_, i) => BOARD(`Cap${i + 1} Robotics`, `https://boards.greenhouse.io/capboard${i + 1}`));
    const r = await go(s, cands({ boards }));
    assert.ok(hasLine(r, /^research: added 20 boards, 0 GitHub lists$/), r.text);
    assert.ok(r.out.includes('skipped: Cap21 Robotics: cap reached'), r.text);
  } finally {
    s.cleanup();
  }
});

// M-001-S9-cdel
test('M-001-S9-cdel lists past the 15-list cap are skipped as cap reached', async () => {
  const s = H.scratch();
  try {
    const github_lists = Array.from({ length: 16 }, (_, i) => ({ repo: `example-org/capl${i + 1}`, path: 'README.md', kind: 'internship' }));
    const routes = github_lists.map((l, i) => H.rawRoute(`capl${i + 1}`, H.mdList(H.uniqueRows(5, 'Software', `capl${i + 1}`))));
    const r = await go(s, cands({ github_lists }), { routes });
    assert.ok(hasLine(r, /^research: added 0 boards, 15 GitHub lists$/), r.text);
    assert.ok(hasLine(r, /^skipped: .*capl16.*: cap reached$/), r.text);
    assert.equal(s.registry().sources.length, 15);
  } finally {
    s.cleanup();
  }
});

// M-001-S9-cdel
test('M-001-S9-cdel candidates after the 5-minute deadline are skipped as time limit reached', async () => {
  const s = H.scratch();
  try {
    const github_lists = Array.from({ length: 6 }, (_, i) => ({ repo: `example-org/slow${i + 1}`, path: 'README.md', kind: 'internship' }));
    const routes = github_lists.map((l, i) => H.rawRoute(`slow${i + 1}`, H.mdList(H.uniqueRows(5, 'Software', `slow${i + 1}`))));
    // The clock moves 100 s for every request made, so the deadline passes after a few requests.
    const nowFor = (f) => () => 1_000_000 + f.calls.length * 100_000;
    const r = await go(s, cands({ github_lists }), { routes, nowFor });
    assert.ok(hasLine(r, /^added: .*slow1/), `the first list is processed before the deadline\n${r.text}`);
    assert.ok(hasLine(r, /^skipped: .*slow6.*: time limit reached$/), r.text);
  } finally {
    s.cleanup();
  }
});

// M-001-S9-cdel
test('M-001-S9-cdel no request goes to linkedin.com and a LinkedIn board is skipped as no supported public board', async () => {
  const s = H.scratch();
  try {
    const r = await go(s, cands({ boards: [BOARD('Li Co', 'https://www.linkedin.com/company/li-co/jobs'), BOARD('Fine Co', 'https://boards.greenhouse.io/fineco')] }));
    assert.ok(r.out.includes('skipped: Li Co: no supported public board, check by hand'), r.text);
    assert.deepEqual(r.f.calls.filter((u) => /linkedin\.com/i.test(u)), []);
  } finally {
    s.cleanup();
  }
});

// M-001-S10-cdel
test('M-001-S10-cdel the marked title_filter, location_filter and tracked_companies blocks and all student text stay byte-identical', async () => {
  const s = H.scratch();
  try {
    await go(s, cands({ boards: [BOARD('Fresh Board', 'https://job-boards.greenhouse.io/freshboard')] }));
    const after = s.portals();
    assert.match(after, RESEARCH_BLOCK);
    assert.equal(after.replace(RESEARCH_BLOCK, ''), H.PORTALS_BEFORE, 'removing the research block gives back the original file');
    assert.doesNotThrow(() => yaml.load(after));
  } finally {
    s.cleanup();
  }
});

// M-001-S17-cdel
test('M-001-S17-cdel a malformed or wrong-shape research-candidates.json exits 1 naming the file and its first problem and writes nothing', async () => {
  const bad = {
    'not JSON': '{not json',
    'an array': '[]',
    'an unknown key': { web_searches: 0, boards: [], github_lists: [], extra: 1 },
    'web_searches above 5': { web_searches: 6, boards: [], github_lists: [] },
    'web_searches not an integer': { web_searches: 2.5, boards: [], github_lists: [] },
    'a board with an empty name': { web_searches: 0, boards: [{ name: '', careers_url: 'https://boards.greenhouse.io/x' }], github_lists: [] },
    'a board with a non-https URL': { web_searches: 0, boards: [{ name: 'X Co', careers_url: 'http://boards.greenhouse.io/x' }], github_lists: [] },
    'a list without owner/name': { web_searches: 0, boards: [], github_lists: [{ repo: 'noslash' }] },
  };
  for (const [label, content] of Object.entries(bad)) {
    const s = H.scratch();
    try {
      s.writeCandidates(content);
      const before = { portals: s.portals(), registry: s.registryText(), files: s.files() };
      const r = await H.runMain(s, ['--no-search'], { fetch: H.neverFetch, sleep: H.sleeper().sleep, upstream: H.fakeUpstream(), preset: H.PRESET });
      assert.equal(r.code, 1, `${label}\n${r.text}${r.errText}`);
      assert.match(r.text + r.errText, /research-candidates\.json: .+; fix the file and run again/, label);
      assert.equal(s.portals(), before.portals, label);
      assert.equal(s.registryText(), before.registry, label);
      assert.deepEqual(s.files(), before.files, `${label}: no file written`);
    } finally {
      s.cleanup();
    }
  }
});

// M-001-S18-cdel
test('M-001-S18-cdel a missing data/student-cycle.json or sources registry exits 1 with run apply-answers.mjs --stage queue first and writes nothing', async () => {
  for (const missing of [{ cycle: false }, { sources: false }]) {
    const s = H.scratch(missing);
    try {
      const before = { portals: s.portals(), files: s.files() };
      const r = await H.runMain(s, ['--no-search'], { fetch: H.neverFetch, sleep: H.sleeper().sleep, upstream: H.fakeUpstream(), preset: H.PRESET });
      assert.equal(r.code, 1, JSON.stringify(missing) + r.text + r.errText);
      assert.match(r.text + r.errText, /run apply-answers\.mjs --stage queue first/);
      assert.equal(s.portals(), before.portals);
      assert.deepEqual(s.files(), before.files, 'no file written');
    } finally {
      s.cleanup();
    }
  }
});

// M-001-S19-cdel
test('M-001-S19-cdel with no data/student-rows.tsv every eligible row counts as new and the run completes', async () => {
  const s = H.scratch();
  try {
    assert.equal(s.exists('data/student-rows.tsv'), false);
    const r = await go(s, cands({ github_lists: [{ repo: 'example-org/list-fresh', path: 'README.md', kind: 'internship' }] }), { routes: [H.rawRoute('list-fresh', H.mdList(H.uniqueRows(5, 'Data', 'fresh')))] });
    assert.equal(r.code, 0, r.errText);
    assert.ok(hasLine(r, /^research: added 0 boards, 1 GitHub lists$/), r.text);
    assert.deepEqual(s.registry().sources.map((x) => x.repo), ['example-org/list-fresh']);
  } finally {
    s.cleanup();
  }
});

// M-001-S20-cdel
test('M-001-S20-cdel --dry-run prints the full summary and changes neither portals.yml nor the registry and writes no research file', async () => {
  const candidates = cands({ boards: [BOARD('Fresh Board', 'https://job-boards.greenhouse.io/freshboard')], github_lists: [{ repo: 'example-org/list-dry', path: 'README.md', kind: 'internship' }] });
  const routes = () => [H.rawRoute('list-dry', H.mdList(H.uniqueRows(5, 'Software', 'dry')))];
  const dry = H.scratch();
  const real = H.scratch();
  try {
    const before = { portals: dry.portals(), registry: dry.registryText(), files: dry.files() };
    const d = await go(dry, candidates, { routes: routes(), args: ['--dry-run'] });
    assert.equal(d.code, 0, d.errText);
    assert.ok(hasLine(d, /^research: added 1 boards, 1 GitHub lists$/), d.text);
    assert.equal(dry.portals(), before.portals);
    assert.equal(dry.registryText(), before.registry);
    assert.deepEqual(dry.researchFiles(), []);
    assert.deepEqual(dry.files().filter((f) => f !== 'research-candidates.json'), before.files);
    const r = await go(real, candidates, { routes: routes() });
    const lines = (x) => x.out.filter((l) => !l.startsWith('cost:'));
    assert.deepEqual(lines(d), lines(r), 'the dry run prints the same summary as a real run');
    assert.ok(hasLine(d, /^cost: /), d.text);
  } finally {
    dry.cleanup();
    real.cleanup();
  }
});
