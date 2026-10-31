// W-023-A1-2 and W-023-A1-4: scheduled.mjs hands daily-triage a deadline, and the child timeout stays a whole, positive
// number of milliseconds for any run_lock_hours. The runner is injected, so no child starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { scheduledRun } from '../../scripts/scheduled.mjs';
import { triageChildTimeoutMs } from '../../scripts/daily-triage.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';
import { PLUS, TODAY, makeTriageRoot, untriaged } from '../helpers/triage-harness.mjs';

const MIN = 60 * 1000;

test('W-023-A1-4 triageChildTimeoutMs is a whole number of at least 10 minutes for 0, 0.25, 0.5 and fractional run_lock_hours', () => {
  for (const runLockHours of [0, 0.1, 0.25, 0.5, 4.1, 8.2, 8.3, 12]) {
    for (const chunks of [1, 13, 40]) {
      const ms = triageChildTimeoutMs({ chunks, runLockHours });
      assert.ok(Number.isInteger(ms) && ms >= 10 * MIN, `${runLockHours} h, ${chunks} chunks gave ${ms}`);
    }
  }
  assert.equal(triageChildTimeoutMs({ chunks: 13, runLockHours: 4.1 }), Math.floor(4.1 * 60 * MIN - 30 * MIN));
  assert.equal(triageChildTimeoutMs({ chunks: 13, runLockHours: 12 }), 335 * MIN);
});

test('W-023-A1-2 the daily-triage child gets --deadline at the moment its own timeout ends; daily.mjs gets none', async () => {
  const r = makeTriageRoot({ config: `${PLUS}triage_budget:\n  daily: all\n`, pending: untriaged(260) });
  const seen = {};
  const runner = (_cmd, argv, opts) => {
    seen[basename(argv[0])] = { argv, timeout: opts.timeout, at: Date.now() };
    return '';
  };
  try {
    await scheduledRun({ root: r.root, packRoot: PACK_ROOT, passThrough: ['--root', r.root], dataDir: r.data, today: TODAY, runner, out: () => {} });
    const t = seen['daily-triage.mjs'];
    const i = t.argv.indexOf('--deadline');
    assert.ok(i > 0, t.argv.join(' '));
    const deadline = Number(t.argv[i + 1]);
    assert.ok(Number.isInteger(deadline));
    assert.ok(Math.abs(deadline - (t.at + t.timeout)) < 5000, `${deadline} vs ${t.at + t.timeout}`);
    assert.equal(seen['daily.mjs'].argv.includes('--deadline'), false);
  } finally {
    r.cleanup();
  }
});
