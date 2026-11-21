// docs/quality-gate.md must state every bar and sample size with the value of the lib/quality-bars.mjs constant of the
// same name, so the prose a reviewer reads is the number the harness checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as bars from '../../lib/quality-bars.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const DOC = join(PACK_ROOT, 'docs', 'quality-gate.md');

const cellsOf = (row) => row.split('|').slice(1, -1).map((c) => c.trim().replace(/`/g, ''));
const asNumber = (cell) => {
  const m = cell.match(/^(-?\d+(?:\.\d+)?)(%?)$/);
  if (!m) return null;
  return m[2] ? Number(m[1]) / 100 : Number(m[1]);
};
// The table row whose name cell is exactly the constant name.
const rowFor = (text, name) => text.split('\n').find((l) => l.trim().startsWith('|') && cellsOf(l.trim()).includes(name));

// M-001-S3-osdr
test('M-001-S3-osdr docs/quality-gate.md values equal lib/quality-bars.mjs constants', () => {
  assert.equal(bars.TOP_N, 10);
  assert.equal(bars.OVERLAP_MIN, 0.9);
  assert.equal(bars.INVENTED_FACTS_MAX, 0);
  assert.equal(bars.JUDGE_NOT_WORSE_MIN, 0.9);
  assert.equal(bars.SCAM_FP_MAX, 0.02);
  assert.equal(bars.SAMPLE_SIZES.outcome_mails, 20);
  assert.equal(bars.SAMPLE_SIZES.labeled_replies, 50);
  assert.deepEqual(Object.values(bars.SAMPLE_SIZES).sort((a, b) => a - b), [6, 12, 12, 12, 20, 30, 50, 60]);

  assert.ok(existsSync(DOC), 'docs/quality-gate.md exists');
  const text = readFileSync(DOC, 'utf8');
  const named = Object.entries(bars).filter(([k, v]) => /^[A-Z][A-Z0-9_]*$/.test(k) && typeof v === 'number');
  const sizes = Object.entries(bars.SAMPLE_SIZES);
  for (const [name, value] of [...named, ...sizes]) {
    const row = rowFor(text, name);
    assert.ok(row, `docs/quality-gate.md has a table row for ${name}`);
    const first = cellsOf(row.trim()).map(asNumber).find((n) => n !== null);
    assert.equal(first, value, `${name} in docs/quality-gate.md`);
  }
});
