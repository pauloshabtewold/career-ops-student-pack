// An answers file saved before the two newer EEO items existed must still validate, so an update never breaks a finished
// interview; needs_confirmation is what asks the student for the missing items.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateAgainst } from '../../interview/apply-answers.mjs';

const schema = JSON.parse(readFileSync(new URL('../../interview/answers.schema.json', import.meta.url), 'utf8'));
const eeoSchema = schema.properties.application_profile.properties.eeo;

const six = { gender: 'decline', race_ethnicity: 'decline', hispanic_latino: 'decline', veteran: 'decline', disability: 'decline', pronouns: 'decline' };

test('EEO-OPT-1 a six-item eeo map from an older interview still validates', () => {
  assert.deepEqual(validateAgainst(eeoSchema, six), []);
});

test('EEO-OPT-2 the eight-item eeo map validates too', () => {
  assert.deepEqual(validateAgainst(eeoSchema, { ...six, sexual_orientation: 'decline', transgender: 'decline' }), []);
});
