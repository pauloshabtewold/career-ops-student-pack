// A profile.yml that does not parse reports a fixed message and the line number, never a snippet of the file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileParseError, mergeProfileAnswers } from '../../lib/profile-answers.mjs';
import { profileAnswers, scratch } from '../helpers/profile-harness.mjs';

const SECRET = 'fake-race-secret-b';
const BROKEN = `candidate:\n  full_name: "Pat Existing"\napplication_answers:\n  eeo:\n    race_ethnicity: ${SECRET}\n  bad: [unclosed\n`;

for (const args of [['show'], ['set', 'start_date', '2027-06']]) {
  test(`extra check: profile-answers ${args[0]} on a broken file prints the line number and no file text`, () => {
    const r = scratch();
    try {
      r.write('config/profile.yml', BROKEN);
      const res = profileAnswers(r, args);
      assert.equal(res.code, 1, res.text);
      assert.match(res.text, /config\/profile\.yml does not parse: YAML syntax error at line \d+; fix it or move it aside/);
      assert.ok(!res.text.includes(SECRET), 'no file value in the output');
      assert.ok(!res.text.includes('unclosed'), 'no file snippet in the output');
    } finally {
      r.cleanup();
    }
  });
}

test('extra check: ProfileParseError from the lib carries no file text', () => {
  assert.throws(
    () => mergeProfileAnswers(BROKEN, { start_date: '2027-06' }),
    (err) => err instanceof ProfileParseError && /^YAML syntax error at line \d+$/.test(err.message) && !err.message.includes(SECRET),
  );
});
