// lib/posting-risk.mjs riskRules / isRisky / riskReason: the rules daily-triage runs before the model when T16 is on.
// A posting asking the applicant for a payment or giving only a chat-app contact is risky with rule scam; 50 synthetic
// legitimate postings (pay ranges, provided equipment, careers-site contacts) are not. No model call; fake companies only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const COMPANIES = ['Example Robotics', 'Sample Labs', 'Demo Works', 'Example Analytics', 'Sample Health'];
const ROLES = ['Software Engineering Intern', 'Data Analyst Intern', 'Backend Engineer, New Grad', 'Machine Learning Intern', 'QA Engineering Co-op'];
const DETAILS = [
  'Pay range: $24 to $30 per hour, paid biweekly.',
  'We provide a laptop and all the equipment you need from day one.',
  'Apply through our careers site; a recruiter will email you to schedule interviews.',
  'Hybrid in Austin, TX, three days a week in the office. Relocation support is available.',
  'Benefits include paid holidays, a learning stipend and mentorship from a senior engineer.',
  'You will pair with a small team, ship code to production and present a project at the end of the summer.',
  'Remote within the United States. Competitive pay and a home-office allowance paid by the company.',
  'Questions about the role? Reach the recruiting team through the contact form on our careers page.',
  'Two interview rounds over video: a short technical chat and a project walkthrough.',
  'Open to students graduating between December 2026 and June 2027.',
];

const legit = Array.from({ length: 50 }, (_, i) => {
  const company = COMPANIES[i % COMPANIES.length];
  const role = ROLES[Math.floor(i / COMPANIES.length) % ROLES.length];
  const a = DETAILS[i % DETAILS.length];
  const b = DETAILS[(i * 3 + 1) % DETAILS.length];
  return { company, text: `${role} at ${company}.\nAbout the role: build and test internal tools with Python and SQL.\n${a}\n${b}` };
});

const SCAMS = [
  { company: 'Sample Labs', text: 'Data Entry Intern. Before your first day you must pay a $95 registration fee by wire transfer to secure your spot.' },
  { company: 'Demo Works', text: 'Remote Assistant. Selected candidates must purchase a $250 equipment starter kit from our vendor before onboarding; the cost is reimbursed later.' },
  { company: 'Example Robotics', text: 'Junior Analyst. Interviews are held on Telegram only. Message @hiring_desk_example on Telegram to begin. No email or phone.' },
  { company: 'Example Analytics', text: 'Customer Support Intern. Contact the hiring manager only on WhatsApp at +1 555 0100 for an instant offer.' },
];

// M-003-S6-osdr
test('M-003-S6-osdr with T16 on a posting asking for a payment fails with rule scam while the 50 legitimate fixtures produce no scam fail', async () => {
  const { riskRules, isRisky, riskReason, REPOST_MAX, AGE_DAYS_MAX } = await import('../../lib/posting-risk.mjs');
  assert.equal(REPOST_MAX, 3);
  assert.equal(AGE_DAYS_MAX, 60);
  for (const s of SCAMS) {
    const rules = riskRules({ text: s.text, company: s.company });
    assert.equal(isRisky(rules), true, `${s.text}\n-> ${JSON.stringify(rules)}`);
    assert.match(String(riskReason(rules)), /scam/i, s.text);
  }
  assert.equal(legit.length, 50);
  const flagged = legit.filter((p) => isRisky(riskRules({ text: p.text, company: p.company })));
  assert.deepEqual(flagged.map((p) => p.text), [], 'no legitimate posting fails the scam rules');
});
