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
