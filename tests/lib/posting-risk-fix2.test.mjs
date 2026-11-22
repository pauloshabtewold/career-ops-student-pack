// lib/posting-risk.mjs, second fix round: "signal" counts as the Signal messenger only in a contact context, the
// fake-check equipment scam and an imperative fee are caught again, "reimbursed after" no longer flags travel, parking or
// transit lines, and two initials must match a domain label whole. Fake companies and fake numbers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riskRules } from '../../lib/posting-risk.mjs';

const co = 'Example Radio Systems';
const rules = (text, company = co) => riskRules({ text, company });

test('signal as a technical word is not a chat app; Signal the messenger in a contact context still is', () => {
  assert.deepEqual(rules('This role focuses only on RF signal processing and antenna design.'), []);
  assert.deepEqual(rules('Experience with mixed-signal design only; no software role.'), []);
  assert.deepEqual(rules('You will work not only on firmware but also on digital signal processing pipelines.'), []);
  assert.ok(rules('Contact the recruiter only via Signal.').includes('scam-chat-only'));
  assert.ok(rules('Interviews are held exclusively on the Signal app.').includes('scam-chat-only'));
  assert.ok(rules('Reach the hiring desk at Signal @hiringdesk only.').includes('scam-chat-only'));
});

test('the fake-check equipment scam and an imperative fee give scam-payment', () => {
  for (const text of [
    'We will send you a check to buy your home office equipment from our approved vendor.',
    'You will receive a check; deposit it and buy equipment from our vendor.',
    'We will mail you a cashier check. Deposit the check and send the balance to our supplier.',
    'Pay a $60 registration fee to start training.',
    'Buy the starter kit from our partner before training.',
  ]) assert.ok(rules(text).includes('scam-payment'), text);
  assert.deepEqual(rules('Pay ranges from $20 to $30 per hour.'), []);
  assert.deepEqual(rules('We pay for your background check and provide all equipment.'), []);
});

test('reimbursed-after flags bought equipment, not interview travel, parking or transit', () => {
  for (const text of [
    'Book and pay for your travel to the onsite interview; we reimburse you after the visit.',
    'Interns must purchase their own parking permit; we reimburse it after the first month.',
    'Students must purchase a transit pass before your first day; it is reimbursed monthly.',
  ]) assert.deepEqual(rules(text), [], text);
  assert.ok(rules('Buy the required software license and get reimbursed after your first month.').includes('scam-payment'));
});

test('two initials must match the whole domain label; three may start it', () => {
  const apply = (email, company) => rules(`Send your resume to ${email} to apply.`, company);
  assert.ok(apply('jobs@corp-hiring.example.com', 'Capital One').includes('scam-domain'));
  assert.ok(apply('apply@gm-careers-hiring.example.com', 'General Motors').includes('scam-domain'));
  assert.deepEqual(apply('jobs@gm.example.com', 'General Motors'), []);
  assert.deepEqual(apply('accommodations@euh.example.com', 'Example University Hospital'), []);
});
