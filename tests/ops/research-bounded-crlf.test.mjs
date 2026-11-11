// 959: the extra Greenhouse fetch is bounded (timeout, Crawl-delay, deadline) and a CRLF portals.yml keeps its research block.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readableWithCap, priorResearchEntries } from '../../scripts/research-sources.mjs';
import { researchNames } from '../../lib/ingest.mjs';

const survivor = { provider: 'greenhouse', apiUrl: 'https://boards-api.greenhouse.io/v1/boards/big/jobs' };
const detail = 'response_too_large content-length 12582912';
const allow = (crawlDelay = null) => ({ check: async () => ({ allowed: true, reason: '', crawlDelay }) });

test('a stalled host is aborted after the timeout', async () => {
  const fetch = (_url, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  const res = await readableWithCap({ survivor, detail, fetch, checker: allow(), sleep: async () => {}, now: () => 0, deadline: 1e9, timeoutMs: 20 });
  assert.equal(res, null);
});

test('past the research deadline the extra fetch is not made', async () => {
  let calls = 0;
  const fetch = async () => { calls += 1; return new Response('{}'); };
  const res = await readableWithCap({ survivor, detail, fetch, checker: allow(), sleep: async () => {}, now: () => 100, deadline: 100 });
  assert.deepEqual(res, { skip: 'time limit reached' });
  assert.equal(calls, 0);
});

test('the host Crawl-delay is waited out before the extra fetch; a delay past the deadline skips it', async () => {
  const waits = [];
  const fetch = async () => new Response(JSON.stringify({ jobs: [{ id: 1 }] }));
  const ok = await readableWithCap({ survivor, detail, fetch, checker: allow(3), sleep: async (ms) => waits.push(ms), now: () => 0, deadline: 10000 });
  assert.deepEqual(ok, { postings: 1, cap: 18 });
  assert.deepEqual(waits, [3000]);
  const late = await readableWithCap({ survivor, detail, fetch, checker: allow(3), sleep: async (ms) => waits.push(ms), now: () => 0, deadline: 2000 });
  assert.deepEqual(late, { skip: 'time limit reached' });
  assert.deepEqual(waits, [3000]);
});

const CRLF = ['tracked_companies: []', '# student-pack:start research_companies', '  - name: "Acme"', '    careers_url: https://job-boards.greenhouse.io/acme', '    enabled: true', '# student-pack:end research_companies', ''].join('\r\n');

test('CRLF portals.yml: scripts/research-sources.mjs reads the research block', () => {
  assert.deepEqual(priorResearchEntries(CRLF).map((e) => e.name), ['Acme']);
});

test('CRLF portals.yml: lib/ingest.mjs reads the research block', () => {
  assert.ok(researchNames(CRLF).has('Acme'));
});
