// Assumed (M-002, all synthetic data, no network):
//   classifyMail(message, ctx) with an alert-sender message that carries a non-empty jobs array returns
//     { kind: 'alert', label, jobs } with each job { title, company, location, jobId, site } cleaned (whitespace squashed,
//     '|' and ';' become ',', fields cut to 200 characters, jobId kept only when it matches ^[A-Za-z0-9_-]+$), at most 25 jobs.
//     Input jobs follow the JSON contract { title, company, location, job_id, site }; fixtures here carry job_id and jobId alike.
//   runInbox(argv, deps) -> { code, counts }. With --resolve a handshake job with a numeric id stages the handshake URL;
//     any other job goes through deps.findAtEmployer(row, options) -> { url, how }. deps.fetch is the raw network fetch that
//     the robots-checked fetch wraps. Staging rows land in data/pipeline.staging.md; the summary line goes to deps.out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ALERT_DOMAINS, classifyMail } from '../../lib/mail-classify.mjs';
import { runInbox } from '../../scripts/inbox.mjs';
import * as H from '../helpers/feed-harness.mjs';

const TODAY = '2026-10-27';
const FRESH = '2026-10-26T15:00:00.000Z';
const OLD = '2026-10-22T15:00:00.000Z';
const CTX = { assessmentDomains: [], companies: [] };
const at = (user, domain) => `${user}@${domain}`;
const msg = (id, from, subject, snippet, extra = {}) => ({ id, from, subject, snippet, date: FRESH, ...extra });
const job = (o = {}) => {
  const base = { title: 'Data Engineer Intern', company: 'Tailspin Systems', location: 'Remote', job_id: '3900001234', site: 'linkedin', ...o };
  return { ...base, jobId: base.job_id };
};
const liAlert = (id, jobs, extra = {}) => msg(id, `LinkedIn Job Alerts <${at('jobalerts-noreply', 'linkedin.com')}>`, 'New jobs for you', 'New jobs for you.', { jobs, ...extra });
const hsAlert = (id, jobs) => msg(id, `Handshake <${at('no-reply', 'joinhandshake.com')}>`, 'New job match', 'New job match.', { jobs });

