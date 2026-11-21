// lib/ats-fields.mjs per-ATS field maps: EEO keys match only their own questions, and with T3 off nothing is written to
// or read from data/ats-maps.json. Fake answers only. Form field shape (ruling): { label, name, type, options? }.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const keyOf = (m) => (typeof m === 'string' ? m : m?.key ?? null);
const URL_GH = 'https://boards.greenhouse.io/examplerobotics/jobs/1001';
const TRANS = { label: 'Do you identify as transgender?', name: 'question_trans', type: 'select', options: ['Yes', 'No', 'Decline to self-identify'] };
const GENDER = { label: 'Gender', name: 'gender', type: 'select', options: ['Male', 'Female', 'Decline to self-identify'] };

async function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pack-ats-fields-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// M-002-S13-osdr
test('M-002-S13-osdr a transgender question is never filled from the gender key', async () => {
  const { mapField } = await import('../../lib/ats-fields.mjs');
  const { resolveFields } = await import('../../scripts/fill-plan.mjs');
  const gender = keyOf(mapField(GENDER, { ats: 'greenhouse' }));
  assert.match(String(gender), /gender$/, 'the gender question maps to the gender key');
  const trans = keyOf(mapField(TRANS, { ats: 'greenhouse' }));
  assert.ok(!/(^|\.)gender$/.test(String(trans)), `transgender question mapped to ${trans}`);

  const answers = { work_authorization: 'US citizen', eeo: { gender: 'fake-gender-a' } };
  const candidate = { full_name: 'Jordan Testwell', email: 'jordan.testwell@example.com', phone: '555-0100' };
  const res = await resolveFields({ url: URL_GH, fields: [GENDER, TRANS] }, { answers, candidate, headless: () => assert.fail('no agent call') });
  const filled = (res.fields ?? []).find((f) => f.name === TRANS.name || f.label === TRANS.label);
  assert.notEqual(filled?.value, 'fake-gender-a', 'the gender answer never fills the transgender question');
});

// M-002-S35-osdr
test('M-002-S35-osdr with T3 off a field label answered in a session writes no learned entry to data/ats-maps.json', () =>
  withDir(async (dir) => {
    const { learnField, mapForm, LEARNED_FILE } = await import('../../lib/ats-fields.mjs');
    assert.equal(LEARNED_FILE, 'ats-maps.json');
    const label = 'Which fake mascot do you prefer?';
    learnField(dir, { ats: 'greenhouse', label, key: 'questions.mascot', learnedOn: false });
    assert.equal(existsSync(join(dir, 'ats-maps.json')), false, 'nothing written while T3 is off');

    learnField(dir, { ats: 'greenhouse', label, key: 'questions.mascot', learnedOn: true });
    assert.equal(existsSync(join(dir, 'ats-maps.json')), true, 'the same call writes the entry when T3 is on');

    const field = { label, name: 'question_mascot', type: 'text' };
    const offMapped = mapForm([field], { url: URL_GH, dataDir: dir, learnedOn: false });
    const offKeys = (offMapped.fields ?? offMapped).map((f) => keyOf(f.key !== undefined ? f.key : f));
    assert.ok(!offKeys.includes('questions.mascot'), 'with T3 off the learned file is not read');
  }));
