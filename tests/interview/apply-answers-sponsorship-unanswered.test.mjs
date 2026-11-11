// An unanswered sponsorship question is saved as unset, so profile-answers lists it instead of treating it as "no".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as yaml from 'js-yaml';
import { needsConfirmation, CANONICAL_KEYS } from '../../lib/profile-answers.mjs';
import { apply, finalAnswers, scratch } from '../helpers/profile-harness.mjs';

test('extra check: needs_sponsorship left unanswered leaves requires_sponsorship unset and listed for confirmation', () => {
  const r = scratch();
  try {
    const answers = finalAnswers();
    delete answers.needs_sponsorship;
    const res = apply(r, answers);
    assert.equal(res.code, 0, res.text);
    const saved = yaml.load(r.read('config/profile.yml')).application_answers;
    assert.ok(CANONICAL_KEYS.includes('requires_sponsorship'));
    assert.equal('requires_sponsorship' in saved, false);
    assert.ok(needsConfirmation(saved).includes('requires_sponsorship'));
  } finally {
    r.cleanup();
  }
});
