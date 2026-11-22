// lib/jd-rules.mjs, second fix round: years count only when they are years of experience (school, study, commitment and
// residency years pass), a requirement verb before the number outweighs a blurb word ("We require", "We are looking
// for"), and a multi-city posting location is read as all of its places. Fake text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jdRule, locationMismatch, requiredYears, studentFromConfig } from '../../lib/jd-rules.mjs';

const entry = studentFromConfig({});

test('years of study, commitment and residency are not experience and fail no row', () => {
  for (const text of [
    'Must have completed at least 3 years of undergraduate study.',
    'Applicants must have 3+ years of college coursework completed.',
    'This is a 3+ year commitment to the rotational program.',
    'Minimum 3 years of study in a STEM major.',
    'Must have lived in the US 3+ years.',
  ]) {
    assert.equal(requiredYears(text), 0, text);
    assert.equal(jdRule({ text, location: '' }, entry), null, text);
  }
});

test('a requirement verb before the number counts; company blurbs still do not', () => {
  assert.equal(requiredYears('We require 15+ years of experience managing global programs.'), 15);
  assert.equal(requiredYears('We are looking for 5+ years of experience in Java.'), 5);
  assert.equal(requiredYears('Requires 15+ years of experience.'), 15);
  assert.equal(requiredYears('Requirements for this role: 5+ years of experience.'), 5);
  assert.equal(requiredYears('Requirements: 5+ years of Python.'), 5);
  assert.equal(requiredYears('Our team has 10+ years of history.'), 0);
  assert.equal(requiredYears('Example Health has over 20 years of experience helping hospitals.'), 0);
  assert.equal(requiredYears('Join a team with 10+ years of industry experience.'), 0);
});

test('a senior years requirement on an entry student gives a rule named years', () => {
  const rule = jdRule({ text: 'We require 15+ years of experience managing global programs.', location: '' }, entry);
  assert.match(String(rule), /years/);
});

test('a multi-city posting is read as all of its places', () => {
  for (const place of ['Austin, TX, Seattle, WA', 'Austin, TX and Seattle, WA', 'Austin, TX & Seattle, WA', 'Austin, TX & New York, NY', 'Seattle, WA; Austin, TX']) {
    assert.equal(locationMismatch(place, '', ['Austin, TX']), null, place);
  }
  assert.equal(locationMismatch('Seattle, WA, Boston, MA', '', ['Austin, TX']), 'location');
  assert.equal(locationMismatch('Portland, OR', '', ['Austin, TX']), 'location', 'OR is Oregon, not a separator');
  assert.equal(locationMismatch('Austin, TX & Seattle, WA', 'Fully remote role.', ['Denver, CO']), null, 'remote still passes');
  assert.equal(locationMismatch('Austin, TX, Toronto, ON', '', ['Denver, CO']), null, 'an unknown place still passes');
});
