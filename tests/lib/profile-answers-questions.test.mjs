// The application_answers questions map: profile-answers learn saves a question once and a later form with the same
// question (different case and punctuation) is filled without listing it as unknown. Fake values only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as yaml from 'js-yaml';
import { profileAnswers, scratch } from '../helpers/profile-harness.mjs';

const HEAD = '# hand edited\ncandidate:\n  full_name: "Jordan Testwell"\n  email: "jordan.testwell@example.com"\n';
const BLOCK = ['application_answers:', '  work_authorization: US citizen', '  requires_sponsorship: false', '  eeo:', '    gender: fake-gender-a'].join('\n');
const TAIL = 'target_roles:\n  primary:\n    - Fake role\n';
const QUESTION = 'Why do you want to work here?';
const ANSWER = 'Fake reason about the team';
const labelOf = (u) => (typeof u === 'string' ? u : u?.label ?? u?.question ?? '');

// M-002-S3-osdr
test('M-002-S3-osdr an answer saved once with profile-answers learn fills the same question on a second form without asking', async () => {
  const { normalize, matchQuestion } = await import('../../lib/profile-answers.mjs');
  const { resolveFields } = await import('../../scripts/fill-plan.mjs');
  assert.equal(normalize('  WHY do you want to work here?!  '), 'why do you want to work here');

  const r = scratch();
  try {
    r.write('config/profile.yml', `${HEAD}${BLOCK}\n${TAIL}`);
    const learned = profileAnswers(r, ['learn', QUESTION, ANSWER]);
    assert.equal(learned.code, 0, learned.text);
    const text = r.read('config/profile.yml');
    assert.ok(text.startsWith(HEAD), 'bytes before the block unchanged');
    assert.ok(text.endsWith(TAIL), 'bytes after the block unchanged');
    const answers = yaml.load(text).application_answers;
    assert.equal(answers.questions['why do you want to work here'], ANSWER);
    assert.equal(answers.work_authorization, 'US citizen');

    const variant = 'why do you want to WORK here';
    assert.equal(matchQuestion(answers, variant), ANSWER);
    const match = profileAnswers(r, ['match', 'Why do you want to work here!!']);
    assert.equal(match.code, 0, match.text);
    assert.ok(match.stdout.includes(ANSWER), match.text);

    const form = { url: 'https://jobs.lever.co/examplerobotics/abc-123/apply', fields: [{ label: variant, name: 'cards[0][field0]', type: 'textarea' }] };
    const candidate = { full_name: 'Jordan Testwell', email: 'jordan.testwell@example.com', phone: '555-0100' };
    const res = await resolveFields(form, { answers, candidate, headless: () => assert.fail('no agent call') });
    assert.deepEqual((res.unknown ?? []).map(labelOf), [], 'the saved question is not asked again');
    const filled = (res.fields ?? []).find((f) => f.label === variant || f.name === 'cards[0][field0]');
    assert.equal(filled?.value, ANSWER);
  } finally {
    r.cleanup();
  }
});
