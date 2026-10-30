// Assumed: triageChildTimeoutMs({ chunks, runLockHours }) is exported by scripts/daily-triage.mjs and returns
// milliseconds; scheduledRun({ root, packRoot, passThrough, dataDir, today, runner, out }) passes it as opts.timeout to the
// daily-triage.mjs child and keeps 60 minutes for daily.mjs. The runner is injected, so no child starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { scheduledRun } from '../../scripts/scheduled.mjs';
import { triageChildTimeoutMs } from '../../scripts/daily-triage.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';
import { PLUS, TODAY, makeTriageRoot, untriaged } from '../helpers/triage-harness.mjs';

const MIN = 60 * 1000;

// M-002-S12
test('M-002-S12 triageChildTimeoutMs gives 60 min for 1 chunk, 335 for 13, 690 for 40 at 12 lock hours and 90 for 13 at 2 lock hours', () => {
  assert.equal(triageChildTimeoutMs({ chunks: 1, runLockHours: 12 }), 60 * MIN);
  assert.equal(triageChildTimeoutMs({ chunks: 13, runLockHours: 12 }), 335 * MIN);
  assert.equal(triageChildTimeoutMs({ chunks: 40, runLockHours: 12 }), 690 * MIN);
  assert.equal(triageChildTimeoutMs({ chunks: 13, runLockHours: 2 }), 90 * MIN);
});

async function timeouts(rowsCount, config = `${PLUS}triage_budget:\n  daily: all\n`) {
  const r = makeTriageRoot({ config, pending: untriaged(rowsCount) });
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
