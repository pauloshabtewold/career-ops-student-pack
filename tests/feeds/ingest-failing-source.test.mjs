// W-023-A3-1: upstream ctx.fetch throws on any non-2xx with err.status set. A 4xx other than 429 is final, so a renamed list
// costs one request, and the failed source goes to the back of the least-recently-read queue.
// W-023-A3-3: every request carries a timeoutMs so a slow host cannot run past the 11 s host budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import plugin from '../../plugins/github-lists/index.mjs';
import * as H from '../helpers/feed-harness.mjs';

const src = (name) => ({ name, repo: `example-org/${name}`, path: 'listings.json', format: 'simplify-json', kind: 'internship', status: 'active' });
const BODY = (name) => JSON.stringify([{ company_name: `${name} Co`, title: 'Software Engineer Intern - Summer 2027', locations: ['Austin, TX'], url: `https://example.com/${name}`, date_posted: 1758000000, active: true, is_visible: true }]);

async function run(sources, { status = 404, runs = 1 } = {}) {
  const s = H.scratch();
  const realNow = Date.now;
  let clock = 1000;
  Date.now = () => clock;
  try {
    H.writeJson(join(s.data, 'student-github-sources.json'), { sources });
    H.writeJson(join(s.data, 'student-cycle.json'), H.CYCLE);
    const fetched = [];
    const timeouts = [];
    const sleeps = [];
    const fetch = async (url, init = {}) => {
      fetched.push(url.split('/')[3] + '/' + url.split('/')[4]);
      timeouts.push(init.timeoutMs);
      if (url.includes('/gone/')) throw Object.assign(new Error(`HTTP ${status}`), { status });
      return H.text(BODY(url.split('/')[4]));
    };
    const sleep = async (ms) => { sleeps.push(ms); clock += ms; };
    for (let i = 0; i < runs; i++) {
      fetched.length = 0;
      sleeps.length = 0;
      await plugin.ingest({ dataRoot: s.data, fetch, sleep, today: H.TODAY, dryRun: false, preset: H.PRESET, log: () => {} });
    }
    const registry = JSON.parse(H.readText(join(s.data, 'student-github-sources.json')));
    return { fetched: [...fetched], sleeps: [...sleeps], timeouts, registry };
  } finally {
    Date.now = realNow;
    s.cleanup();
  }
}

test('W-023-A3-1 a 404 list is requested once with no backoff sleep, and the other lists are read', async () => {
  const { fetched, sleeps } = await run([src('gone'), src('b'), src('c'), src('d')]);
  assert.deepEqual(fetched, ['example-org/gone', 'example-org/b', 'example-org/c', 'example-org/d']);
  assert.ok(!sleeps.includes(3000) && !sleeps.includes(6000), JSON.stringify(sleeps));
});

test('W-023-A3-1 a failed list still counts toward retirement and goes to the back of the next run', async () => {
  const first = await run([src('gone'), src('b'), src('c')]);
  assert.equal(first.registry.sources[0].failed_parses, 1);
  assert.equal(first.registry.sources[0].last_attempt, H.TODAY);
  const second = await run(first.registry.sources);
  assert.equal(second.fetched.at(-1), 'example-org/gone', second.fetched.join());
  assert.equal(second.registry.sources[0].failed_parses, 2);
});

test('W-023-A3-1 a 429 and a 5xx are still retried with backoff', async () => {
  for (const status of [429, 503]) {
    const { sleeps } = await run([src('gone')], { status });
    assert.deepEqual(sleeps.slice(0, 2), [3000, 6000], `status ${status}`);
  }
});

test('W-023-A3-3 every list request carries a timeoutMs of at least 500 and at most the host budget', async () => {
  const { timeouts } = await run([src('b'), src('c')]);
  assert.ok(timeouts.length >= 2);
  for (const t of timeouts) assert.ok(Number.isInteger(t) && t >= 500 && t <= 11000, `timeoutMs ${t}`);
});
