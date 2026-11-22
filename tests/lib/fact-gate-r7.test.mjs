// lib/fact-gate.mjs check(), r7: relative clauses next to the company, the role-wish span, more title and year forms,
// requirement headers in markdown and other wordings, posting bullet terms inside first-person claims, and honest first
// drafts. SYNTHETIC FIXTURE: fake people, companies and postings only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../../lib/fact-gate.mjs';

const CV = `# Jordan Sample
jordan.sample@example.com | Example City
## Education
- B.S. Information Systems, Example University, expected May 2026. Coursework: Statistics, Database Systems, Business Analytics
## Experience
- Operations Intern, Example Logistics (June 2025 - August 2025): wrote SQL queries to track shipment delays for the warehouse team; built Excel reports with pivot tables for the operations manager; automated a weekly data pull with a Python script
## Projects
- Class project: analyzed public taxi trip data in Python and presented findings to the class
## Skills
Python, SQL, Excel
`;
const NW = { cv: CV, answers: {}, company: 'Northwind Health', role: 'Data Analyst Intern', posting: `Data Analyst Intern, Summer 2026
Northwind Health is a regional healthcare network serving patients across the state. Our analytics team helps clinicians and leaders make better decisions with data.
Responsibilities:
- Build and maintain Tableau dashboards that track patient wait times and clinic capacity
- Write SQL against our Snowflake data warehouse and help maintain dbt models
- Explore data in Looker and present findings to stakeholders every week
- Document data definitions and support data quality checks
Qualifications:
- Pursuing a bachelor's degree in statistics, information systems, or a related field
- Experience with SQL and Excel; familiarity with Tableau, dbt or Looker is a plus
- Strong communication skills and attention to detail
This is a paid 10-week internship. Northwind Health is an equal opportunity employer.` };

const CV_AVERY = `# Avery Testcase
avery.testcase@example.com | Example Town
## Education
- B.A. Economics, Example College, expected May 2027. Coursework: Statistics, Econometrics, Financial Accounting, Microeconomics
## Experience
- Cashier, Example Grocery (2023 - 2025): handled cash and card payments; trained 2 new cashiers; closed the register each night
- Math Tutor, Example College Math Center (2024 - present): tutor students in statistics and algebra each week
## Projects
- Class project: analyzed local housing prices in Excel and R; built a simple regression model and presented the results
## Skills
Excel, R, Google Sheets
`;
const HV = { cv: CV_AVERY, answers: {}, company: 'Harborview Institute', role: 'Research Assistant Intern', posting: `Research Assistant Intern
Harborview Institute studies housing and transportation policy.
Responsibilities:
- Clean and merge survey data and run descriptive statistics
- Help with literature reviews and draft short research memos
- Create charts for policy briefs
Who we're looking for:
- Coursework in economics, statistics or public policy
- Familiarity with R or Stata
- Strong writing skills and curiosity about cities` };

test('r7 M1: a where/who clause next to the company is a claim, also after an apply or wish word', () => {
  for (const s of [
    'I am excited to apply to Northwind Health, where I interned last year.',
    'I would love to join Northwind Health, where I volunteered last summer.',
    "Northwind Health's analytics team, where I volunteered last year, showed me how data improves patient care.",
    'Northwind Health, who hired me last year, is a great employer.',
  ]) assert.deepEqual(check(s, NW), ['Northwind Health'], s);
  assert.deepEqual(check('I would love to join Northwind Health, where I could grow as an analyst.', NW), []);
});

test('r7 M1: a where clause far from the company name is not a company claim', () => {
  assert.deepEqual(check("Harborview Institute's work on housing policy connects directly to my class project on local housing prices, where I used R and Excel.", HV), []);
  assert.deepEqual(check("Harborview Institute's work on housing policy connects directly to my class project on local housing prices, where I used R and Excel to build a simple regression model.", HV), []);
});

test('r7 M2: the role-wish span stops at a comma, and, since, because or but; the title after it is checked', () => {
  for (const [s, want] of [
    ['I would love to join your team as an analyst, and I worked as a data analyst before.', ['data analyst']],
    ['I hope to work as a data analyst, since I worked as a business analyst last summer.', ['business analyst']],
    ['I am eager to learn from your team, and last summer I worked as a data analyst at Example Logistics.', ['data analyst']],
    ['I would love to help your team, and I already worked as the Data Analyst Intern at Example Logistics.', ['Data Analyst Intern']],
    ['I would love to support your team, building on my summer as a data analyst at Example Logistics.', ['data analyst']],
    ['I hope to work as an analyst because I worked as a business analyst before.', ['business analyst']],
    ['I would like to grow as an analyst but I was a data analyst already.', ['data analyst']],
  ]) assert.deepEqual(check(s, NW), want, s);
  for (const s of [
    'I would love to join Northwind Health and grow as an analyst.',
    'I would love to join your team, learn from your analysts and grow as a data analyst.',
    'I would love to join Northwind Health, where I could grow as an analyst.',
  ]) assert.deepEqual(check(s, NW), [], s);
});

test('r7 M3: more title triggers: in my role as, my <title> internship/job, I was the, as their/its, worked at <Company> as', () => {
  for (const [s, want] of [
    ['In my role as data analyst at Example Logistics, I wrote SQL queries.', ['data analyst']],
    ['During my data analyst internship at Example Logistics, I wrote SQL queries.', ['data analyst']],
    ['My business analyst job at Example Logistics taught me SQL.', ['business analyst']],
    ['My analyst role at Example Logistics taught me to write SQL.', ['analyst']],
    ['I was the data analyst for the warehouse team at Example Logistics.', ['data analyst']],
    ['I worked at Example Logistics as their data analyst.', ['data analyst']],
    ['As its lead analyst, I tracked shipment delays.', ['lead analyst']],
    ['I worked at Example Logistics as data analyst.', ['data analyst']],
    ['I worked for Example Logistics as a business analyst.', ['business analyst']],
    ['I was the very first analyst hired.', ['first']],
  ]) assert.deepEqual(check(s, NW), want, s);
  for (const s of [
    'In my operations internship, I automated a weekly data pull with a Python script.',
    'My Operations Intern role at Example Logistics taught me SQL.',
    'I worked at Example Logistics as an operations intern.',
  ]) assert.deepEqual(check(s, NW), [], s);
});

test('r7 M4: counts of years with no "of": spent (several) years, years\' experience, years working with', () => {
  for (const [s, want] of [
    ['I have spent several years working with SQL.', ['spent several years']],
    ['I have spent years building Excel reports.', ['spent years']],
    ["I have several years' experience with Python.", ["several years' experience"]],
    ['I have 3 years\' experience with Python.', ['3']],
    ['I have many years experience in reporting.', ['many years experience']],
  ]) assert.deepEqual(check(s, NW), want, s);
  for (const s of ['Over the years I have written SQL for many teams.', 'Your team has spent years building trust with patients.']) assert.deepEqual(check(s, NW), [], s);
  const cv = `${CV}- Data Clerk, Example Bank (2021-2024): 3 years of SQL reporting\n`;
  assert.deepEqual(check('I have spent several years working with SQL.', { ...NW, cv }), []);
});
