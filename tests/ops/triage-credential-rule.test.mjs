// Regression 959c: triage FAILs a posting whose license or credential the student will not hold by its start date, and
// scores every posting on its own text. A live nursing run passed RN-license residencies for a 2027-05 graduate with
// only -0.5 and gave 15 Patient Care Technician rows one shared estimate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPrompt } from '../../scripts/daily-triage.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const postings = [{ url: 'https://example.com/jobs/1', company: 'Example Hospital', title: 'RN Residency', text: 'Active RN license required at start.' }];

test('the scheduled triage prompt carries the credential and per-row rules above the student rules', () => {
  const p = buildPrompt({ brief: 'Graduates 2027-05', nonce: 'n1', postings });
  const rules = p.indexOf('requires a license or credential the student will not hold by the posting');
  assert.ok(rules > 0 && rules < p.indexOf('## Student rules'), p);
  assert.match(p, /is FAIL, and the reason says which credential is missing/);
  assert.match(p, /Score every posting on its own text\. Never give postings one shared estimate/);
});

test('the session rules in AGENTS.student.md carry the same two rules and the file stays under 8192 bytes', () => {
  const text = readFileSync(join(PACK_ROOT, 'AGENTS.student.md'), 'utf8');
  assert.match(text, /license or credential the student will not hold by the posting's start date is FAIL/);
  assert.match(text, /Score every row on its own text, never with one estimate shared across rows/);
  assert.ok(Buffer.byteLength(text) < 8192, String(Buffer.byteLength(text)));
});
