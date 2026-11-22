// lib/posting-risk.mjs, M-003 fifth fix round: after a sent check, a bare buy counts only once the check is deposited,
// cashed or cleared, or when the buy is from a place the employer names, so bonus, tuition and benefit checks stay clean.
// Passive purchases, "paid by each trainee", a vendor named before the verb, "the employer's vendor", "must then
// purchase" and "forward the remaining funds" are payment asks; "buy the monitor you like; we reimburse it after you
// submit the receipt" is a benefit. Fake companies only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riskRules } from '../../lib/posting-risk.mjs';

const rules = (text) => riskRules({ text, company: 'Example Robotics' });

test('a check next to a bare buy, and a receipt reimbursement for an item the student picks, give no rule', () => {
  for (const text of [
    'You will get a check for $500 to buy home-office equipment.',
    'You will receive a check for your $2,000 signing bonus within 30 days. Employees may purchase company stock at a 15% discount.',
    'You will get a check each semester for tuition. Purchase textbooks as needed.',
    'We will send you a check for the signing bonus. You can also purchase discounted gym memberships.',
    'Interns get a check for the housing stipend each month. You can buy discounted transit passes through our benefits portal.',
    'You will receive a check for your relocation bonus. Buy what you need for the move.',
    'Buy the monitor you like; we reimburse it after you submit the receipt.',
  ]) assert.deepEqual(rules(text), [], text);
});

test('a deposited, cashed or cleared check spent on a buy, or a buy from a place the employer names, is scam-payment', () => {
  for (const text of [
    'We will mail you a check. Deposit it and purchase the software from the link we send you.',
    'We will send you a check to buy equipment from the vendor we assign.',
    'Deposit the check and send the excess back to us.',
    'We will mail you a check. After it clears, you will purchase the software.',
    'We will mail you a check for your equipment stipend. Purchase the laptop from the store we name.',
  ]) assert.ok(rules(text).includes('scam-payment'), text);
});

test('passive, vendor-first, employer-vendor, must-then and forward-the-funds asks are scam-payment', () => {
  for (const text of [
    'Equipment must be purchased from our approved vendor before your first day.',
    'The laptop has to be bought from our designated supplier using your stipend.',
    'A $75 certification fee is paid by each trainee before onboarding.',
    'From our approved vendor you will purchase the laptop, paid back by your stipend.',
    "Purchase the laptop from the employer's vendor.",
    "You will buy the laptop from the employer's vendor using your stipend.",
    'We will send you a cheque; deposit it and forward the remaining funds to the IT supplier.',
    'You will receive an equipment stipend. You must then purchase the laptop and software.',
    'Buy the laptop now; it is reimbursed later.',
  ]) assert.ok(rules(text).includes('scam-payment'), text);
});
