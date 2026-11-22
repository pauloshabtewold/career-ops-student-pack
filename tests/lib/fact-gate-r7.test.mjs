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
    'I want to bring my SQL and Excel skills to your team as a data analyst.',
    'I want to bring my SQL, Excel and Python skills to your team as a data analyst.',
    'I would love to join Northwind Health and bring my skills to your team as an analyst.',
  ]) assert.deepEqual(check(s, NW), [], s);
});

// P5 NIT (r7 final cap): "and as <title> ... I <claim>" puts the claim after the title, so the wish span keeps it; it also
// passed at 60e3b4d. The P5 Opus judge counts such invented titles per draft.
test('r7 P5 NIT: a title claim after "and as" with the claim verb after the title', { todo: 'P5 fact-gate residual' }, () => {
  assert.deepEqual(check('I would love to help your team, and as a data analyst at Example Logistics I wrote SQL.', NW), ['data analyst']);
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

const BLUEFIN = (resp, req) => ({ cv: CV, answers: {}, company: 'Bluefin Supply', role: 'Data Analyst Intern', posting: `Data Analyst Intern
Bluefin Supply is a distributor of industrial parts.
${resp}
- Build demand forecasting models and run regression analysis on order history
- Perform geospatial analysis of delivery routes
- Reconcile vendor invoices and support month-end close
- Conduct usability testing of internal tools and write user personas
${req}
- Pursuing a degree in a quantitative field
- Strong forecasting and statistics skills
- Comfortable with geospatial data` });

test('r7 M5: requirement headers match in any case, with markdown marks and a colon stripped, and in common wordings', () => {
  const headers = ['Requirements', 'Job Requirements', 'Qualifications', 'Minimum Qualifications', 'Preferred Qualifications', 'Technical Skills', 'Skills', "Who we're looking for", 'Your profile', 'The ideal candidate', 'Must have', 'Nice to have', 'What you bring', 'REQUIREMENTS'];
  const forms = [(h) => `${h}:`, (h) => `## ${h}`, (h) => `**${h}**`, (h) => `**${h}:**`, (h) => `### ${h}:`];
  for (const h of headers) for (const f of forms) {
    const src = BLUEFIN('## What you will do', f(h));
    assert.deepEqual(check('Your team works with geospatial data every day.', src), ['geospatial'], f(h));
  }
  // A markdown header that is not a requirement header ends the section before it.
  const src = BLUEFIN('## Requirements\n- Comfortable with kriging\n## About the team', '## Benefits');
  assert.deepEqual(check('Your team works with kriging every day.', src), ['kriging']);
  assert.deepEqual(check('Your team uses forecasting models.', src), []);
});

test('r7 M6: posting bullet terms (responsibilities too) are risk words inside a first-person claim clause only', () => {
  const src = BLUEFIN('Responsibilities:', 'Requirements:');
  for (const [s, want] of [
    ['I ran regression analysis on shipment data during my internship.', ['regression']],
    ['I reconciled vendor invoices and supported month-end close.', ['reconciled', 'vendor', 'invoices']],
    ['I conducted usability testing and wrote user personas for an internal tool.', ['conducted', 'usability']],
  ]) assert.deepEqual(check(s, src), want, s);
  for (const s of [
    'I am eager to learn regression analysis on your team.',
    'Your team runs regression analysis on order history.',
    'I would love to help reconcile vendor invoices.',
    'I have always wanted to try usability testing.',
  ]) assert.deepEqual(check(s, src), [], s);
});

test('r7: a soft-skill word in a requirement bullet is not a claim', () => {
  const src = BLUEFIN('## Responsibilities', '**Qualifications**\n- Clear communicator who works well with drivers');
  assert.deepEqual(check('Tutoring each week has made me a clear communicator.', src), []);
});

const LV = { cv: CV_AVERY, answers: {}, company: 'Lakeview Credit Union', role: 'Finance Intern', posting: `# Finance Intern, Summer 2026
Lakeview Credit Union serves 40,000 members in the region.
## What you'll do
- Reconcile general ledger accounts and prepare monthly variance reports in Excel
- Support the budgeting process and help analyze loan portfolio trends
- Build pivot tables and charts for the finance team
## Requirements
- Pursuing a degree in finance, accounting, economics or a related field
- Strong Excel skills; experience with QuickBooks is a plus
- Attention to detail and a commitment to member service` };
const RT = { cv: CV_AVERY, answers: {}, company: 'Redwood Transit', role: 'Operations Intern', posting: `**Operations Intern**
Redwood Transit runs bus service across three counties.
**Responsibilities**
- Analyze ridership and on-time performance data
- Help schedulers prepare service change materials
- Respond to rider feedback and track trends
**Qualifications**
- Pursuing a degree in economics, planning, engineering or a related field
- Comfortable with Excel; GIS experience a plus
- Clear communicator who works well with drivers and planners` };
const CV_SAM = `# Sam Placeholder
sam.placeholder@example.com | Example City
## Education
- B.S. Computer Science, Example State University, expected May 2027. Coursework: Data Structures, Databases, Software Engineering, Human-Computer Interaction
## Experience
- IT Help Desk Student Worker, Example State University (2024 - present): answer student and staff tickets; reset accounts; set up laptops; wrote how-to guides for the help desk wiki
## Projects
- Course project: built a Java web app for booking study rooms with a team of 4; wrote unit tests and the database schema in MySQL
- Personal project: Python script that cleans and charts my running data
## Skills
Java, Python, MySQL, Git, HTML, CSS
`;
const MV = { cv: CV_SAM, answers: {}, company: 'Maple Valley Schools', role: 'IT Support Intern', posting: `IT Support Intern
Maple Valley Schools serves 9,000 students in 14 schools.
Responsibilities:
- Troubleshoot Chromebooks, printers and classroom projectors
- Image and deploy laptops for teachers
- Track tickets in our help desk system and update the knowledge base
Qualifications:
- Customer service mindset and patience with users of all skill levels
- Basic networking knowledge; CompTIA A+ a plus
- Able to lift 40 pounds` };
const OB = { cv: CV_SAM, answers: {}, company: 'Orchard Bank', role: 'Data Science Intern', posting: 'Orchard Bank is a community bank with 30 branches. Our data science team builds models that help us serve customers better. As a Data Science Intern, you will clean data in Python and SQL, build churn and fraud models, and present results to business partners. You should have coursework in statistics or machine learning. Experience with pandas and scikit-learn is preferred.' };

test('r7 M7: honest first drafts: company-name words as plain words, "as an intern on your team" and "as your <Role>" pass', () => {
  for (const [src, letter] of [
    [LV, "Lakeview Credit Union's focus on its members is what draws me to the Finance Intern position. My Financial Accounting coursework gave me a base in how accounts fit together, and my Excel skills grew in a class project where I analyzed local housing prices and presented the results. At Example Grocery I closed the register each night, which taught me to find and fix small errors before they grow. As an intern on your team, I would bring the same attention to detail to monthly reports and pivot tables, and I am eager to learn how a credit union plans its budget."],
    [RT, 'I am applying for the Operations Intern role at Redwood Transit because public transit shapes how people in my town get to work and school. In my Statistics and Econometrics courses at Example College I learned to look for trends in data, and in a class project I analyzed local housing prices in Excel and R. As a cashier at Example Grocery, I closed the register each night and trained 2 new cashiers, which taught me to be careful and patient. I would welcome the chance to help your team understand riders better.'],
    [RT, 'Tutoring students each week at the Example College Math Center has made me a clear communicator, and my years at Example Grocery taught me to stay calm and helpful with the public. I am eager to learn how a transit agency plans its service.'],
    [MV, 'Supporting teachers so they can focus on students is work I would be proud to do at Maple Valley Schools. At my campus help desk I set up laptops, reset accounts and answer tickets every week, and I wrote how-to guides so people could solve common problems on their own. I am studying Computer Science at Example State University and I am eager to learn more about networking as your IT Support Intern.'],
    [OB, 'I am excited to apply for the Data Science Intern role at Orchard Bank. My Databases coursework gave me a solid base in working with structured data. I would welcome the chance to learn how a community bank uses data to serve its customers.'],
    [OB, "Orchard Bank's goal of serving customers better with data is what draws me to the Data Science Intern position. I am eager to deepen my statistics knowledge and learn how models are built and checked in a real bank."],
  ]) assert.deepEqual(check(letter, src), [], letter.slice(0, 60));
});

test('r7 M7: the whole company name and held titles are still checked', () => {
  assert.deepEqual(check('I interned at Lakeview Credit Union last summer.', LV), ['Lakeview Credit Union']);
  assert.deepEqual(check('I helped members at Lakeview last summer.', LV), ['Lakeview']);
  assert.deepEqual(check('As an intern on your team, I closed the books each month.', LV), ['intern']);
  assert.deepEqual(check('As an analyst at Example Grocery, I would review sales.', LV), ['analyst']);
  assert.deepEqual(check('As an intern at Lakeview Credit Union, I would help prepare monthly reports.', LV), []);
});

// r7 review MUST-1: an Oxford comma, an -ing segment or "as I grow" with no claim in it never ends the role wish.
test('r7 review: honest wish sentences with list commas, -ing segments or "as I grow" keep the target role', () => {
  for (const s of [
    'I would love to bring my SQL, Excel, and Python skills to Northwind Health as the Data Analyst Intern.',
    'I would love to learn, contribute, and grow as a Data Analyst Intern.',
    'I would love to join your team, and grow as an analyst.',
    'I hope to join Northwind Health, bringing my SQL skills as the Data Analyst Intern.',
    'I am eager to contribute to your team, growing as an analyst.',
    'I would love to join your team, learning from each project as a data analyst intern.',
  ]) assert.deepEqual(check(s, NW), [], s);
});

// r7 review MUST-2: a company-name word that is also a requirement term stays a risk word.
test('r7 review: a requirement term that is also a company-name word is still checked', () => {
  const src = { cv: CV, answers: {}, company: 'Bluefin Geospatial', role: 'Data Analyst Intern', posting: `Data Analyst Intern
Bluefin Geospatial maps delivery networks for retailers.
Requirements:
- Pursuing a degree in a quantitative field
- Experience with geospatial work` };
  assert.deepEqual(check('I performed geospatial analysis of delivery routes for the warehouse team.', src), ['geospatial']);
  assert.deepEqual(check('I would love to join Bluefin Geospatial as the Data Analyst Intern.', src), []);
});
