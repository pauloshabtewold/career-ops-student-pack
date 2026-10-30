import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const interview = readFileSync(new URL('../../interview/interview.md', import.meta.url), 'utf8');

// W-021-S11: the NYC Jobs feed is opt-in, offered only to policy-government students, behind the capability card and --confirm.
test('W-021-S11 the interview offers nyc-jobs to policy-government students and enables it only with --confirm after a yes', () => {
  const step = interview.split('\n').find((l) => /enable nyc-jobs/.test(l));
  assert.ok(step, 'no nyc-jobs enable step');
  assert.match(step, /policy-government/);
  assert.match(step, /node plugins\.mjs enable nyc-jobs/);
  assert.match(step, /--confirm` only after the student says yes/);
  assert.match(step, /stays off/);
});
