// lib/posting-risk.mjs, M-003 fourth fix round: a stipend, budget or allowance does not clear a sentence that also obliges
// the student, names a start-date deadline, names a vendor or asks for a fee, deposit or kit; buying from the employer's
// vendor is a payment ask; a sent check followed by a buy in the same or the next sentence, or by "send the excess back",
// is the fake-check scam. Employer-funded lines with none of those stay clean. Fake companies only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riskRules } from '../../lib/posting-risk.mjs';

const rules = (text) => riskRules({ text, company: 'Example Robotics' });

test('stipend, budget and allowance lines with an obligation, deadline, vendor or fee are scam-payment', () => {
  for (const text of [
    'You must purchase your equipment from our approved vendor before your first day; the cost is covered by your stipend.',
    'Your training budget requires you to pay a $75 certification fee before onboarding.',
    'Pay a $60 registration fee; it is deducted from your stipend later.',
    'New hires must buy the software license before starting; your allowance reimburses it after 30 days.',
    'You will receive an equipment stipend after you purchase the required laptop from our approved vendor.',
  ]) assert.ok(rules(text).includes('scam-payment'), text);
});

test('a sent check spent in the same or the next sentence, or sent back, is scam-payment', () => {
  for (const text of [
    'We will mail you a check. Deposit it and purchase the software from the link we send you.',
    'We will send you a check to buy equipment from the vendor we assign.',
    'Deposit the check and send the excess back to us.',
  ]) assert.ok(rules(text).includes('scam-payment'), text);
});

test('employer-funded spending with no obligation, deadline, vendor or fee stays clean', () => {
  for (const text of [
    'Purchase the equipment you need with your $1,000 home-office stipend.',
    'Interns get a check-in with mentors weekly and a budget to buy books.',
    'You will receive a check for your equipment stipend with your first paycheck.',
    'You will receive a check for your $500 stipend to buy home-office equipment.',
  ]) assert.deepEqual(rules(text), [], text);
});
