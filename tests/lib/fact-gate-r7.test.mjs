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
