// Since career-ops 1.40.0 fetch-jd.mjs falls back to a plain GET of any posting page and exits 3 with CLOSED_POSTING for a
// closed posting. daily-triage reads robots.txt (lib/robots.mjs) before a fetch-jd call on a host that is not a public ATS
// board, keeps the same-host gap, and turns a closed posting into an EXPIRED verdict. Fake hosts and a fake clock only:
// robots.txt answers come from an injected fetch and fetch-jd from the injected runner, so nothing touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyTriage } from '../../scripts/daily-triage.mjs';
import { createRobotsChecker } from '../../lib/robots.mjs';
import { args, line, makeRunner, makeTriageRoot, verdict } from '../helpers/triage-harness.mjs';
import { rowsOf } from '../helpers/script-harness.mjs';

const withRoot = async (opts, fn) => {
  const r = makeTriageRoot(opts);
  try {
    await fn(r);
  } finally {
    r.cleanup();
  }
};
const pendingFor = (urls) => urls.map((u) => line(u, 'Example Robotics', 'Data Intern', 'Remote', 'src=handshake'));
const promptUrls = (input) => [...String(input).matchAll(/^### (\S+)$/gm)].map((m) => m[1]);
const passAll = (_a, opts) => promptUrls(opts.input).map((u) => verdict('PASS', u, '4.5')).join('\n');

// A robots.txt server for fake hosts: robots maps host -> { status, text }; every request is recorded.
function fakeRobots(robots) {
  const requested = [];
  const fetch = async (url) => {
    requested.push(String(url));
    const host = new URL(url).hostname;
    if (!(host in robots)) throw new Error('unreachable');
    const { status = 200, text = '' } = robots[host];
    return { status, ok: status >= 200 && status < 300, text: async () => text };
  };
  return { checker: createRobotsChecker({ fetch }), requested };
}

function fakeClock() {
  let t = 1_000_000;
  const slept = [];
  return { now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; }, slept };
}

test('a careers-site host whose robots.txt disallows the posting is never fetched and is judged on title and company', () => {
  const blocked = 'https://careers.example-corp.test/job/101';
  return withRoot({ pending: pendingFor([blocked]) }, async (r) => {
    const { checker, requested } = fakeRobots({ 'careers.example-corp.test': { text: 'User-agent: *\nDisallow: /job/\n' } });
    const { runner, calls } = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r), runner, robots: checker });
    assert.deepEqual(requested, ['https://careers.example-corp.test/robots.txt']);
    assert.equal(calls.fetch.length, 0, 'fetch-jd was called for a disallowed url');
    assert.match(calls.claude[0].opts.input, /posting text unavailable: judge on the title and company only/);
  });
});

test('a careers-site host whose robots.txt cannot be read is not fetched', () => {
  const url = 'https://jobs.unreachable-corp.test/posting/7';
  return withRoot({ pending: pendingFor([url]) }, async (r) => {
    const { checker } = fakeRobots({});
    const { runner, calls } = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r), runner, robots: checker });
    assert.equal(calls.fetch.length, 0);
    assert.equal(calls.claude.length, 1);
  });
});

test('public ATS board hosts go to fetch-jd without a robots.txt request', () => {
  const urls = [
    'https://job-boards.greenhouse.io/examplerobotics/jobs/4001',
    'https://jobs.lever.co/examplerobotics/0f7a9c1e-1111-4222-8333-944455556666',
    'https://jobs.ashbyhq.com/examplerobotics/0f7a9c1e-1111-4222-8333-944455556677',
  ];
  return withRoot({ pending: pendingFor(urls) }, async (r) => {
    const { checker, requested } = fakeRobots({});
    const { runner, calls } = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r), runner, robots: checker });
    assert.deepEqual(requested, []);
    assert.deepEqual(calls.fetch.map((c) => c.args[1]), urls);
  });
});

test('allowed careers-site fetches keep the pack request gap, or the longer Crawl-delay, between calls to one host', () => {
  const a = ['https://careers.slow-corp.test/job/1', 'https://careers.slow-corp.test/job/2'];
  const b = ['https://careers.plain-corp.test/job/1', 'https://careers.plain-corp.test/job/2'];
  return withRoot({ pending: pendingFor([...a, ...b]) }, async (r) => {
    const { checker } = fakeRobots({
      'careers.slow-corp.test': { text: 'User-agent: *\nCrawl-delay: 3\n' },
      'careers.plain-corp.test': { status: 404 },
    });
    const clock = fakeClock();
    const { runner, calls } = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r), runner, robots: checker, sleep: clock.sleep, now: clock.now });
    assert.equal(calls.fetch.length, 4);
    assert.deepEqual(clock.slept, [3000, 1200]);
  });
});

test('a posting fetch-jd reports closed (exit 3, CLOSED_POSTING) gets an EXPIRED verdict and is not sent to the model', () => {
  const closed = 'https://job-boards.greenhouse.io/examplerobotics/jobs/5001';
  const open = 'https://job-boards.greenhouse.io/examplerobotics/jobs/5002';
  return withRoot({ pending: pendingFor([closed, open]) }, async (r) => {
    const { runner, calls } = makeRunner(r, {
      claude: passAll,
      fetch: (url) => {
        if (url !== closed) return 'Open posting text';
        throw Object.assign(new Error('Command failed'), { status: 3, stdout: 'CLOSED_POSTING JobPosting validThrough 2026-10-01 | passed', stderr: '' });
      },
    });
    await dailyTriage({ ...args(r), runner });
    assert.deepEqual(promptUrls(calls.claude[0].opts.input), [open]);
    const text = r.read('data/pipeline.md');
    const skipped = rowsOf(text, 'Skipped');
    assert.deepEqual(skipped.map((x) => x.url), [closed]);
    assert.match(skipped[0].notes.get('expired'), /^posting closed: JobPosting validThrough 2026-10-01/);
    assert.deepEqual(rowsOf(text, 'Pending').map((x) => x.url), [open]);
  });
});

test('a chunk whose postings are all closed applies EXPIRED without an agent call', () => {
  const closed = 'https://jobs.ashbyhq.com/examplerobotics/0f7a9c1e-1111-4222-8333-944455550001';
  return withRoot({ pending: pendingFor([closed]) }, async (r) => {
    const { runner, calls } = makeRunner(r, {
      fetch: () => {
        throw Object.assign(new Error('Command failed'), { status: 3, stdout: 'CLOSED_POSTING isListed false', stderr: '' });
      },
    });
    await dailyTriage({ ...args(r), runner });
    assert.equal(calls.claude.length, 0);
    assert.deepEqual(rowsOf(r.read('data/pipeline.md'), 'Skipped').map((x) => x.url), [closed]);
  });
});

test('a non-zero fetch-jd exit other than 3 still falls back to title and company', () => {
  const url = 'https://job-boards.greenhouse.io/examplerobotics/jobs/6001';
  return withRoot({ pending: pendingFor([url]) }, async (r) => {
    const { runner, calls } = makeRunner(r, {
      claude: passAll,
      fetch: () => {
        throw Object.assign(new Error('Command failed'), { status: 1, stdout: 'CLOSED_POSTING not really', stderr: '' });
      },
    });
    await dailyTriage({ ...args(r), runner });
    assert.deepEqual(promptUrls(calls.claude[0].opts.input), [url]);
    assert.equal(rowsOf(r.read('data/pipeline.md'), 'Skipped').length, 0);
  });
});
