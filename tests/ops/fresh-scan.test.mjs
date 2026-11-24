// scripts/fresh-scan.mjs: the hourly zero-token scan of Greenhouse, Lever and Ashby boards named in portals.yml, and the
// one LinkedIn past-hour page read through a fake `chrome.mjs read --links` output. No network, no browser, no agent:
// board API answers come from a fake fetch (also installed as globalThis.fetch for the test so nothing reaches the
// network), and every child process goes through a fake runner that answers chrome.mjs read with the fixture text and
// budget.mjs check with exit 0. Fake companies and LinkedIn job ids only.
// deps used here (ruling): { fetchFn, robots, sleep, runner }. fetchFn(url, init) is fetch-shaped and returns a Response;
// robots is a { check } robots checker; runner(cmd, args, opts) runs child processes (chrome.mjs, budget.mjs) and returns
// stdout or throws like execFileSync. The digest is any file under data/digest/; rows land in data/pipeline.md.
// LinkedIn card shape in the read output (ruling): a numbered /jobs/view/ link ref carries the title and the next
// /company/ link ref carries the company.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { resolvePaths } from '../../lib/paths.mjs';
import { makeRoot, pipelineText, line, rowsOf } from '../helpers/script-harness.mjs';

const TODAY = '2026-11-04';
const PORTALS = [
  'tracked_companies:',
  '  - name: Example Robotics',
  '    careers_url: https://boards.greenhouse.io/examplerobotics',
  '    enabled: true',
  '  - name: Sample Labs',
  '    careers_url: https://jobs.lever.co/samplelabs',
  '    enabled: true',
  '  - name: Demo Works',
  '    careers_url: https://jobs.ashbyhq.com/demoworks',
  '    enabled: true',
  '  - name: Example Analytics',
  '    careers_url: https://careers.example.com/analytics',
  '    enabled: true',
  '',
].join('\n');

const GH = (n) => `https://boards.greenhouse.io/examplerobotics/jobs/${n}`;
const LV = (id) => `https://jobs.lever.co/samplelabs/${id}`;
const AB = (id) => `https://jobs.ashbyhq.com/demoworks/${id}`;
const greenhouse = (jobs) => ({ jobs: jobs.map(([id, title]) => ({ id, title, absolute_url: GH(id), location: { name: 'Remote' }, updated_at: `${TODAY}T09:00:00-05:00` })) });
const lever = (jobs) => jobs.map(([id, title]) => ({ id, text: title, hostedUrl: LV(id), categories: { location: 'Austin, TX' }, createdAt: Date.parse(`${TODAY}T14:00:00Z`) }));
const ashby = (jobs) => ({ jobs: jobs.map(([id, title]) => ({ id, title, jobUrl: AB(id), location: 'Remote', isListed: true, publishedAt: `${TODAY}T15:00:00Z` })) });

const BOARD_URLS = {
  greenhouse: 'https://boards-api.greenhouse.io/v1/boards/examplerobotics/jobs',
  lever: 'https://api.lever.co/v0/postings/samplelabs',
  ashby: 'https://api.ashbyhq.com/posting-api/job-board/demoworks',
};

