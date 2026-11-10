// Final apply on an existing config/profile.yml (merge of the application_answers block only) and mergeProfileAnswers edge cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as yaml from 'js-yaml';
import { mergeProfileAnswers, ProfileParseError } from '../../lib/profile-answers.mjs';
import { apply, finalAnswers, EEO_FAKE, scratch } from '../helpers/profile-harness.mjs';

const BEFORE = ['# my own profile, hand edited', 'candidate:', '  full_name: "Pat Existing"', '  email: pat.existing@example.edu', ''].join('\n');
const OLD_BLOCK = ['application_answers:', '  work_authorization: Old auth', '  custom_note: keep me', '  eeo:', '    gender: old-gender', '    pronouns: old-pron'].join('\n');
const AFTER = ['target_roles:', '  primary:', '    - Old role', '# trailing comment', ''].join('\n');

// M-003-S11-cdel
test('M-003-S11-cdel final apply on an existing profile.yml replaces only application_answers, merges old keys under the new answers and writes mailbox.schedule', () => {
  const r = scratch();
  try {
    r.write('config/profile.yml', `${BEFORE}${OLD_BLOCK}\n${AFTER}`);
    const res = apply(r, finalAnswers({ inbox_schedule: 'on', automation: 'scheduled-discovery-plus-triage', mailbox_backend: 'connector' }));
    assert.equal(res.code, 0, res.text);
    const text = r.read('config/profile.yml');
    assert.ok(text.startsWith(BEFORE), 'bytes before the block unchanged');
    assert.ok(text.endsWith(AFTER), 'bytes after the block unchanged');
    const doc = yaml.load(text);
    assert.equal(doc.candidate.full_name, 'Pat Existing');
    const a = doc.application_answers;
    assert.equal(a.work_authorization, 'US citizen');
    assert.equal(a.requires_sponsorship, false);
    assert.equal(a.start_date, '2027-06');
    assert.equal(a.relocation, 'within-locations');
    assert.equal(a.how_did_you_hear, 'University career fair');
    assert.deepEqual(a.eeo, EEO_FAKE);
    assert.equal(a.custom_note, 'keep me', 'old key outside the new answers survives');
    assert.match(res.stdout, /config\/profile\.yml kept; application_answers updated \(\d+ keys\)/);
    assert.equal(yaml.load(r.read('config/student.yml')).mailbox.schedule, 'on');
  } finally {
    r.cleanup();
  }
});

// M-003-S17-cdel
test('M-003-S17-cdel mergeProfileAnswers replaces a flow-style application_answers line and keeps every byte around it', () => {
  const text = 'name: a\napplication_answers: {work_authorization: old, start_date: immediately}\nother: 1\n';
  const out = mergeProfileAnswers(text, { work_authorization: 'US citizen' });
  assert.ok(out.startsWith('name: a\n'));
  assert.ok(out.endsWith('other: 1\n'));
  assert.equal(out.split('application_answers:').length - 1, 1, 'one application_answers key');
  const doc = yaml.load(out);
  assert.equal(doc.application_answers.work_authorization, 'US citizen');
  assert.equal(doc.application_answers.start_date, 'immediately');
  assert.equal(doc.other, 1);
});

// M-003-S17-cdel
test('M-003-S17-cdel mergeProfileAnswers replaces a block with deeper lines and keeps the column-0 comment and every byte outside', () => {
  const text = 'name: a\napplication_answers:\n  work_authorization: old\n  eeo:\n    gender: decline\n    veteran: no\n# keep this comment\nother: 1\n';
  const out = mergeProfileAnswers(text, { start_date: '2027-06', eeo: { pronouns: 'fake-pron-d' } });
  assert.ok(out.startsWith('name: a\n'));
  assert.ok(out.endsWith('# keep this comment\nother: 1\n'));
  const doc = yaml.load(out);
  assert.deepEqual(doc.application_answers, { work_authorization: 'old', start_date: '2027-06', eeo: { gender: 'decline', veteran: 'no', pronouns: 'fake-pron-d' } });
  assert.equal(doc.other, 1);
});

// M-003-S17-cdel
test('M-003-S17-cdel mergeProfileAnswers appends the block when absent and replaces a legacy eeo string only when the patch has eeo items', () => {
  const absent = 'name: a\n';
  const appended = mergeProfileAnswers(absent, { start_date: 'immediately' });
  assert.ok(appended.startsWith(absent));
  assert.deepEqual(yaml.load(appended).application_answers, { start_date: 'immediately' });
  const legacy = 'application_answers:\n  eeo: leave-blank\n';
  assert.equal(yaml.load(mergeProfileAnswers(legacy, { start_date: '2027-06' })).application_answers.eeo, 'leave-blank');
  assert.deepEqual(yaml.load(mergeProfileAnswers(legacy, { eeo: { gender: 'decline' } })).application_answers.eeo, { gender: 'decline' });
});

// M-003-S18-cdel
for (const [label, text] of [
  ['does not parse', 'candidate: [unclosed\napplication_answers:\n  start_date: immediately\n'],
  ['holds two application_answers keys', 'application_answers:\n  start_date: immediately\ncandidate:\n  full_name: X\napplication_answers:\n  relocation: no\n'],
]) {
  test(`M-003-S18-cdel final apply exits 1 and leaves profile.yml byte-identical when it ${label}`, () => {
    const r = scratch();
    try {
      r.write('config/profile.yml', text);
      const res = apply(r, finalAnswers());
      assert.equal(res.code, 1, res.text);
      assert.match(res.stderr, /config\/profile\.yml does not parse: .+; fix it or move it aside/);
      assert.equal(r.read('config/profile.yml'), text, 'profile.yml byte-identical');
      assert.ok(!r.exists('config/student.yml'), 'nothing written before the stop');
      assert.ok(!r.exists('portals.yml') && !r.exists('cv.md'), 'no other file written');
    } finally {
      r.cleanup();
    }
  });
}

// M-003-S18-cdel
test('M-003-S18-cdel mergeProfileAnswers throws ProfileParseError for text that does not parse or holds two application_answers keys', () => {
  assert.throws(() => mergeProfileAnswers('candidate: [unclosed\n', { start_date: 'immediately' }), ProfileParseError);
  assert.throws(() => mergeProfileAnswers('application_answers:\n  a: 1\napplication_answers:\n  b: 2\n', { start_date: 'immediately' }), ProfileParseError);
});
