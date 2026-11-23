// M-007 fix round 2, N2-3: the schedule probe records why chrome_in_schedule has its value (answered, timeout,
// install-failed, chrome-closed), and a no that only means "could not tell" (timeout or install failed) carries the
// offer "I'll check again whether your schedule can reach Chrome, approve? Type: check my schedule's Chrome" in setup,
// the digest and the guided footer; AGENTS.student.md maps that reply to a probe re-run. Fake scheduler and clock; no
// launchd job, browser or model. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { footerLines, summaryLines } from '../../lib/digest.mjs';
import { RECHECK_OFFER, probeUnsure, readProbeState, writeProbeState } from '../../lib/probe-state.mjs';
import { recordChromeReach } from '../../scripts/setup-flow.mjs';
import { probe } from '../../tools/schedule-probe.mjs';
import { PACK_ROOT, makeRoot } from '../helpers/script-harness.mjs';

function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, wait: async (ms) => void (t += Math.max(ms ?? 0, 1)) };
}
const scheduler = (writes, installed = true) => ({ install: ({ out }) => (writes && writeFileSync(out, JSON.stringify(writes)), installed), remove: () => {} });
const runProbe = (r, s) => probe({ root: r.root, dataDir: r.data, scheduler: s, ...fakeClock(), today: '2026-11-03', say: () => {} });

// M-007-fix2-N2-3a
test('M-007-fix2-N2-3a the probe records answered, timeout, install-failed and chrome-closed as the reason', async () => {
  const cases = [
    [scheduler({ reachable: 'yes', chrome_open: 'yes' }), 'answered', 'yes', false],
    [scheduler(null), 'timeout', 'no', true],
    [scheduler(null, false), 'install-failed', 'unset', true],
    [scheduler({ reachable: 'no', chrome_open: 'no' }), 'chrome-closed', 'unset', false],
  ];
  for (const [s, reason, value, unsure] of cases) {
    const r = makeRoot();
    try {
      await runProbe(r, s);
      assert.deepEqual(readProbeState(r.data), { value, reason, date: '2026-11-03' }, reason);
      assert.equal(probeUnsure(r.data), unsure, reason);
    } finally {
      r.cleanup();
    }
  }
});

// M-007-fix2-N2-3b
test('M-007-fix2-N2-3b setup records no with the probe reason and offers the re-check only when the probe could not tell', async () => {
  const r = makeRoot();
  try {
    writeProbeState(r.data, { value: 'unset', reason: 'install-failed', date: '2026-11-03' });
    const line = await recordChromeReach(r.root, r.data);
    assert.ok(line.endsWith(RECHECK_OFFER), line);
    assert.equal(RECHECK_OFFER, "I'll check again whether your schedule can reach Chrome, approve? Type: check my schedule's Chrome");
    assert.match(r.read('config/student.yml'), /chrome_in_schedule: '?no'?/);
    assert.equal(readProbeState(r.data).reason, 'install-failed');
  } finally {
    r.cleanup();
  }
  const plain = makeRoot();
  try {
    const line = await recordChromeReach(plain.root, plain.data);
    assert.ok(!line.includes('check again'), line);
    assert.equal(readProbeState(plain.data).reason, 'no-probe');
  } finally {
    plain.cleanup();
  }
});

// M-007-fix2-N2-3c
test('M-007-fix2-N2-3c the digest waiting line and footer offer the re-check for an unsure no, and stay as they were otherwise', () => {
  const state = { waitingChrome: ['submitting approved applications'], chromeInSchedule: 'no' };
  const unsure = footerLines({ ...state, chromeProbeUnsure: true });
  assert.equal(unsure[1], "Type: check my schedule's Chrome");
  assert.match(unsure[2], /^Why: I'll check again whether your schedule can reach Chrome, approve\?/);
  assert.ok(summaryLines({ ...state, chromeProbeUnsure: true }).some((l) => l.startsWith('- waiting for Chrome:') && l.endsWith(RECHECK_OFFER)));
  assert.deepEqual(summaryLines(state), summaryLines({ ...state, chromeProbeUnsure: false }));
  assert.ok(!footerLines(state).some((l) => l.includes("schedule's Chrome")));
});

// M-007-fix2-N2-3d
test('M-007-fix2-N2-3d AGENTS.student.md maps the reply to a probe re-run', () => {
  const text = readFileSync(join(PACK_ROOT, 'AGENTS.student.md'), 'utf8');
  assert.match(text, /"check my schedule's Chrome" runs `node student\/tools\/schedule-probe\.mjs`/);
});
