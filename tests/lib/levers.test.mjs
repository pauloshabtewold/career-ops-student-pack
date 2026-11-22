// lib/levers.mjs resolve(id, { verdicts, overrides }): defaults with no docs/lever-verdicts.json, and config overrides
// that may only turn a lever off. Scratch roots only. Overrides file format (ruling): config/levers.yml, one
// '<lever id>: on|off' line per lever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PLUMBING = ['T1', 'T13', 'T15'];
const GATED = ['T3', 'T6', 'T7', 'T8', 'T14', 'T16'];
const TUNING = ['T2', 'T4', 'T5', 'T9', 'T10', 'T11', 'T12', 'T17', 'economy_tier', 'jd_trim', 'batch_size'];

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'pack-levers-'));
  mkdirSync(join(dir, 'docs'));
  mkdirSync(join(dir, 'config'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// M-002-S32-osdr
test('M-002-S32-osdr with no docs/lever-verdicts.json T1 T13 and T15 resolve on while T3 T6 T7 T8 T14 T16 and every tuning lever resolve off', async () => {
  const { LEVER_IDS, readVerdicts, resolve } = await import('../../lib/levers.mjs');
  const s = scratch();
  try {
    assert.equal(existsSync(join(s.dir, 'docs', 'lever-verdicts.json')), false);
    const verdicts = readVerdicts(s.dir);
    assert.deepEqual([...LEVER_IDS].sort(), [...PLUMBING, ...GATED, ...TUNING].sort());
    for (const id of PLUMBING) assert.equal(resolve(id, { verdicts, overrides: {} }).on, true, `${id} on`);
    for (const id of [...GATED, ...TUNING]) assert.equal(resolve(id, { verdicts, overrides: {} }).on, false, `${id} off`);
  } finally {
    s.cleanup();
  }
});

// M-002-S18-osdr
test('M-002-S18-osdr config asking to force a tuning lever on leaves it off while turning a structural lever off takes effect', async () => {
  const { readOverrides, readVerdicts, resolve } = await import('../../lib/levers.mjs');
  const s = scratch();
  try {
    writeFileSync(join(s.dir, 'config', 'levers.yml'), 'T2: on\nT8: on\nT1: off\n');
    const verdicts = readVerdicts(s.dir);
    const overrides = readOverrides(s.dir);
    assert.equal(resolve('T2', { verdicts, overrides }).on, false, 'a tuning lever stays off without a pass verdict');
    assert.equal(resolve('T8', { verdicts, overrides }).on, false, 'a gated lever stays off without a pass verdict');
    assert.equal(resolve('T1', { verdicts, overrides }).on, false, 'turning a plumbing lever off takes effect');
    assert.equal(resolve('T13', { verdicts, overrides }).on, true, 'an untouched plumbing lever stays on');
  } finally {
    s.cleanup();
  }
});