function setup(seen = []) {
  const root = mkdtempSync(join(tmpdir(), 'inbox-alerts-'));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\npresets: []\n');
  writeFileSync(join(root, 'data', 'applications.md'), '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n');
  if (seen.length) writeFileSync(join(root, 'data', '.student-inbox-seen'), `${seen.join('\n')}\n`);
  return { root, data: join(root, 'data'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function run(s, messages, { resolve = true, deps = {} } = {}) {
  const input = join(s.root, 'msgs.json');
  writeFileSync(input, JSON.stringify(messages));
  const lines = [];
  const lookups = [];
  // deps.findAtEmployer set to undefined means the real lookup runs against deps.fetch.
  const real = 'findAtEmployer' in deps && deps.findAtEmployer === undefined;
  const stubbed = deps.findAtEmployer ?? (async (row) => (lookups.push(row), { url: null, how: 'none' }));
  const argv = ['--backend', 'connector', '--input', input, '--root', s.root, '--data-dir', s.data, '--today', TODAY, ...(resolve ? ['--resolve'] : [])];
  const res = await runInbox(argv, { runner: async () => ({ code: 0, stdout: '' }), assessmentDomains: [], out: (l) => lines.push(String(l)), ...deps, ...(real ? {} : { findAtEmployer: stubbed }) });
  const file = join(s.data, 'pipeline.staging.md');
  let staging = '';
  try { staging = readFileSync(file, 'utf8'); } catch { /* nothing staged */ }
  return { res, lines, text: lines.join('\n'), staging, rows: staging.split('\n').filter((l) => l.startsWith('- [ ]')), lookups };
}

// M-002-S1-cdel
test('M-002-S1-cdel a handshake id becomes the handshake job URL and a LinkedIn job found at the employer becomes an employer row', async () => {
  const s = setup();
  try {
    const found = [];
    const findAtEmployer = async (row) => {
      found.push(row);
      return { url: 'https://boards.greenhouse.io/tailspinsystems/jobs/42', how: 'greenhouse' };
    };
    const hs = { title: 'Analyst Intern', company: 'Wingtip Partners', location: 'Austin, TX', job_id: '8800123', site: 'handshake' };
    const out = await run(s, [hsAlert('m-1', [{ ...hs, jobId: hs.job_id }]), liAlert('m-2', [job()])], { deps: { findAtEmployer } });
    assert.equal(out.res.code, 0);
    assert.equal(out.rows.length, 2);
    assert.ok(out.rows.includes(`- [ ] https://app.joinhandshake.com/jobs/8800123 | Wingtip Partners | Analyst Intern | Austin, TX | note: src=handshake-alert; imported=${TODAY}`), out.staging);
    assert.ok(out.rows.includes(`- [ ] https://boards.greenhouse.io/tailspinsystems/jobs/42 | Tailspin Systems | Data Engineer Intern | Remote | note: src=linkedin-alert; extid=3900001234; imported=${TODAY}`), out.staging);
    assert.equal(found.length, 1, 'the handshake job needs no employer lookup');
    assert.equal(found[0].company, 'Tailspin Systems');
    assert.equal(found[0].title, 'Data Engineer Intern');
    assert.match(out.text, /inbox: alerts staged 2 \(employer 1, handshake 1, need a link 0\)/);
    assert.ok(!/linkedin\.com/i.test(out.staging), 'no aggregator URL is stored');
  } finally {
    s.cleanup();
  }
});

// M-002-S2-cdel
test('M-002-S2-cdel simplify.jobs, indeed.com, indeedemail.com and usajobs.gov senders classify as alerts with their own label', () => {
  const cases = [
    ['alerts@simplify.jobs', 'simplify-alert'],
    ['alert@indeed.com', 'indeed-alert'],
    ['noreply@indeedemail.com', 'indeed-alert'],
    ['no-reply@usajobs.gov', 'usajobs-alert'],
  ];
  for (const [from, label] of cases) {
    const c = classifyMail(msg('c-1', from, 'New jobs', 'Jobs for you.', { jobs: [job({ site: 'other' })] }), CTX);
    assert.equal(c.kind, 'alert', from);
    assert.equal(c.label, label, from);
    assert.equal(c.jobs.length, 1, from);
  }
});

test('extra check: ALERT_DOMAINS maps the six sender domains to their labels', () => {
  assert.deepEqual({ ...ALERT_DOMAINS }, {
    'linkedin.com': 'linkedin-alert',
    'joinhandshake.com': 'handshake-alert',
    'simplify.jobs': 'simplify-alert',
    'indeed.com': 'indeed-alert',
    'indeedemail.com': 'indeed-alert',
    'usajobs.gov': 'usajobs-alert',
  });
});

test('extra check: a simplify alert job that is not found at the employer stages with src=simplify-alert', async () => {
  const s = setup();
  try {
    const out = await run(s, [msg('m-1', 'Simplify <alerts@simplify.jobs>', 'New jobs', 'New jobs.', { jobs: [job({ site: 'simplify', job_id: 'abc-123' })] })]);
    assert.equal(out.rows.length, 1);
    assert.match(out.rows[0], /^- \[ \] needs-url \|/);
    assert.match(out.rows[0], /src=simplify-alert/);
  } finally {
    s.cleanup();
  }
});

// M-002-S3-cdel
test('M-002-S3-cdel an unresolved LinkedIn job stays a needs-url row with src and extid, with or without --resolve', async () => {
  for (const resolve of [true, false]) {
    const s = setup();
    try {
      const out = await run(s, [liAlert('m-1', [job()])], { resolve });
      assert.equal(out.rows.length, 1, `resolve=${resolve}`);
      assert.match(out.rows[0], /^- \[ \] needs-url \| Tailspin Systems \| Data Engineer Intern \| Remote \|/);
      assert.match(out.rows[0], /src=linkedin-alert/);
      assert.match(out.rows[0], /extid=3900001234/);
      assert.match(out.text, /inbox: alerts staged 1 \(employer 0, handshake 0, need a link 1\)/);
      if (!resolve) assert.equal(out.lookups.length, 0, 'no lookup without --resolve');
    } finally {
      s.cleanup();
    }
  }
});

test('extra check: a message with no jobs array falls back to the subject parse', async () => {
  const s = setup();
  try {
    const m = msg('m-1', `LinkedIn Job Alerts <${at('jobalerts-noreply', 'linkedin.com')}>`, 'Data Engineer Intern at Tailspin Systems', 'Tailspin Systems is hiring. View job: https://www.linkedin.com/comm/jobs/view/3900001234?trk=alert');
    const c = classifyMail(m, CTX);
    assert.equal(c.kind, 'alert');
    const out = await run(s, [m]);
    assert.equal(out.rows.length, 1);
    assert.match(out.rows[0], /^- \[ \] needs-url \| Tailspin Systems \| Data Engineer Intern/);
    assert.ok(out.rows[0].includes('3900001234'));
  } finally {
    s.cleanup();
  }
});

test('extra check: message ids already seen and mail older than 2 days stay skipped', async () => {
  const s = setup(['m-seen']);
  try {
    const out = await run(s, [liAlert('m-seen', [job()]), liAlert('m-old', [job({ company: 'Old Co' })], { date: OLD }), liAlert('m-new', [job({ company: 'New Co' })])]);
    assert.equal(out.rows.length, 1);
    assert.ok(out.rows[0].includes('New Co'));
    assert.ok(!out.staging.includes('Old Co'));
    assert.deepEqual(out.lookups.map((l) => l.company), ['New Co']);
  } finally {
    s.cleanup();
  }
});

// M-002-S4-cdel
test('M-002-S4-cdel pipes and semicolons become commas, fields are cut to 200 characters and a bad job id is dropped', () => {
  const m = liAlert('c-1', [job({ title: 'Alpha|Beta;Gamma', company: 'C'.repeat(300), location: 'L'.repeat(250), job_id: '../x y' }), job({ title: '  Spaced   out  title ', job_id: 'ok_id-9' })]);
  const c = classifyMail(m, CTX);
  assert.equal(c.kind, 'alert');
  const [a, b] = c.jobs;
  assert.equal(a.title, 'Alpha,Beta,Gamma');
  assert.equal(a.company.length, 200);
  assert.equal(a.location.length, 200);
  assert.ok(!a.jobId, 'a job id outside ^[A-Za-z0-9_-]+$ is not kept');
  assert.equal(b.title, 'Spaced out title');
  assert.equal(b.jobId, 'ok_id-9');
  for (const j of c.jobs) for (const v of [j.title, j.company, j.location]) assert.ok(!/[|;]/.test(v));
});

test('extra check: at most 25 jobs are kept from one message', () => {
  const jobs = Array.from({ length: 30 }, (_, i) => job({ title: `Intern ${i}`, job_id: `id${i}` }));
  const c = classifyMail(liAlert('c-2', jobs), CTX);
  assert.equal(c.jobs.length, 25);
  assert.equal(c.jobs[0].title, 'Intern 0');
  assert.equal(c.jobs[24].title, 'Intern 24');
});

const robotsOf = (body) => [(u) => u.endsWith('/robots.txt'), () => H.text(body)];
const notFound = () => H.text('not found', 404);

// M-002-S20-cdel
test('M-002-S20-cdel --resolve sends no request to a board path robots.txt disallows and reads robots.txt once per host', async () => {
  const s = setup();
  try {
    const lever = 'https://jobs.lever.co/examplerobotics/x1';
    const stub = H.stubFetch([
      [(u) => u === 'https://boards-api.greenhouse.io/robots.txt', () => H.text('User-agent: *\nDisallow: /v1/boards/\n')],
      [(u) => u.startsWith('https://api.lever.co/v0/postings/examplerobotics'), () => H.json([{ id: 'x1', text: 'Data Engineer Intern', hostedUrl: lever }])],
      [(u) => u.endsWith('/robots.txt'), notFound],
    ]);
    const out = await run(s, [liAlert('m-1', [job({ company: 'Example Robotics' })])], { deps: { fetch: stub.fetch, findAtEmployer: undefined } });
    const requested = stub.urls();
    assert.ok(!requested.some((u) => u.startsWith('https://boards-api.greenhouse.io/v1/boards/')), requested.join('\n'));
    for (const host of new Set(requested.map((u) => new URL(u).host))) {
      assert.ok(requested.filter((u) => u === `https://${host}/robots.txt`).length <= 1, `robots.txt for ${host}`);
    }
    assert.ok(out.rows.some((r) => r.startsWith(`- [ ] ${lever} |`)), out.staging);
  } finally {
    s.cleanup();
  }
});

test('extra check: requests to one host go one at a time at least 1200 ms apart, or the Crawl-delay when longer', { timeout: 120000 }, async () => {
  const s = setup();
  try {
    const stamps = [];
    const base = H.stubFetch([
      [(u) => u === 'https://api.ashbyhq.com/robots.txt', () => H.text('User-agent: *\nCrawl-delay: 2\n')],
      [(u) => u.endsWith('/robots.txt'), notFound],
    ], { delayMs: 20 });
    const fetch = async (input, init) => {
      const url = String(input?.url ?? input);
      if (!url.endsWith('/robots.txt')) stamps.push({ host: new URL(url).host, at: Date.now() });
      return base.fetch(input, init);
    };
    await run(s, [liAlert('m-1', [job({ company: 'Example Robotics' }), job({ company: 'Sample Labs', job_id: '3900005678' })])], { deps: { fetch, findAtEmployer: undefined } });
    assert.equal(base.state.maxInFlight, 1, 'lookups run one at a time');
    const hosts = new Map();
    for (const st of stamps) hosts.set(st.host, [...(hosts.get(st.host) ?? []), st.at]);
    assert.ok([...hosts.values()].some((t) => t.length >= 2), 'two lookups reach the same host');
    for (const [host, times] of hosts) {
      const min = host === 'api.ashbyhq.com' ? 2000 : 1200;
      for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= min - 60, `${host} gap ${times[i] - times[i - 1]} ms`);
    }
  } finally {
    s.cleanup();
  }
});
