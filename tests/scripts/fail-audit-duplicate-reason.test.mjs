// Covers M-002-S3..S6: fail-audit duplicate_reason choice via the CLI, plus in-process auditOptions checks.
// All names are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoot, runScript, line, pipelineText, jobUrl } from '../helpers/script-harness.mjs';
import { auditOptions } from '../../scripts/fail-audit.mjs';

const KW = 'judgment_keywords:\n  - grad window\n';
const picked = (stdout) => {
  const v = JSON.parse(stdout);
  return Array.isArray(v) ? v : v.rows;
};
const row = (n, company, note) => line(jobUrl(n), company, `Role ${n}`, 'Remote', note);

function run(config, skipped) {
  const r = makeRoot({ config });
  try {
    r.write('data/pipeline.md', pipelineText({ pending: [line(jobUrl(1), 'Acme', 'Pending role')], skipped }));
    const out = runScript('fail-audit', ['pick'], r);
    assert.equal(out.code, 0, out.stderr);
    return picked(out.stdout);
  } finally {
    r.cleanup();
  }
}

const TWO = row(10, 'Acme', 'reason=grad window mismatch; reason=followup sent; triaged=2026-10-01; imported=2026-10-01');

// M-002-S3
test('M-002-S3 unset duplicate_reason picks the first reason', () => {
  const rows = run(KW, [TWO]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].url, jobUrl(10));
  assert.equal(rows[0].reason, 'grad window mismatch');
});

// M-002-S4
test('M-002-S4 last leaves out a row whose last reason is not a judgment call; first picks it', () => {
  const skipped = [TWO, row(11, 'Globex', 'reason=grad window mismatch; reason=followup sent; triaged=2026-10-02; imported=2026-10-02')];
  assert.deepEqual(run(`${KW}audit:\n  duplicate_reason: last\n`, skipped), []);
  const first = run(`${KW}audit:\n  duplicate_reason: first\n`, skipped);
  assert.deepEqual(first.map((x) => x.url).sort(), [jobUrl(10), jobUrl(11)]);
});

// M-002-S4
test('M-002-S4 last picks a row whose last reason is a judgment call and reports it', () => {
  const rows = run(`${KW}audit:\n  duplicate_reason: last\n`, [row(12, 'Acme', 'reason=followup sent; reason=grad window mismatch; triaged=2026-10-03; imported=2026-10-03')]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, 'grad window mismatch');
});

// M-002-S5
test('M-002-S5 a single reason note gives the same pick list under first and last', () => {
  const skipped = [row(20, 'Acme', 'reason=grad window mismatch; triaged=2026-10-01; imported=2026-10-01'), row(21, 'Globex', 'reason=followup sent; triaged=2026-10-02')];
  const first = run(`${KW}audit:\n  duplicate_reason: first\n`, skipped);
  const last = run(`${KW}audit:\n  duplicate_reason: last\n`, skipped);
  assert.deepEqual(last, first);
  assert.deepEqual(first.map((x) => x.url), [jobUrl(20)]);
});

// M-002-S6
test('M-002-S6 auditOptions returns duplicateReason first for a null config and last when set', () => {
  assert.equal(auditOptions(null).duplicateReason, 'first');
  assert.equal(auditOptions({}).duplicateReason, 'first');
  assert.equal(auditOptions({ audit: { duplicate_reason: 'last' } }).duplicateReason, 'last');
});
