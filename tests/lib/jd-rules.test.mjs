// lib/jd-rules.mjs: the free job-text rules daily-triage runs before any model call. Years count only in a requirement
// form, degree only when the student's level is set and the sentence names one required level, and location only on a
// clear US state mismatch. Fake companies only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jdRule, locationMismatch, requiredDegree, requiredYears, studentFromConfig } from '../../lib/jd-rules.mjs';

test('years: requirement forms count, company blurbs and ages do not', () => {
  assert.equal(requiredYears('Requirements: 6+ years of hands-on Java development.'), 6);
  assert.equal(requiredYears('Requirements: 5+ years of professional software development experience.'), 5);
  assert.equal(requiredYears('You have at least 4 years of experience with Go.'), 4);
  assert.equal(requiredYears('Minimum of 3 years in a lab setting.'), 3);
  assert.equal(requiredYears('7 or more years of backend work.'), 7);
  assert.equal(requiredYears('This role requires 5 years of nursing practice.'), 5);
  assert.equal(requiredYears('3-5 years of relevant industry experience.'), 3);
  assert.equal(requiredYears('Example Health has over 20 years of experience serving hospitals.'), 0);
  assert.equal(requiredYears('Join a team with 10+ years of industry experience.'), 0);
  assert.equal(requiredYears('Sample Labs has built robots for 15 years.'), 0);
  assert.equal(requiredYears('Founded 30 years ago, we have 25+ years of expertise.'), 0);
  assert.equal(requiredYears('You must be at least 18 years of age.'), 0);
  assert.equal(requiredYears('3+ years of Python experience preferred.'), 0);
});

test('degree: either/or and equivalent sentences are skipped', () => {
  assert.equal(requiredDegree("A Bachelor's or Master's degree in Computer Science is required."), null);
  assert.equal(requiredDegree("Master's degree or equivalent experience required."), null);
  assert.equal(requiredDegree("Master's degree in Statistics required."), 'master');
  assert.equal(requiredDegree('PhD required in Physics.'), 'doctorate');
});

test('degree: the rule uses the config level and is off when no level is set', () => {
  const text = "Master's degree in Statistics required.";
  assert.equal(studentFromConfig({}).degree, null);
  assert.equal(studentFromConfig({ degree: 'unset' }).degree, null);
  assert.equal(jdRule({ text, location: '' }, studentFromConfig({})), null);
  assert.equal(jdRule({ text, location: '' }, studentFromConfig({ degree: 'bachelor' })), 'degree');
  assert.equal(jdRule({ text, location: '' }, studentFromConfig({ degree: 'master' })), null);
});

test('location: countries, regions and unknown names pass; a clear state mismatch fails', () => {
  assert.equal(locationMismatch('Austin, TX', '', ['United States']), null);
  assert.equal(locationMismatch('Austin, TX', '', ['USA']), null);
  assert.equal(locationMismatch('Austin, TX', '', ['Remote - US']), null);
  assert.equal(locationMismatch('Palo Alto, CA', '', ['San Francisco Bay Area']), null);
  assert.equal(locationMismatch('Palo Alto, CA', '', ['Bay Area']), null);
  assert.equal(locationMismatch('Jersey City, NJ', '', ['NYC metro']), null);
  assert.equal(locationMismatch('New York, NY', '', ['NYC']), null);
  assert.equal(locationMismatch('Springfield', '', ['Austin, TX']), null);
  assert.equal(locationMismatch('Dallas, TX', '', ['Austin, TX']), null);
  assert.equal(locationMismatch('Seattle, WA', '', ['Austin, TX']), 'location');
  assert.equal(locationMismatch('Boston, Massachusetts', '', ['Texas', 'NYC']), 'location');
  assert.equal(locationMismatch('Seattle, WA; Austin, TX', '', ['Austin, TX']), null);
  assert.equal(locationMismatch('Seattle, WA', 'Hybrid remote: two days a week in the office.', ['Austin, TX']), null);
  assert.equal(locationMismatch('Remote', '', ['Austin, TX']), null);
});

const LEGIT = [
  "Software Engineering Intern at Example Robotics. Example Robotics has over 20 years of experience serving hospitals. Pursuing a Bachelor's or Master's degree in Computer Science is required.",
  'Data Analyst Intern at Sample Labs. Join a team with 10+ years of industry experience. Python and SQL. Location: Austin, TX.',
  "Backend Engineer, New Grad at Demo Works. Bachelor's degree in CS or related experience. Founded 12 years ago.",
  'QA Co-op at Example Analytics. You must be at least 18 years of age. 1+ years of coursework in testing is a plus.',
  "Machine Learning Intern at Sample Health. Currently enrolled in a Bachelor's, Master's, or Ph.D. program. Sample Health has served patients for 40 years.",
];

test('legitimate student postings fail no job-text rule', () => {
  const student = studentFromConfig({ experience_years: 0, locations: ['United States'] });
  for (const text of LEGIT) assert.equal(jdRule({ text, location: 'Austin, TX' }, student), null, text);
});
