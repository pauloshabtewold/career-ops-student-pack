// lib/robots.mjs: robotsVerdict({ status, text }, path, { agent, crawlDelayCapS }) -> { allowed, reason, crawlDelay };
// createRobotsChecker({ fetch, timeoutMs, crawlDelayCapS }).check(url) -> the same verdict. Fake hosts only, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRobotsChecker, robotsVerdict } from '../../lib/robots.mjs';

const ok = (text) => ({ status: 200, text });
const allowed = (res, path, opts) => robotsVerdict(res, path, opts).allowed;

const BOTH_GROUPS = `User-agent: *
Disallow: /private
Allow: /private/ok

User-agent: career-ops-student-pack
Disallow: /api/
Allow: /api/public
Disallow: /*.json$
Disallow: /tmp*/x
Disallow: /same
Allow: /same
`;

// M-001-S1-cdel
test('M-001-S1-cdel the career-ops-student-pack group wins over the star group and the longest rule wins', () => {
  const res = ok(BOTH_GROUPS);
  assert.equal(allowed(res, '/api/secret'), false);
  assert.equal(allowed(res, '/api/public/list'), true, 'longer Allow beats shorter Disallow');
  assert.equal(allowed(res, '/api/public'), true);
  assert.equal(allowed(res, '/private/x'), true, 'the star group is ignored when the agent group exists');
  assert.equal(allowed(res, '/elsewhere'), true);
});

// M-001-S1-cdel
test('M-001-S1-cdel star matches any run of characters and a trailing dollar anchors the end of the path', () => {
  const res = ok(BOTH_GROUPS);
  assert.equal(allowed(res, '/data/list.json'), false);
  assert.equal(allowed(res, '/data/list.json?x=1'), true, 'dollar anchors the end, so a query string escapes the rule');
  assert.equal(allowed(res, '/tmp123/x'), false);
  assert.equal(allowed(res, '/tmp/y'), true);
});

// M-001-S1-cdel
test('M-001-S1-cdel Allow wins a tie against Disallow of the same length', () => {
  assert.equal(allowed(ok(BOTH_GROUPS), '/same'), true);
});

// M-001-S1-cdel
test('M-001-S1-cdel the star group applies when no group names the agent, and the longest rule still wins', () => {
  const res = ok('User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$\n');
  assert.equal(allowed(res, '/private/x'), false);
  assert.equal(allowed(res, '/private/ok/y'), true);
  assert.equal(allowed(res, '/files/cv.pdf'), false);
  assert.equal(allowed(res, '/files/cv.pdf.txt'), true);
  assert.equal(allowed(res, '/open'), true);
});

// M-001-S1-cdel
test('M-001-S1-cdel a group for some other agent does not apply', () => {
  const res = ok('User-agent: otherbot\nDisallow: /\n');
  assert.equal(allowed(res, '/anything'), true);
});

// M-001-S2-cdel
test('M-001-S2-cdel a 404 or a 401 answer means the host has no rules', () => {
  for (const status of [404, 401]) {
    const v = robotsVerdict({ status, text: 'User-agent: *\nDisallow: /' }, '/jobs');
    assert.equal(v.allowed, true, `status ${status}`);
  }
});

// M-001-S2-cdel
test('M-001-S2-cdel a 503 answer disallows every path with the reason robots.txt unreachable', () => {
  for (const path of ['/', '/jobs', '/v1/boards/x/jobs']) {
    const v = robotsVerdict({ status: 503, text: '' }, path);
    assert.equal(v.allowed, false, path);
    assert.equal(v.reason, 'robots.txt unreachable');
  }
});

// M-001-S2-cdel
test('M-001-S2-cdel a fetch that throws disallows every path, and a 404 host through the checker is open', async () => {
  const boom = createRobotsChecker({ fetch: async () => { throw new Error('socket hang up'); } });
  const down = await boom.check('https://boards-api.example.com/v1/boards/x/jobs');
  assert.equal(down.allowed, false);
  assert.equal(down.reason, 'robots.txt unreachable');
  const none = createRobotsChecker({ fetch: async () => new Response('missing', { status: 404 }) });
  assert.equal((await none.check('https://api.example.org/v0/postings/x')).allowed, true);
});

// M-001-S2-cdel
test('M-001-S2-cdel the checker fetches robots.txt once per host, applies its rules and never fetches linkedin.com', async () => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(String(url));
    return new Response('User-agent: *\nDisallow: /v1/blocked\n', { status: 200 });
  };
  const checker = createRobotsChecker({ fetch });
  assert.equal((await checker.check('https://boards-api.example.com/v1/blocked/jobs')).allowed, false);
  assert.equal((await checker.check('https://boards-api.example.com/v1/open/jobs')).allowed, true);
  assert.deepEqual(urls, ['https://boards-api.example.com/robots.txt']);
  const li = await checker.check('https://www.linkedin.com/jobs/search/');
  assert.equal(li.allowed, false);
  assert.equal(li.reason, 'never fetched');
  assert.deepEqual(urls, ['https://boards-api.example.com/robots.txt'], 'no request went to linkedin.com');
});

// M-001-S3-cdel
test('M-001-S3-cdel a Crawl-delay of 6 skips the source with the cap reason while 5 keeps it', () => {
  const six = robotsVerdict(ok('User-agent: career-ops-student-pack\nCrawl-delay: 6\n'), '/jobs');
  assert.equal(six.allowed, false);
  assert.equal(six.reason, 'crawl-delay 6 s above the 5 s cap');
  const five = robotsVerdict(ok('User-agent: career-ops-student-pack\nCrawl-delay: 5\n'), '/jobs');
  assert.equal(five.allowed, true);
  assert.equal(five.crawlDelay, 5);
});

// M-001-S3-cdel
test('M-001-S3-cdel the star group delay counts when no agent group exists and the cap is a parameter', () => {
  const res = ok('User-agent: *\nCrawl-delay: 6\n');
  assert.equal(robotsVerdict(res, '/jobs').reason, 'crawl-delay 6 s above the 5 s cap');
  assert.equal(robotsVerdict(res, '/jobs', { crawlDelayCapS: 10 }).allowed, true);
  const own = ok('User-agent: *\nCrawl-delay: 30\n\nUser-agent: career-ops-student-pack\nCrawl-delay: 2\n');
  const v = robotsVerdict(own, '/jobs');
  assert.equal(v.allowed, true, 'the agent group delay applies, not the star one');
  assert.equal(v.crawlDelay, 2);
});
