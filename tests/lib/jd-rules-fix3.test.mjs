// lib/jd-rules.mjs, M-003 third fix round: a multi-city posting location written with full state names is read as all
// of its states, like the two-letter form. Fake places only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locationMismatch } from '../../lib/jd-rules.mjs';

test('full state names in a multi-city posting are all read', () => {
  for (const place of ['Austin, Texas, Seattle, Washington', 'Austin, Texas and Seattle, Washington', 'Austin, Texas & Seattle, Washington', 'Seattle, Washington, Austin, Texas']) {
    assert.equal(locationMismatch(place, '', ['Austin, TX']), null, place);
  }
  assert.equal(locationMismatch('Seattle, Washington, Boston, Massachusetts', '', ['Austin, TX']), 'location');
  assert.equal(locationMismatch('Washington, DC', '', ['Austin, TX']), 'location');
  assert.equal(locationMismatch('Seattle, Washington Austin, Texas', '', ['Denver, CO']), null, 'an unsplit part with two states passes');
});
