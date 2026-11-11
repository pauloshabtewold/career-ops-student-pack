// modes/apply-loop.md reads saved application answers first, gathers unknown fields into one list and keeps EEO values out of text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const md = readFileSync(join(PACK_ROOT, 'modes', 'apply-loop.md'), 'utf8');

// M-003-S15-cdel
test('M-003-S15-cdel apply-loop runs profile-answers show, fills from saved answers, gathers unknown fields into one list, saves with set and keeps EEO out of reports', () => {
  const rowAt = md.indexOf('## For each row');
  const showAt = md.indexOf('node student/scripts/profile-answers.mjs show --json');
  const setAt = md.indexOf('node student/scripts/profile-answers.mjs set <key> "<value>"');
  assert.ok(rowAt >= 0, 'For each row section present');
  assert.ok(showAt > rowAt, 'show --json runs inside the For each row steps');
  assert.ok(setAt > showAt, 'set runs after show');
  const filling = md.slice(showAt, setAt);
  for (const field of [/work authorization/i, /sponsorship/i, /start date/i, /relocation/i, /how did you hear/i, /gender/i, /race or ethnicity/i, /hispanic or latino/i, /veteran/i, /disability/i, /pronouns/i]) {
    assert.match(filling, field, `fills ${field}`);
  }
  assert.match(filling, /decline/i, 'decline picks the form decline option');
  assert.match(filling, /needs_confirmation/, 'a field in needs_confirmation is left blank');
  assert.match(filling, /needs your answer/i, 'one needs-your-answer list');
  assert.match(filling, /filled batch/i, 'shown with the filled batch');
  assert.match(md, /EEO values never go into reports, digests, logs, notes or messages/);
  assert.match(md, /application_answers/, 'fact gate names application_answers');
  assert.match(md, /"submit all" or "submit 1,3"/);
});

test('apply-loop matches fields by the question asked, not a keyword, and never guesses an uncovered field', () => {
  assert.match(md, /by the question it asks, not by a keyword it contains \("transgender" is not "gender"\)/);
  assert.match(md, /no saved key covers is left blank and added to the one list of unanswered fields shown with the batch, never guessed/);
  assert.match(md, /sexual orientation and transgender/);
});