// answers: { greenhouse, lever, ashby } bodies, or an Error to make that board fail.
function fakeFetch(answers) {
  const seen = [];
  const fn = async (input) => {
    const url = String(input?.url ?? input);
    seen.push(url);
    if (/\/robots\.txt$/.test(new URL(url).pathname)) return new Response('', { status: 404 });
    for (const [kind, prefix] of Object.entries(BOARD_URLS)) {
      if (!url.startsWith(prefix)) continue;
      const a = answers[kind];
      if (a instanceof Error) throw a;
      return new Response(JSON.stringify(a), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  };
  return { fn, seen };
}

const LI = (id) => `https://www.linkedin.com/jobs/view/${id}/`;
const liPage = (cards) =>
  [
    'Software engineering intern jobs in United States',
    'Past hour',
    `${cards.length} results`,
    '',
    ...cards.flatMap(([id, title, company, slug], i) => [`[${i * 2 + 1}] ${title} -> ${LI(id)}`, `[${i * 2 + 2}] ${company} -> https://www.linkedin.com/company/${slug}/`]),
    `[${cards.length * 2 + 1}] Jobs -> https://www.linkedin.com/jobs/`,
    `[${cards.length * 2 + 2}] Help Center -> https://www.linkedin.com/help/`,
  ].join('\n');

function fakeRunner({ page = '' } = {}) {
  const calls = [];
  const runner = (cmd, args = [], opts = {}) => {
    const script = cmd === process.execPath ? basename(String(args[0] ?? '')) : basename(String(cmd));
    calls.push({ cmd, args, opts, script });
    if (script === 'chrome.mjs' && args.includes('read')) return page;
    if (script === 'budget.mjs') return 'ok';
    if (script === 'chrome.mjs') return '';
    throw new Error(`unexpected child process in test: ${cmd} ${args.join(' ')}`);
  };
  return { runner, calls };
}

const allowAll = { check: async () => ({ allowed: true, reason: '', crawlDelay: null }) };
const agentCalls = (calls) => calls.filter((c) => /claude|codex/i.test(basename(String(c.cmd))));
const digestText = (r) => (existsSync(join(r.data, 'digest')) ? readdirSync(join(r.data, 'digest')).map((f) => readFileSync(join(r.data, 'digest', f), 'utf8')).join('\n') : '');
const pendingUrls = (r) => rowsOf(r.read('data/pipeline.md'), 'Pending').map((x) => x.url);
const anyUrls = (r) => ['Pending', 'Flagged', 'Skipped', 'Processed'].flatMap((s) => rowsOf(r.read('data/pipeline.md'), s).map((x) => x.url));

// Ledger rows written by the scan carry zero tokens (data/usage-ledger.tsv; columns input cache_read cache_write output).
function nonZeroLedgerRows(r) {
  if (!r.exists('data/usage-ledger.tsv')) return [];
  const [head, ...rows] = r.read('data/usage-ledger.tsv').split('\n').filter((l) => l.trim());
  const keys = head.split('\t');
  return rows.filter((l) => {
    const c = Object.fromEntries(keys.map((k, i) => [k, l.split('\t')[i]]));
    return ['input', 'cache_read', 'cache_write', 'output'].some((k) => Number(c[k] ?? 0) !== 0);
  });
}

async function withScan({ config = '', pipeline = pipelineText() } = {}, fn) {
  const r = makeRoot({ config });
  r.write('portals.yml', PORTALS);
  r.write('data/pipeline.md', pipeline);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    throw new Error(`network blocked in test: ${String(input?.url ?? input)}`);
  };
  try {
    const { freshScan } = await import('../../scripts/fresh-scan.mjs');
    const scan = async ({ answers = {}, page = '', linkedinOnly = false } = {}) => {
      const f = fakeFetch(answers);
      globalThis.fetch = f.fn;
      const run = fakeRunner({ page });
      const paths = resolvePaths({ root: r.root, dataDir: r.data });
      await freshScan({ paths, today: TODAY, deps: { fetchFn: f.fn, robots: allowAll, sleep: async () => {}, runner: run.runner }, linkedinOnly });
      return { fetched: f.seen, calls: run.calls };
    };
    await fn(r, scan);
  } finally {
    globalThis.fetch = realFetch;
    r.cleanup();
  }
}

// Drops the given urls from data/pipeline.md, as if the student handled and cleared those rows.
function dropRows(r, urls) {
  const text = r.read('data/pipeline.md');
  r.write('data/pipeline.md', text.split('\n').filter((l) => !urls.some((u) => l.includes(u))).join('\n'));
}

// M-003-S2-osdr
test('M-003-S2-osdr fresh-scan adds only Greenhouse Lever and Ashby rows new since the last run with zero agent calls', () =>
  withScan({}, async (r, scan) => {
    const first = await scan({
      answers: {
        greenhouse: greenhouse([[1001, 'Software Engineering Intern']]),
        lever: lever([['a1b2c3d4-0000-4000-8000-000000000001', 'Data Engineering Intern']]),
        ashby: ashby([['e5f6a7b8-0000-4000-8000-000000000001', 'Backend Engineering Intern']]),
      },
    });
    assert.deepEqual(pendingUrls(r).sort(), [GH(1001), LV('a1b2c3d4-0000-4000-8000-000000000001'), AB('e5f6a7b8-0000-4000-8000-000000000001')].sort());
    assert.ok(r.exists('data/fresh-seen.tsv'), 'the seen file is written');
    assert.ok(!first.fetched.some((u) => /careers\.example\.com/.test(u)), 'a company without a known ATS host is not fetched');

    // The student clears the first rows; a second run sees them again on the boards next to one new posting each.
    dropRows(r, [GH(1001), LV('a1b2c3d4-0000-4000-8000-000000000001'), AB('e5f6a7b8-0000-4000-8000-000000000001')]);
    const second = await scan({
      answers: {
        greenhouse: greenhouse([[1001, 'Software Engineering Intern'], [1002, 'Firmware Engineering Intern']]),
        lever: lever([['a1b2c3d4-0000-4000-8000-000000000001', 'Data Engineering Intern'], ['a1b2c3d4-0000-4000-8000-000000000002', 'Data Science Intern']]),
        ashby: ashby([['e5f6a7b8-0000-4000-8000-000000000001', 'Backend Engineering Intern']]),
      },
    });
    assert.deepEqual(pendingUrls(r).sort(), [GH(1002), LV('a1b2c3d4-0000-4000-8000-000000000002')].sort(), 'only rows absent from data/fresh-seen.tsv are added');
    for (const run of [first, second]) {
      assert.deepEqual(agentCalls(run.calls), [], 'no agent is started');
      assert.ok(!run.calls.some((c) => c.script === 'chrome.mjs'), 'no LinkedIn read without chrome_in_schedule');
    }
    assert.deepEqual(nonZeroLedgerRows(r), [], 'every ledger row is zero-token');
  }));

// M-003-S8-osdr
test('M-003-S8-osdr a board fetch failure is named in the digest notes and the other boards still scan', () =>
  withScan({}, async (r, scan) => {
    const run = await scan({
      answers: {
        greenhouse: greenhouse([[2001, 'Software Engineering Intern']]),
        lever: new Error('connect ECONNREFUSED'),
        ashby: ashby([['e5f6a7b8-0000-4000-8000-000000000009', 'Backend Engineering Intern']]),
      },
    });
    assert.deepEqual(pendingUrls(r).sort(), [GH(2001), AB('e5f6a7b8-0000-4000-8000-000000000009')].sort());
    const digest = digestText(r);
    const failLine = digest.split('\n').find((l) => /Sample Labs|samplelabs/i.test(l));
    assert.ok(failLine, `the failed board is named in the digest:\n${digest}`);
    assert.deepEqual(agentCalls(run.calls), []);
  }));

// M-003-S13-osdr
test('M-003-S13-osdr fresh-scan takes the job cards from a fake chrome.mjs read --links output and adds only new LinkedIn rows with a fresh LinkedIn page digest line and zero agent calls', async () => {
  const { linkedinJobs } = await import('../../scripts/fresh-scan.mjs');
  const page = liPage([
    [4100000001, 'Software Engineering Intern', 'Example Robotics', 'example-robotics'],
    [4100000002, 'Data Engineering Intern', 'Sample Labs', 'sample-labs'],
  ]);
  const jobs = linkedinJobs(page);
  assert.deepEqual(
    jobs.map((j) => ({ url: j.url, company: j.company, title: j.title })),
    [
      { url: LI(4100000001), company: 'Example Robotics', title: 'Software Engineering Intern' },
      { url: LI(4100000002), company: 'Sample Labs', title: 'Data Engineering Intern' },
    ],
  );

  await withScan({}, async (r, scan) => {
    const run = await scan({ page, linkedinOnly: true });
    const pend = rowsOf(r.read('data/pipeline.md'), 'Pending');
    assert.deepEqual(pend.map((x) => x.url).sort(), [LI(4100000001), LI(4100000002)].sort());
    for (const row of pend) assert.equal(row.notes.get('src'), 'fresh-linkedin');
    assert.match(digestText(r), /fresh LinkedIn page:/);
    const budgetAt = run.calls.findIndex((c) => c.script === 'budget.mjs' && c.args.includes('check') && c.args.includes('linkedin.fresh_search'));
    const readAt = run.calls.findIndex((c) => c.script === 'chrome.mjs' && c.args.includes('read') && c.args.includes('--links'));
    assert.ok(budgetAt >= 0, 'budget.mjs check linkedin.fresh_search runs');
    assert.ok(readAt > budgetAt, 'the page is read with --links only after the budget check');
    assert.equal(run.calls.filter((c) => c.script === 'chrome.mjs' && c.args.includes('read')).length, 1, 'one page read');
    assert.equal(run.fetched.length, 0, 'the --linkedin run reads no boards');
    assert.deepEqual(agentCalls(run.calls), []);
    assert.deepEqual(nonZeroLedgerRows(r), []);
  });
});

// M-003-S14-osdr
test('M-003-S14-osdr a LinkedIn job card already in data/fresh-seen.tsv or the pipeline is not added again', () =>
  withScan(
    { pipeline: pipelineText({ processed: [line(LI(4200000001), 'Example Robotics', 'Software Engineering Intern', 'Remote', 'src=linkedin')] }) },
    async (r, scan) => {
      await scan({ page: liPage([[4200000002, 'Data Engineering Intern', 'Sample Labs', 'sample-labs']]), linkedinOnly: true });
      assert.deepEqual(pendingUrls(r), [LI(4200000002)]);
      dropRows(r, [LI(4200000002)]);

      await scan({
        page: liPage([
          [4200000001, 'Software Engineering Intern', 'Example Robotics', 'example-robotics'],
          [4200000002, 'Data Engineering Intern', 'Sample Labs', 'sample-labs'],
          [4200000003, 'Backend Engineering Intern', 'Demo Works', 'demo-works'],
        ]),
        linkedinOnly: true,
      });
      assert.deepEqual(pendingUrls(r), [LI(4200000003)], 'only the card in neither the seen file nor the pipeline is added');
      assert.equal(anyUrls(r).filter((u) => u === LI(4200000001)).length, 1, 'the pipeline card is not duplicated');
    },
  ));

// Classic search (/jobs/search/?...&skipRedirect=true) card shape from a live read: the title anchor's innerText is the
// visible title, a hidden copy and a "with verification" badge, and the company is a plain span with no /company/ link.
const CLASSIC_PAGE = [
  'software engineer intern in United States',
  '3 results',
  'Data Analyst Intern',
  'Data Analyst Intern with verification',
  'Example Robotics',
  'Austin, TX (On-site)',
  'Viewed',
  'Software Developer',
  'Software Developer',
  'Sample Labs',
  'Boone, NC (On-site)',
  'Easy Apply',
  'ML Intern',
  'ML Intern with verification',
  'https://example.com/not-a-company',
  '',
];

test('fresh-scan linkedinJobs on a classic search read cleans doubled titles and the verification badge and takes the company from the page text', async () => {
  const { linkedinJobs } = await import('../../scripts/fresh-scan.mjs');
  const jobs = linkedinJobs([
    ...CLASSIC_PAGE,
    '[1] Data Analyst Intern Data Analyst Intern with verification -> https://www.linkedin.com/jobs/view/4434210024/?eBP=x',
    '[2] Software Developer Software Developer -> https://www.linkedin.com/jobs/view/4484369864/',
    '[3] ML Intern ML Intern With Verification -> https://www.linkedin.com/jobs/view/4459777883/',
    '[4] Quant Intern -> https://www.linkedin.com/jobs/view/4490435027/',
  ].join('\n'));
  assert.deepEqual(
    jobs.map((j) => ({ url: j.url, title: j.title, company: j.company })),
    [
      { url: LI(4434210024), title: 'Data Analyst Intern', company: 'Example Robotics' },
      { url: LI(4484369864), title: 'Software Developer', company: 'Sample Labs' },
      { url: LI(4459777883), title: 'ML Intern', company: 'unknown' },
      { url: LI(4490435027), title: 'Quant Intern', company: 'unknown' },
    ],
  );
});

test('fresh-scan linkedinJobs keeps a /company/ link over the page text and leaves a plain title unchanged', async () => {
  const { linkedinJobs } = await import('../../scripts/fresh-scan.mjs');
  const jobs = linkedinJobs([
    ...CLASSIC_PAGE,
    '[1] Data Analyst Intern -> https://www.linkedin.com/jobs/view/4466964573/',
    '[2] Demo Health -> https://www.linkedin.com/company/demo-health/',
    '[3] Data Data Analyst -> https://www.linkedin.com/jobs/view/4486804846/',
  ].join('\n'));
  assert.deepEqual(
    jobs.map((j) => ({ title: j.title, company: j.company })),
    [
      { title: 'Data Analyst Intern', company: 'Demo Health' },
      { title: 'Data Data Analyst', company: 'unknown' },
    ],
  );
});

test('fresh-scan linkedinJobs resolves a classic card title cut to 60 characters by linkRefs from the page text, cut inside the first copy or inside the hidden copy', async () => {
  const { linkedinJobs } = await import('../../scripts/fresh-scan.mjs');
  const LONG = 'Machine Learning Engineer Intern (Knowledge Graph) - 2027 Start (PhD)';
  const MID = 'Electric Vehicle Charging Data Analysis Intern';
  const cut = (title) => `${title} ${title} with verification`.slice(0, 60).trim();
  assert.ok(LONG.startsWith(cut(LONG)) && cut(LONG).length < LONG.length, 'the cut falls inside the first copy');
  assert.ok(cut(MID).startsWith(`${MID} `) && cut(MID).length > MID.length, 'the cut falls inside the hidden copy');
  const page = [
    'software engineer intern in United States',
    LONG,
    `${LONG} with verification`,
    'Example Robotics',
    'San Jose, CA',
    MID,
    `${MID} with verification`,
    'Sample Labs',
    'Idaho Falls, ID (On-site)',
    '',
  ];
  const jobs = linkedinJobs([
    ...page,
    `[1] ${cut(LONG)} -> https://www.linkedin.com/jobs/view/4434210024/`,
    `[2] ${cut(MID)} -> https://www.linkedin.com/jobs/view/4466964573/`,
  ].join('\n'));
  assert.deepEqual(
    jobs.map((j) => ({ url: j.url, title: j.title, company: j.company })),
    [
      { url: LI(4434210024), title: LONG, company: 'Example Robotics' },
      { url: LI(4466964573), title: MID, company: 'Sample Labs' },
    ],
  );
});
