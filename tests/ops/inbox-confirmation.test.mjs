// Assumed: classify(message, ctx) checks interview and scheduling wording before confirmation wording, and a
// conditional interview mention ("if selected", "should you be selected", "may contact you") stays ignore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../../scripts/inbox.mjs';

const ctx = { assessmentDomains: [], companies: [{ name: 'Fabrikam Labs', domains: ['fabrikamlabs.example.com'] }] };
const mail = (id, subject, snippet) => ({ id, from: 'no-reply@fabrikamlabs.example.com', subject, snippet, date: '2026-10-26T15:00:00.000Z' });

// M-002-S13
test('M-002-S13 a thanks-for-applying mail that asks for interview times is classified interview', () => {
  const m = mail('c-1', 'Thanks for applying', 'Thank you for applying to Fabrikam Labs. Please send a few times that work for an interview next week.');
  const res = classify(m, ctx);
  assert.equal(res.kind, 'interview');
  assert.equal(res.company, 'Fabrikam Labs');
});

// M-002-S13
test('M-002-S13 an automated confirmation that also asks for call availability is classified scheduling', () => {
  const m = mail('c-2', 'We received your application', 'This is an automated message. Please reply with your availability for a phone screen.');
  assert.equal(classify(m, ctx).kind, 'scheduling');
});

// M-002-S14
test('M-002-S14 a confirmation that mentions an interview only conditionally stays ignore', () => {
  for (const [i, text] of [
    'Thank you for applying. If selected, we may contact you to schedule an interview.',
    'We received your application. Should you be selected, a recruiter may contact you about an interview.',
    'Thanks for applying to Fabrikam Labs. We may contact you to schedule an interview if your background fits.',
  ].entries()) {
    assert.equal(classify(mail(`c-3${i}`, 'Application received', text), ctx).kind, 'ignore', text);
  }
});

// M-002-S14
test('M-002-S14 a plain automated confirmation stays ignore', () => {
  const m = mail('c-4', 'We received your application', 'Thank you for applying. This is an automated confirmation; please do not reply.');
  assert.equal(classify(m, ctx).kind, 'ignore');
});
