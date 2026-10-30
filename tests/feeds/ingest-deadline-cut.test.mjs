// A row the 11 s host deadline cut off is deferred: it is logged as deferred, not written to student-agg-unresolved.tsv
// as a miss at the employer, and its source keeps its old last_ingest so it is read first next run. The scan step
// retries only an exit the scan chose itself, never a timeout kill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import plugin from '../../plugins/github-lists/index.mjs';
import { ingestSteps } from '../../lib/ingest.mjs';
import * as H from '../helpers/feed-harness.mjs';

const SRC = { name: 'list-a', repo: 'example-org/list-a', path: 'listings.json', format: 'simplify-json', kind: 'internship', status: 'active' };
const AGG_BODY = JSON.stringify([{ company_name: 'Nowhere Inc', title: 'Software Engineer Intern - Summer 2027', locations: ['Austin, TX'], url: 'https://simplify.jobs/p/zzz', date_posted: 1758000000, active: true, is_visible: true }]);

async function runCut() {
  const s = H.scratch();
  const realNow = Date.now;
  try {
    H.writeJson(join(s.data, 'student-github-sources.json'), { sources: [SRC] });
    H.writeJson(join(s.data, 'student-cycle.json'), H.CYCLE);
    // The list fetch spends the whole budget, so the aggregator lookup that follows is cut by the deadline.
    let clock = 1000;
    Date.now = () => clock;
    const raw = [(u) => u.startsWith('https://raw.githubusercontent.com/example-org/list-a/'), () => {
      clock = 10 ** 13;
      return H.text(AGG_BODY);
    }];
    const stub = H.stubFetch([raw]);
    const logs = [];
    const ctx = { dataRoot: s.data, fetch: stub.fetch, sleep: H.sleeper().sleep, today: H.TODAY, dryRun: false, preset: H.PRESET, budgetMs: 100, log: (m) => logs.push(m) };
    const jobs = await plugin.ingest(ctx);
    Date.now = realNow;
    const registry = JSON.parse(H.readText(join(s.data, 'student-github-sources.json')));
    return { jobs, logs, registry, unresolved: H.tsvLines(join(s.data, 'student-agg-unresolved.tsv')) };
  } finally {
    Date.now = realNow;
    s.cleanup();
  }
}

test('a row cut off by the deadline is logged as deferred, not as unresolved, and its source keeps its old last_ingest', async () => {
  const { jobs, logs, registry, unresolved } = await runCut();
  assert.equal(jobs.length, 0);
  assert.ok(logs.some((m) => /deferred/.test(m) && /list-a/.test(m)), logs.join('\n'));
  assert.ok(!logs.some((m) => /not found at employer/.test(m)));
  assert.ok(unresolved.length <= 1, `at most a header line, got ${JSON.stringify(unresolved)}`);
  assert.equal(registry.sources[0].last_ingest, undefined);
});

function driveScan(errors) {
  let scans = 0;
  const runner = (_cmd, args) => {
    if (args[0].endsWith('scan.mjs') && scans < errors.length) throw errors[scans++];
    if (args[0].endsWith('scan.mjs')) scans++;
    return '{}';
  };
  const outcomes = [];
  const step = (name, fn) => {
    try {
      fn();
      outcomes.push(`${name} ok`);
    } catch {
      outcomes.push(`${name} FAILED`);
    }
  };
  ingestSteps({ root: '/r', dataDir: '/r/data', packRoot: '/p', today: '2026-10-27', runner, step });
  return { scans, scan: outcomes.find((o) => o.startsWith('scan')) };
}

test('a scan killed by the step timeout is not retried', () => {
  const killed = Object.assign(new Error('spawnSync node ETIMEDOUT'), { code: 'ETIMEDOUT', killed: true, signal: 'SIGTERM' });
  assert.deepEqual(driveScan([killed, killed]), { scans: 1, scan: 'scan FAILED' });
});

test('a scan that exits non-zero on its own is retried once', () => {
  const exited = Object.assign(new Error('Command failed'), { status: 1, signal: null });
  assert.deepEqual(driveScan([exited]), { scans: 2, scan: 'scan ok' });
});
