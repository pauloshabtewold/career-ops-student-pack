// lib/posting-risk.mjs, M-003 third fix round: employer-funded spending (a stipend, a budget, "the team covers the cost")
// is not a payment ask, "check-in" is not a check, and a check is the scam only when the student must deposit it and
// spend it at the employer's vendor or send the rest back; a capitalized word after Signal makes it a name. The
// fake-check and fee scams stay caught. Fake companies only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riskRules } from '../../lib/posting-risk.mjs';

const rules = (text) => riskRules({ text, company: 'Example Robotics' });

test('stipend, budget, check-in and a stipend check give no scam rule', () => {
  for (const text of [
    'Purchase the equipment you need with your $1,000 home-office stipend.',
    'Interns get a check-in with mentors weekly and a budget to buy books.',
    'You will receive a check for your equipment stipend with your first paycheck.',
    'Buy the tools you like; the team covers the cost.',
    'Reach the team on Signal Processing Slack via our portal.',
  ]) assert.deepEqual(rules(text), [], text);
});

test('the fake-check scam, fees and own-money purchases are still scam-payment', () => {
  for (const text of [
    'We will send you a check to buy equipment from our vendor.',
    'We will send you a check to buy your home office equipment from our approved vendor.',
    'You will receive a check; deposit it and buy equipment from our vendor.',
    'We will mail you a cashier check. Deposit the check and send the balance to our supplier.',
    'Pay a $60 registration fee to start training.',
    'Purchase the starter kit for $99 before onboarding.',
    'Purchase your laptop and printer from our approved vendor with your own funds; we reimburse you after your first check.',
    'Buy your equipment upfront from our vendor; your equipment budget is paid back later.',
  ]) assert.ok(rules(text).includes('scam-payment'), text);
  assert.ok(rules('Message us on Signal for the interview link.').includes('scam-chat-only'));
});
