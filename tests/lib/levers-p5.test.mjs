// lib/levers.mjs against a docs/lever-verdicts.json in a scratch root: pending, fail and missing verdicts, and config that
// asks for a lever. Verdict file format and config/levers.yml format: see tests/helpers/lever-harness.mjs and
// tests/lib/levers.test.mjs. Ruling: valueOf returns its fallback for a lever that resolves off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOverrides, readVerdicts, resolve, valueOf } from '../../lib/levers.mjs';
import { GATED, PLUMBING, soloVerdict, writeVerdicts } from '../helpers/lever-harness.mjs';

function withRoot(levers, config, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pack-levers-p5-'));
  try {
    mkdirSync(join(dir, 'config'), { recursive: true });
    if (levers) writeVerdicts(dir, levers);
    if (config) writeFileSync(join(dir, 'config', 'levers.yml'), config);
    return fn({ verdicts: readVerdicts(dir), overrides: readOverrides(dir) });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// M-006-S5-osdr
test('M-006-S5-osdr edge: a lever with a pending verdict stays off even when config asks for it', () =>
  withRoot(
    { T2: soloVerdict('pending'), jd_trim: soloVerdict('pending'), T8: soloVerdict('pending'), T16: soloVerdict('fail', 0.2), T5: soloVerdict('fail', 0.2) },
    'T2: on\njd_trim: on\nT8: on\nT16: on\nT5: on\n',
    (opts) => {
      for (const id of ['T2', 'jd_trim', 'T8', 'T16', 'T5']) assert.equal(resolve(id, opts).on, false, `${id} off`);
      assert.equal(valueOf('jd_trim', 'full-text', opts), 'full-text', 'a pending jd_trim keeps the untrimmed fallback');
    },
  ));

// M-006-S9-osdr
test('M-006-S9-osdr error: a failing structural lever resolves to its off path restoring the P0 behaviour', () =>
  withRoot(Object.fromEntries([...PLUMBING, 'T16'].map((id) => [id, soloVerdict('fail', 0.2)])), null, (opts) => {
    for (const id of [...PLUMBING, 'T16']) assert.equal(resolve(id, opts).on, false, `${id} takes its off path`);
    assert.equal(valueOf('T1', 'p0-path', opts), 'p0-path');
  }));

// M-006-S18-osdr
test('M-006-S18-osdr edge: with no verdict T1 T13 and T15 stay on while T3 T6 T7 T8 T14 and T16 stay off even when config asks for them', () =>
  withRoot(null, `${GATED.map((id) => `${id}: on`).join('\n')}\n`, (opts) => {
    for (const id of PLUMBING) assert.equal(resolve(id, opts).on, true, `${id} on`);
    for (const id of GATED) {
      assert.equal(resolve(id, opts).on, false, `${id} off`);
      assert.equal(valueOf(id, 'p0-path', opts), 'p0-path', `${id} gives its fallback`);
    }
  }));
