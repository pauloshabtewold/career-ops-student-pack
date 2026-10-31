import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const interview = readFileSync(new URL('../../interview/interview.md', import.meta.url), 'utf8');

// W-022-U10: the USAJOBS feed is opt-in, needs the student's own key, and is enabled only with --confirm after a yes.
test('W-022-U10 the interview offers usajobs to policy-government students, needs their own key and never requests one', () => {
  const step = interview.split('\n').find((l) => /enable usajobs/.test(l));
  assert.ok(step, 'no usajobs enable step');
  assert.match(step, /policy-government/);
  assert.match(step, /developer\.usajobs\.gov/);
  assert.match(step, /USAJOBS_API_KEY and USAJOBS_EMAIL in your \.env yourself/);
  assert.match(step, /node plugins\.mjs enable usajobs/);
  assert.match(step, /--confirm` only after the student says yes/);
  assert.match(step, /without a key in `\.env`, the USAJOBS feed stays off/);
  assert.match(step, /never requests the key for them/);
});
