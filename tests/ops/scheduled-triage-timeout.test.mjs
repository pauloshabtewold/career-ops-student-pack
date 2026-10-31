// Assumed: triageChildTimeoutMs({ chunks, runLockHours }) is exported by scripts/daily-triage.mjs and returns
// milliseconds; scheduledRun({ root, packRoot, passThrough, dataDir, today, runner, out }) passes it as opts.timeout to the
// daily-triage.mjs child and keeps 60 minutes for daily.mjs. The runner is injected, so no child starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { basename } from 'node:path';
import { scheduledRun } from '../../scripts/scheduled.mjs';
import { triageChildTimeoutMs } from '../../scripts/daily-triage.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';
import { PLUS, TODAY, makeTriageRoot, untriaged, writeLedger } from '../helpers/triage-harness.mjs';

const MIN = 60 * 1000;

// M-002-S12
test('M-002-S12 triageChildTimeoutMs gives 60 min for 1 chunk, 335 for 13, 690 for 40 at 12 lock hours and 90 for 13 at 2 lock hours', () => {
  assert.equal(triageChildTimeoutMs({ chunks: 1, runLockHours: 12 }), 60 * MIN);
  assert.equal(triageChildTimeoutMs({ chunks: 13, runLockHours: 12 }), 335 * MIN);
  assert.equal(triageChildTimeoutMs({ chunks: 40, runLockHours: 12 }), 690 * MIN);
  assert.equal(triageChildTimeoutMs({ chunks: 13, runLockHours: 2 }), 90 * MIN);
});

async function timeouts(rowsCount, config = `${PLUS}triage_budget:\n  daily: all\n`, setup = () => {}) {
  const r = makeTriageRoot({ config, pending: untriaged(rowsCount) });
  setup(r);
  const seen = {};
  const runner = (_cmd, argv, opts) => {
    seen[basename(argv[0])] = opts.timeout;
    return '';
  };
  try {
    await scheduledRun({ root: r.root, packRoot: PACK_ROOT, passThrough: [], dataDir: r.data, today: TODAY, runner, out: () => {} });
    return seen;
  } finally {
    r.cleanup();
  }
}

// M-002-S12
test('M-002-S12 scheduledRun passes 335 min to the daily-triage child for 260 rows (13 chunks) and 60 min to daily.mjs', async () => {
  const seen = await timeouts(260);
  assert.equal(seen['daily-triage.mjs'], 335 * MIN);
  assert.equal(seen['daily.mjs'], 60 * MIN);
});

// M-002-S12
test('M-002-S12 scheduledRun keeps 60 min for a one-chunk budget and scales the child only', async () => {
  const small = await timeouts(5);
  assert.equal(small['daily-triage.mjs'], 60 * MIN);
  const big = await timeouts(260);
  assert.equal(big['daily-triage.mjs'] > small['daily-triage.mjs'], true);
  assert.equal(big['daily.mjs'], small['daily.mjs']);
});

// W-024-A5-10 the budget cap, the stop rules and the catch fallback all shape the child timeout.
// run_lock_hours 1 caps the computed timeout at 30 min, so it differs from the 60-minute fallback.
const ONE_LOCK_HOUR = 'limits:\n  run_lock_hours: 1\n';

test('W-024-A5-10-1 260 untriaged rows with the default daily budget of 20 size the child for one chunk (60 min), not 13', async () => {
  const seen = await timeouts(260, PLUS);
  assert.equal(seen['daily-triage.mjs'], 60 * MIN);
});

test('W-024-A5-10-2 a daily budget of 60 over 260 rows sizes the child for three chunks (85 min)', async () => {
  const seen = await timeouts(260, `${PLUS}triage_budget:\n  daily: 60\n`);
  assert.equal(seen['daily-triage.mjs'], 85 * MIN);
});

test('W-024-A5-10-3 a failed scheduled ledger row today stops the plan, so the child gets the minimal timeout', async () => {
  const stopped = (r) => writeLedger(r, [{ date: TODAY, source: 'scheduled', rows: 20, outcome: 'failed' }]);
  const seen = await timeouts(260, `${PLUS}triage_budget:\n  daily: all\n`, stopped);
  assert.equal(seen['daily-triage.mjs'], 60 * MIN);
  const capped = await timeouts(260, `${PLUS}triage_budget:\n  daily: all\n${ONE_LOCK_HOUR}`, stopped);
  assert.equal(capped['daily-triage.mjs'], 30 * MIN);
});

test('W-024-A5-10-4 an unreadable pipeline.md falls back to the 60-minute timeout every child had', async () => {
  const unreadable = (r) => {
    rmSync(r.file('data/pipeline.md'), { force: true });
    mkdirSync(r.file('data/pipeline.md'));
  };
  const seen = await timeouts(260, `${PLUS}triage_budget:\n  daily: all\n${ONE_LOCK_HOUR}`, unreadable);
  assert.equal(seen['daily-triage.mjs'], 60 * MIN);
  assert.equal(seen['daily.mjs'], 60 * MIN);
  const readable = await timeouts(260, `${PLUS}triage_budget:\n  daily: all\n${ONE_LOCK_HOUR}`);
  assert.equal(readable['daily-triage.mjs'], 30 * MIN);
});
