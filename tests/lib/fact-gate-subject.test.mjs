// lib/fact-gate.mjs check(): the posting grounds a sentence only when its subject is you/your/the company and it carries
// no experience words. A student claim with no "I" (a role-title sentence, a company-subject sentence about years of
// work) is grounded by cv.md and the answers only. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../../lib/fact-gate.mjs';

const CV = '# Jordan Testwell\n- Software Intern, Example Robotics: built a Python scheduling tool\nSkills: Python, SQL\n';
const POSTING = 'Acme uses Tableau, Snowflake and Looker and wants 3 years of SQL. Your analytics team reports weekly.';
const SRC = { cv: CV, answers: {}, posting: POSTING, company: 'Acme', role: 'Data Analyst Intern' };
const lower = (xs) => xs.map((x) => x.toLowerCase()).sort();

test('a student claim without a first-person pronoun is grounded by cv.md only, not the posting', () => {
  assert.deepEqual(lower(check('With 3 years of Tableau and Snowflake work, your analytics team is where this experience fits.', SRC)), ['3', 'snowflake', 'tableau']);
  assert.deepEqual(lower(check('The Data Analyst Intern role fits 3 years of hands-on Tableau work.', SRC)), ['3', 'tableau']);
  assert.deepEqual(lower(check('Acme gets an analyst with 3 years of Looker work.', SRC)), ['3', 'looker']);
});

test('a statement about the company whose subject is your team or the company still uses the posting', () => {
  assert.deepEqual(check('Your team uses Tableau for reporting.', SRC), []);
  assert.deepEqual(check('Acme uses Snowflake and Looker.', SRC), []);
  assert.deepEqual(check('The company uses Tableau.', SRC), []);
});

test('the role title alone never makes a sentence about the company', () => {
  assert.deepEqual(lower(check('The Data Analyst Intern role uses Tableau.', SRC)), ['tableau']);
});

test('a real cv-grounded claim passes, with or without "I"', () => {
  assert.deepEqual(check('At Example Robotics I built a Python scheduling tool.', SRC), []);
  assert.deepEqual(check('A Python scheduling tool built at Example Robotics is the closest match to the Data Analyst Intern role.', SRC), []);
  assert.deepEqual(check('I want to join Acme as a Data Analyst Intern.', SRC), []);
});

test('the role title grounds only as the target role name; a claim to have held it needs the title in cv.md', () => {
  const claims = ['I worked as a Data Analyst Intern at Example Robotics.', 'As a former Data Analyst Intern, I know weekly reporting.', 'My time as Data Analyst Intern taught me Python.'];
  for (const s of claims) assert.deepEqual(check(s, SRC), ['Data Analyst Intern'], s);
  const held = { ...SRC, cv: `${CV}- Data Analyst Intern, Example Robotics, Jun 2025 - Aug 2025\n` };
  for (const s of claims) assert.deepEqual(check(s, held), [], s);
  assert.deepEqual(check('I am applying for the Data Analyst Intern role.', SRC), []);
  assert.deepEqual(check('I would love to work as a Data Analyst Intern at Acme.', SRC), []);
});

// Review r2 (MUST-1, MUST-2, S-C): the posting grounds only a strict company-needs sentence; the company name and role
// title ground nothing but themselves; number words with a unit are numbers.
const POSTING2 = 'Acme uses Tableau, Snowflake and Looker and wants 3 years of SQL, 25% growth, 40 dashboards. Your analytics team reports weekly. Data Analyst Intern.';
const SRC2 = { ...SRC, posting: POSTING2 };
const flagged = (s, src) => assert.ok(check(s, src).length > 0, `not flagged: ${s}`);

test('MUST-1: a company-subject sentence that describes the student is not grounded by the posting', () => {
  for (const s of [
    'Your team gets an analyst fluent in Tableau and Snowflake.',
    'Acme gains a Tableau specialist with 40 dashboards to show.',
    'You can expect a 25% lift in report speed from this candidate.',
    'Your team needs Tableau, which this applicant has used daily.',
    'Your posting asks for Tableau, and that is exactly what this applicant brings.',
    'The company will find this candidate strong in Tableau.',
    'Your Data Analyst Intern will arrive with Tableau fluency.',
  ]) flagged(s, SRC2);
});

test('MUST-2: the role title and company name never ground a skill or tool claim', () => {
  const role = { ...SRC, posting: 'Acme wants Tableau.', role: 'Tableau Developer Intern' };
  assert.deepEqual(check('I have hands-on Tableau experience.', role), ['Tableau']);
  assert.deepEqual(check('Tableau is my strongest tool.', role), ['Tableau']);
  assert.deepEqual(lower(check('I bring two years of Tableau work.', role)), ['tableau', 'two']);
  const company = { ...role, company: 'Snowflake', role: 'Data Analyst Intern' };
  assert.deepEqual(check('I have built pipelines in Snowflake.', company), ['Snowflake']);
});

test('S-C: number words with a unit are numbers grounded by cv.md only', () => {
  assert.deepEqual(check('I have three years of SQL experience.', SRC2), ['three']);
  assert.deepEqual(check('I bring two years of Python work at Example Robotics.', SRC2), ['two']);
  assert.deepEqual(check('I have three years of SQL experience.', { ...SRC2, cv: `${CV}- SQL, 3 years\n` }), []);
});

test('controls: a company-needs sentence, a cv-grounded claim and the role name pass', () => {
  assert.deepEqual(check('Your team uses Tableau for reporting.', SRC2), []);
  assert.deepEqual(check('Acme relies on Snowflake.', SRC2), []);
  assert.deepEqual(check('I built SQL reports for 3 teams.', { ...SRC2, cv: `${CV}- built SQL reports for 3 teams\n` }), []);
  assert.deepEqual(check('I am applying for the Tableau Developer Intern role.', { ...SRC2, role: 'Tableau Developer Intern' }), []);
  assert.deepEqual(check('I was excited to apply as a Data Analyst Intern.', SRC2), []);
});

test('fuzz: adversarial paraphrases of invented skills, numbers and titles are all flagged', () => {
  const cases = [
    'Tableau dashboards were built by this candidate.',
    'Snowflake pipelines were maintained daily in my last role.',
    'This candidate knows Tableau inside and out.',
    'Proven Tableau skills make me a fit.',
    'Proven Looker skills are what you get.',
    'Skills I bring: Tableau, Snowflake.',
    'Here is what your team gets: an analyst fluent in Tableau.',
    'Your team gets an analyst fluent in: Tableau, Snowflake.',
    'I have spent a couple of years on SQL reporting.',
    'I bring a dozen dashboards from coursework.',
    'Over twelve months of Python work shaped how I code.',
    'I improved report speed by twenty percent.',
    'Your team needs Tableau; this applicant has it.',
    'You need someone who knows Looker.',
    'Acme seeks Tableau, which I use every week.',
    'The company uses Tableau, and I have 2 years of it.',
    'Acme uses Snowflake, used daily by the person writing this.',
    'You can count on Tableau fluency from day one.',
    'Acme\u2019s next intern knows Tableau.',
    'I held the title of Data Analyst Intern at Example Robotics.',
    'I served as a Tableau Developer Intern last summer.',
  ];
  const src = { ...SRC2, posting: `${POSTING2} Tableau Developer Intern.` };
  for (const s of cases) flagged(s, s.includes('Tableau Developer Intern') ? { ...src, role: 'Tableau Developer Intern' } : src);
  assert.ok(cases.length >= 15);
});
