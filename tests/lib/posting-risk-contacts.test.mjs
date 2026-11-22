// lib/posting-risk.mjs on postings with emails, employer-paid equipment and chat-app lines: accommodation, EEO, benefits
// and privacy emails, an unknown company, "we pay for your equipment" and an optional WhatsApp line give no scam rule; a
// student asked to buy with their own funds and be reimbursed later, or a chat-app-only contact, still does. Fake
// companies and example.com subdomains only (tests/fixtures/quality/postings-risk/legit-contacts.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { riskRules, REPOST_MAX, AGE_DAYS_MAX } from '../../lib/posting-risk.mjs';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/quality/postings-risk/legit-contacts.json', import.meta.url), 'utf8'));
const scamRules = (p) => riskRules({ text: p.text, company: p.company }).filter((r) => r.startsWith('scam'));

test('legitimate postings with HR emails, employer-paid equipment and optional chat lines give no scam rule', () => {
  for (const p of fixtures.legit) assert.deepEqual(scamRules(p), [], p.text);
});

test('a student asked to pay or buy, or a chat-app-only contact, still gives a scam rule', () => {
  for (const p of fixtures.scam) assert.notDeepEqual(scamRules(p), [], p.text);
  const holdout = 'Purchase your laptop and printer from our approved vendor with your own funds; we reimburse you after your first check.';
  assert.ok(riskRules({ text: holdout, company: 'Sample Labs' }).includes('scam-payment'));
});

test('an application email on a domain unrelated to the company still gives scam-domain', () => {
  assert.ok(riskRules({ text: 'Send your resume and ID to hiring@fast-jobs-desk.example.com to be hired today.', company: 'Example Robotics' }).includes('scam-domain'));
});

test('the ghost rule fires only above both thresholds', () => {
  const ghost = (repostCount, ageDays) => riskRules({ text: 'Intern.', company: 'Example Robotics', repostCount, ageDays }).includes('ghost-stale-repost');
  assert.equal(ghost(REPOST_MAX, AGE_DAYS_MAX + 30), false);
  assert.equal(ghost(REPOST_MAX + 1, AGE_DAYS_MAX), false);
  assert.equal(ghost(REPOST_MAX + 1, AGE_DAYS_MAX + 1), true);
});
