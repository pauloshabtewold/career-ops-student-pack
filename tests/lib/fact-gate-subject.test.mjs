// lib/fact-gate.mjs check(): the posting grounds nothing about the student. Posting words and known tools absent from
// cv.md are flagged anywhere in the letter, the company and role pass only as names in fixed contexts, and quantities
// need cv.md. SYNTHETIC FIXTURE: fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, retryTerms } from '../../lib/fact-gate.mjs';

const CV = '# Jordan Testwell\n- Software Intern, Example Robotics: built a Python scheduling tool\nSkills: Python, SQL\n';
const POSTING = 'Acme uses Tableau, Snowflake and Looker and wants 3 years of SQL. Your analytics team reports weekly.';
const SRC = { cv: CV, answers: {}, posting: POSTING, company: 'Acme', role: 'Data Analyst Intern' };
const lower = (xs) => xs.map((x) => x.toLowerCase()).sort();

test('a student claim without a first-person pronoun is grounded by cv.md only, not the posting', () => {
  assert.deepEqual(lower(check('With 3 years of Tableau and Snowflake work, your analytics team is where this experience fits.', SRC)), ['3', 'snowflake', 'tableau']);
  assert.deepEqual(lower(check('The Data Analyst Intern role fits 3 years of hands-on Tableau work.', SRC)), ['3', 'tableau']);
  assert.deepEqual(lower(check('Acme gets an analyst with 3 years of Looker work.', SRC)), ['3', 'acme', 'looker']);
});

test('r4: a statement about the company is no longer grounded by the posting; a tool the cv lacks is flagged', () => {
  assert.deepEqual(check('Your team uses Tableau for reporting.', SRC), ['Tableau']);
  assert.deepEqual(lower(check('Acme uses Snowflake and Looker.', SRC)), ['looker', 'snowflake']);
  assert.deepEqual(check('The company uses Tableau.', SRC), ['Tableau']);
  assert.deepEqual(check('Your team uses Python and SQL.', SRC), [], 'tools in the cv pass');
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

test('controls: a cv-grounded claim and the role name pass; r4: company-needs sentences naming a tool the cv lacks are flagged', () => {
  assert.deepEqual(check('Your team uses Tableau for reporting.', SRC2), ['Tableau']);
  assert.deepEqual(check('Acme relies on Snowflake.', SRC2), ['Snowflake']);
  assert.deepEqual(check('Acme relies on SQL.', SRC2), []);
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

// Review r3 adversarial probes and honest letters (round 4, fail-closed design). Each should-flag case must return at
// least one item; each honest letter has an exact expected count of flagged sentences.
const CV3 = `# Jordan Testwell
jordan@example.com
## Experience
- Software Intern, Example Robotics (Summer 2025): built a Python scheduling tool; maintained the test suite; wrote a guide for new users
## Education
- B.S. Computer Science, Example State University, GPA 3.6
## Skills
Python, SQL, excellent communication, access to lab equipment, trustworthy, algorithms, metadata
`;
const P3 = { cv: CV3, answers: {}, posting: 'Acme wants a Data Analyst Intern. You will use Tableau, Snowflake, Looker, R and Go. Improve reports by 25%. Team of 40. Meta experience a plus.', company: 'Acme', role: 'Data Analyst Intern' };
const T3 = { ...P3, role: 'Tableau Developer Intern' };
const K3 = { ...P3, company: 'Snowflake' };
const CVB = '# Jordan Testwell\n- Software Intern, Example Robotics: built a Python tool\nSkills: Python, SQL\n';
const B3 = (extra = '') => ({ cv: CVB + extra, answers: {}, posting: 'Acme wants Tableau.', company: 'Acme', role: 'Data Analyst Intern' });
const C3 = { cv: CVB, answers: {}, posting: 'Acme wants Tableau and Snowflake.', company: 'Acme', role: 'Data Analyst Intern' };

const SHOULD_FLAG = [
  ['Your team uses Tableau and Snowflake, familiar ground for the student.', P3],
  ['Your team needs Tableau and Snowflake, tools the graduate knows well.', P3],
  ['Your team uses Tableau, and Jordan knows it well.', P3],
  ['Your team relies on Snowflake, and Jordan has it covered.', P3],
  ['You want Tableau and Snowflake; she knows both.', P3],
  ["Your team's next member uses Tableau and Snowflake daily.", P3],
  ['Your team uses Tableau, as does yours truly.', P3],
  ['"You use Tableau like a pro," said a mentor at Example Robotics.', P3],
  ['Your team will use Looker and Snowflake with the new grad on day one.', P3],
  ['Acme needs Tableau, and gets it in full from the sender.', P3],
  ['You need Tableau? Look no further.', P3],
  ['I write R scripts for every analysis.', P3],
  ['I write Go services in my free time.', P3],
  ['I am skilled in Excel and CSS.', P3],
  ['I build AI tools.', P3],
  ['I interned at Meta last year.', P3],
  ['I use looker and snowflake every week.', P3],
  ['I wrote pyspark and postgresql jobs.', P3],
  ['I know dbt, airflow and k8s.', P3],
  ['I am certified in Tаbleau.', P3],
  ['I bring half a decade of SQL work.', P3],
  ['I spent a year building Python tools at Example Robotics.', P3],
  ['I won the Example State hackathon twice.', P3],
  ['I finished in the top three at the Example State hackathon.', P3],
  ['I doubled the speed of the Python scheduling tool.', P3],
  ['I cut report time by a third using SQL.', P3],
  ['As a Tableau Developer Intern at Example Robotics, I automated reports.', T3],
  ['I am currently a Tableau Developer Intern at Example Robotics.', T3],
  ['My Tableau Developer Intern summer at Example Robotics taught me a lot.', T3],
  ['I bring real Tableau Developer Intern experience.', T3],
  ['I know Snowflake well.', K3],
  ['My Snowflake skills are strong.', K3],
  ['I hold a Snowflake certification.', K3],
  ['Imagine a hire who already knows Tableau: that is me.', P3],
  ['I worked with Tableau-based dashboards.', P3],
  ['I have 2-3 years of SQL work.', P3],
  ['I ranked second in my class.', P3],
  ['Data Analyst Intern II at Example Robotics was my title.', P3],
  ['I led teams of eight-plus students.', P3],
  ['I bring Tableau, Snowflake, Looker.', P3],
  ['Your analytics stack uses Tableau, Snowflake and Looker, a stack mastered at Example Robotics.', P3],
  ['The company relies on Looker, a daily tool at Example Robotics.', P3],
  ['You use Snowflake, and so did Example Robotics.', P3],
  ['I write R scripts for every analysis.', B3()],
  ['I write Go services in my free time.', B3()],
  ['I write Go services in my free time.', B3('Courses: algorithms\n')],
  ['I am skilled in Excel.', B3()],
  ['I am skilled in Excel.', B3('excellent communication\n')],
  ['I build AI tools.', B3()],
  ['I build AI tools.', B3('maintained the test suite\n')],
  ['I interned at Meta last year.', B3()],
  ['I interned at Meta last year.', B3('cleaned metadata\n')],
  ['I deployed on AWS.', B3('studied tort laws\n')],
  ['I use Git daily.', B3('digital media club\n')],
  ['I build React apps.', B3('reactive programming course\n')],
  ['I build with Rust.', B3('trustworthy\n')],
  ['I know Java well.', B3('JavaScript\n')],
  ['Your team uses Tableau. So do I.', C3],
  ['Your team uses Tableau. It is the tool I know best.', C3],
  ['Your team relies on Snowflake, a tool that comes with this application.', C3],
  ['Your team uses Tableau, and so will its newest teammate.', C3],
  ['You need Tableau and Snowflake, and both arrive with the student on day one.', C3],
  ['I am a Tableau-certified analyst.', C3],
  ['I spent two summers as a Data Analyst Intern.', C3],
  ['I bring a decade of hands-on SQL.', C3],
  ['I have worked with SQL for ages, roughly a year and a half.', C3],
];

test('r4: every r3 adversarial probe is flagged', () => {
  const leaks = SHOULD_FLAG.filter(([s, src]) => check(s, src).length === 0).map(([s]) => s);
  assert.deepEqual(leaks, []);
});

test('r4: grounding is whole-word, so a tool spelled inside a longer cv word is not grounded', () => {
  assert.deepEqual(check('I know Java well.', B3('JavaScript\n')), ['Java']);
  assert.deepEqual(check('I know Java well.', B3('Java\n')), []);
  assert.deepEqual(check('I am skilled in Excel.', B3('Excel\n')), []);
});

test('r4: quantities are grounded by the same expression or its numeric equivalent in the cv', () => {
  assert.deepEqual(check('I bring half a decade of SQL work.', B3('SQL, 5 years\n')), []);
  assert.deepEqual(check('I spent a year building Python tools.', B3('Python, 1 year\n')), []);
  assert.deepEqual(check('I ranked second in my class.', B3('Ranked 2nd in class\n')), []);
  assert.deepEqual(check('I have 2-3 years of SQL work.', B3('SQL (2-3 years)\n')), []);
  assert.deepEqual(check('I won the hackathon twice.', B3('Hackathon winner 2x\n')), []);
});

test('r4: the company and role pass as names in fixed contexts only', () => {
  for (const s of ['I am excited to apply to Acme.', 'Dear Acme hiring team,', "Acme's mission fits my goals.", 'I would be glad to start as the Data Analyst Intern.', 'I am applying for the Data Analyst Intern role at Acme.', 'I want to join Acme as a Data Analyst Intern.']) assert.deepEqual(check(s, C3), [], s);
  assert.deepEqual(check('I am applying for the Tableau Developer Intern role.', { ...C3, role: 'Tableau Developer Intern' }), []);
  assert.deepEqual(check('I was excited to apply as a Data Analyst Intern.', C3), []);
  assert.deepEqual(check('Acme taught me SQL.', C3), ['Acme']);
  assert.deepEqual(check('I went on to work as a Data Analyst Intern.', C3), ['Data Analyst Intern']);
});

const CVH = `# Riley Samplewood
riley@example.com
## Education
- B.S. Statistics, Example State University, expected May 2026, GPA 3.7
## Experience
- Data Intern, Example Health Partners (June-August 2025): wrote SQL queries for weekly patient-wait reports; built 3 Excel dashboards used by 2 clinic managers; cleaned survey data in Python with pandas
- Research Assistant, Example State Psychology Lab (2024-2025): ran R scripts for regression analysis on a 1,200-person survey
## Projects
- Bike share demand model: Python, pandas, scikit-learn; forecast daily rides for a city open-data set
## Skills
Python, pandas, SQL, R, Excel, Git
`;
const HONEST = [
  { company: 'Acme Analytics', role: 'Data Analyst Intern', flagged: 0, posting: 'Acme Analytics is hiring a Data Analyst Intern. You will use SQL, Python and Tableau to build reports for our operations team.',
    p: 'I am applying for the Data Analyst Intern role at Acme Analytics. Last summer at Example Health Partners I wrote SQL queries for weekly patient-wait reports and built 3 Excel dashboards that 2 clinic managers used. In the Example State Psychology Lab I ran R scripts for regression analysis on a 1,200-person survey. Your operations team uses SQL and Python, and those are the tools I use most. I would bring careful data cleaning and clear reporting to your team.' },
  { company: 'Northwind Health', role: 'Business Intelligence Intern', flagged: 1, posting: 'Northwind Health needs a BI intern comfortable with SQL and Power BI. Our analytics group relies on Excel and Power BI for clinic reporting.',
    p: 'I am excited to apply to Northwind Health for the Business Intelligence Intern position. As a Data Intern at Example Health Partners, I built Excel dashboards for clinic managers and cleaned survey data in Python with pandas. Northwind Health relies on Excel for clinic reporting, and Excel dashboards were a core part of my internship. I am finishing a B.S. in Statistics at Example State University with a 3.7 GPA. I would welcome the chance to learn Power BI on your team.' },
  { company: 'Contoso Mobility', role: 'Data Science Intern', flagged: 1, posting: 'Contoso Mobility builds ride forecasting models in Python. The data science team uses scikit-learn, pandas and Airflow.',
    p: 'Forecasting demand is the problem I enjoy most, which is why the Data Science Intern role at Contoso Mobility stands out to me. For a class project I built a bike share demand model in Python with pandas and scikit-learn that forecast daily rides from a city open-data set. Your data science team uses pandas and scikit-learn, so I could contribute from the start. I also bring regression experience from the Example State Psychology Lab. I am glad to learn Airflow and the rest of your stack.' },
];

test('r4: honest letters flag only the by-design "learn <tool the cv lacks>" sentences', () => {
  for (const L of HONEST) {
    const src = { cv: CVH, answers: {}, posting: L.posting, company: L.company, role: L.role };
    const sentences = L.p.split(/(?<=[.!?])\s+(?=[A-Z])/);
    const flaggedSentences = sentences.filter((s) => check(s, src).length > 0);
    assert.equal(flaggedSentences.length, L.flagged, `${L.company}: ${JSON.stringify(flaggedSentences)}`);
    for (const s of flaggedSentences) assert.match(s, /\blearn\b/, s);
  }
});

test('r4: "with <Company>" is not a name context, so the company as a tool needs the cv', () => {
  assert.deepEqual(check('I worked with Snowflake daily.', K3), ['Snowflake']);
  assert.deepEqual(check('I would love to join Snowflake.', K3), []);
});

test('r4: tech terms that are also English words count only in tech casing or next to a tech context word', () => {
  const src = B3();
  for (const s of ["I'd go further for your team.", 'A spark of interest led me to data.', 'I react quickly to feedback.', 'I excel at SQL.', 'I took a swift look at the data.', 'My epic project used SQL.', 'Rust on the old bike taught me patience.'.toLowerCase()]) assert.deepEqual(check(s, src), [], s);
  for (const [s, want] of [['I write Go services.', 'Go'], ['I build React apps.', 'React'], ['I wrote R scripts.', 'R'], ['I used r scripts for class.', 'r'], ['I wrote go code for a class.', 'go'], ['I know node.js well.', 'node'], ['I write Swift apps.', 'Swift'], ['I used Epic at the clinic.', 'Epic'], ['React is my favorite tool.', 'React']]) assert.deepEqual(check(s, src), [want], s);
});

// Review r4 probes (round 5 ruling): quantity forms, invisible characters, joined tool names, sentence-initial names,
// the company as employer or tool in a first-person claim, and a role held. Each should-flag case returns at least one
// item; each control returns none.
const CV5 = '# Casey Fakename\ncasey@example.com\n## Experience\n- Data Intern, Example Logistics (Summer 2025): built weekly SQL reports for 3 teams; wrote Python scripts to clean shipment data\n## Education\n- B.S. Statistics, Example State University, GPA 3.5\n## Skills\nPython, SQL, pandas\n';
const POST5 = (co) => `${co} is hiring a Data Analyst Intern. You will build dashboards in Tableau, model data with dbt, stream events through Kafka, prototype in Figma, and track product metrics in Mixpanel and Amplitude. Experience with Jupyter, Power BI and Looker is a plus. Track work in Planner and Microsoft Teams. Improve reporting turnaround by 30%.`;
const S5 = { cv: CV5, answers: {}, posting: POST5('Acme'), company: 'Acme', role: 'Data Analyst Intern' };
const K5 = { ...S5, posting: POST5('Snowflake'), company: 'Snowflake' };
const T5 = { ...S5, role: 'Tableau Developer Intern' };

const R5_SHOULD_FLAG = [
  ['My dbtCloud projects followed SQL best practices.', S5],
  ['PowerBI dashboards were my main deliverable at Example Logistics.', S5],
  ['I used powerbi and dbtcloud daily.', S5],
  ['I build dashboards in Tab\u200bleau.', S5],
  ['I build dashboards in Tab\u00adleau.', S5],
  ['I build dashboards in Tab\u2060leau.', S5],
  ['I build dashboards in Tab\ufeffleau.', S5],
  ['Tableau\u2122 dashboards were my daily work.', S5],
  ['Fivetran syncs fed my SQL models at Example Logistics.', S5],
  ['Google hired me as a summer intern.', S5],
  ['Deloitte trained me in SQL.', S5],
  ['Planner boards kept my team on track.', S5],
  ['I used Teams daily.', S5],
  ['I helped double sign-ups with a Python script.', S5],
  ['I helped quadruple traffic.', S5],
  ['I am proud of doubling sign-ups.', S5],
  ['I am proud of tripling report throughput with SQL.', S5],
  ['Halving the refresh time was my biggest win.', S5],
  ['I halved the refresh time.', S5],
  ['I was the number one analyst in my cohort.', S5],
  ['I was the first intern to ship a SQL model to production.', S5],
  ['I was the very first analyst hired.', S5],
  ['I ranked in the top tenth of my class.', S5],
  ['I am a top 5% student.', S5],
  ['I was second in my class.', S5],
  ['I finished the dashboard in a week.', S5],
  ['I finished the report in a month.', S5],
  ['I spent a year on SQL.', S5],
  ['I spent half a decade on SQL.', S5],
  ['I analyzed \u0663 years of sales data.', S5],
  ['I analyzed \u06f5 years of sales data.', S5],
  ['I write services in go and build components with react.', S5],
  ['I held the Data Analyst Intern position at Example Logistics last summer.', S5],
  ['I am excited to continue to work as a Data Analyst Intern at Example Logistics.', S5],
  ["I was Acme's top analyst intern last summer.", S5],
  ['I interned at Acme last summer.', S5],
  ['At Acme, I interned on the data team.', S5],
  ['My internship at Acme taught me SQL.', S5],
  ['I already work for Acme on the data team.', S5],
  ['I am applying to Acme because I interned at Acme.', S5],
  ['I migrated our warehouse to Snowflake at Example Logistics.', K5],
  ['I earned a certification from Snowflake.', K5],
  ['I write SQL for Snowflake every day.', K5],
  ["I know Snowflake's query engine inside out.", K5],
  ['I loaded data from Snowflake into Python.', K5],
  ['I held the Tableau Developer Intern role at Example Logistics.', T5],
  ['I am glad to continue to work as a Tableau Developer Intern.', T5],
  ["Acme's Tableau Developer Intern last year was me.", T5],
];

const R5_PASS = [
  'I would love to join Acme.',
  'I am applying to Acme.',
  "Acme's mission excites me.",
  'I was excited to apply as a Data Analyst Intern at Acme.',
  'At Acme I would build clear SQL reports.',
  'I would bring my SQL skills to Acme as the Data Analyst Intern.',
  'I hope to join as the Data Analyst Intern.',
  'I am drawn to Acme because I built SQL reports at Example Logistics.',
  'I built SQL reports at Example Logistics, and I want to do the same at Acme.',
  "I was impressed by Acme's reports.",
  'First, I built weekly SQL reports at Example Logistics.',
  'At first I found SQL hard.',
  'Your team is my first choice for this summer.',
  'I double-checked every query.',
  'Last summer I wrote Python scripts.',
  'Forecasting demand is a problem I enjoy.',
  'One day I hope to lead a team.',
  'I track my work in a planner.',
  "This is the job I want, and I'm glad you're hiring.",
  "You'll find I'm careful, and that has been my focus.",
  "I'd go further for your team.",
];

test('r5: every r4 should-flag probe is flagged', () => {
  const leaks = R5_SHOULD_FLAG.filter(([s, src]) => check(s, src).length === 0).map(([s]) => s);
  assert.deepEqual(leaks, []);
});

test('r5: apply, join and wish sentences, honest ordinals and grammar words pass', () => {
  const flaggedControls = R5_PASS.map((s) => [s, check(s, S5)]).filter(([, r]) => r.length);
  assert.deepEqual(flaggedControls, []);
});

test('r5: exact items for the new quantity forms and names', () => {
  for (const [s, want] of [
    ['I helped quadruple traffic.', ['quadruple']],
    ['I was the very first analyst hired.', ['first']],
    ['I ranked in the top tenth of my class.', ['top tenth']],
    ['I finished the dashboard in a week.', ['a week']],
    ['I analyzed \u0663 years of sales data.', ['3']],
    ['Google hired me as a summer intern.', ['Google']],
    ['I interned at Acme last summer.', ['Acme']],
    ['Tableau\u2122 dashboards were my daily work.', ['Tableau']],
  ]) assert.deepEqual(check(s, S5), want, s);
  // Grounded by the cv: the same expression or its equivalent, and the employer named in the cv.
  const cv = `${CV5}- Doubled sign-ups; finished first in the Example State datathon; SQL, 3 years\n`;
  for (const s of ['I am proud of doubling sign-ups.', 'I came first in the Example State datathon.', 'I have three years of SQL.', 'I interned at Example Logistics last summer.']) assert.deepEqual(check(s, { ...S5, cv }), [], s);
  // A number before a time unit needs the same unit in the cv: "3 teams" does not ground "3 years".
  assert.deepEqual(check('I have 3 years of SQL.', S5), ['3']);
  assert.deepEqual(check('I built reports for 3 teams.', S5), []);
});

test('r5: the retry note names only flagged risk terms, never grammar or common words', () => {
  assert.deepEqual(retryTerms(['is', 're', 'Data', 'Tableau', 'a week', 'second', '3', 'power bi']), ['Tableau', 'a week', 'second', '3', 'power bi']);
});

// Realistic postings of about 150 words (one-line fixtures hide over-flagging): the honest letters flag only the
// by-design "learn <tool the cv lacks>" sentences.
const EEO = 'This is a paid internship. We are an equal opportunity employer; all qualified applicants will receive consideration without regard to race, color, religion, sex, gender identity, national origin, disability or veteran status.';
const LONG_POSTINGS = {
  'Bluefin Outfitters': `Data Analyst Intern - Summer 2026
Bluefin Outfitters is a fast-growing outdoor retailer. Our analytics team turns sales and supply chain data into decisions.
What you'll do:
- Build and maintain dashboards in Tableau that track KPIs for merchandising and operations
- Write SQL queries against our Snowflake warehouse and help clean data
- Partner with stakeholders across the business to answer ad hoc questions
- Present insights to the team every week
What we're looking for:
- Pursuing a degree in analytics, statistics, economics or a related field
- Experience with SQL and Excel; Python is a plus
- Strong attention to detail and the ability to explain findings clearly
- Curious, organized and comfortable in a fast-paced environment
This is a paid, hybrid internship based in Example City. It's a 12-week program.`,
  'Acme Analytics': `Data Analyst Intern (Summer 2026)
Acme Analytics helps regional clinics and stores understand their data. You will join the operations team for 12 weeks.
Responsibilities:
- Use SQL, Python and Tableau to build reports for our operations team
- Clean and validate data from several sources before it reaches a dashboard
- Document your queries so others can reuse them
- Share findings with managers in a short weekly update
Qualifications:
- Currently pursuing a degree in statistics, data science, computer science or a related field
- Coursework or project experience with SQL; Python or R is a plus
- Clear written communication and attention to detail
- Comfortable asking questions and working with a small team
${EEO}`,
  'Northwind Health': `Business Intelligence Intern
Northwind Health is a network of community clinics. Our analytics group relies on Excel and Power BI for clinic reporting.
What you will do:
- Build and update clinic dashboards in Power BI and Excel
- Write SQL to pull visit and scheduling data
- Help clinic managers read their weekly numbers and spot trends
- Keep reporting documentation current
What you bring:
- A degree in progress in statistics, health informatics, business or a related field
- Experience with SQL and Excel; Power BI is a plus
- Care with sensitive data and a patient, clear way of explaining results
- Ability to manage several requests at once
${EEO} Our team has been recognized as a great place to work.`,
  'Contoso Mobility': `Data Science Intern
Contoso Mobility builds ride forecasting models in Python for bike and scooter fleets in several cities.
In this role you will:
- Clean trip data and build features for demand forecasting
- Train and evaluate models with scikit-learn and pandas
- Help the data science team move models into Airflow pipelines
- Present results to product and operations partners
You might be a fit if you:
- Are pursuing a degree in statistics, computer science, economics or a related field
- Have built at least one forecasting or regression project in Python
- Write clear code and explain your choices
- Enjoy messy real-world data
${EEO}`,
};
const CV4 = `# Morgan Placeholder
morgan@example.com
## Education
- B.S. Business Analytics, Example State University, expected May 2026, GPA 3.4
## Experience
- Operations Intern, Example Freight Co. (Summer 2025): built weekly Excel reports on late shipments for the operations manager; wrote SQL queries to pull order data; cleaned data and fixed errors in the tracking sheet
- Student Assistant, Example State Library (2023-2025): answered patron questions; trained 4 new assistants
## Projects
- Course project: forecasting bike-share demand in Python with pandas; presented results to the class
## Skills
Excel (pivot tables, VLOOKUP), SQL, Python, pandas, communication
`;
const BLUEFIN_LETTERS = [
  'I am applying for the Data Analyst Intern role at Bluefin Outfitters because I like turning messy data into something a team can act on. Last summer at Example Freight Co., I built weekly Excel reports on late shipments for the operations manager and wrote SQL queries to pull order data. I also cleaned the tracking sheet and fixed errors that had been slowing the team down. I would bring that same care to your analytics team.',
  'My coursework in business analytics at Example State University taught me to start with the question before touching the data. In a course project I forecast bike-share demand in Python with pandas and presented the results to my class. That project showed me how much a clear explanation matters, and it is a big part of why I want to join Bluefin Outfitters. I am eager to learn how a retailer uses data to make decisions.',
  'Working as a student assistant at the Example State Library, I answered patron questions every day and trained 4 new assistants, so I am used to explaining things simply and patiently. At Example Freight Co., I used Excel pivot tables and SQL to keep shipment data accurate, and I enjoyed sharing what I found with the operations manager. I would welcome the chance to bring that attention to detail to Bluefin Outfitters as the Data Analyst Intern.',
];
const flaggedSentencesOf = (p, src) => p.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((s) => check(s, src).length > 0);

test('r5: honest letters against realistic postings flag only the by-design "learn" sentences', () => {
  for (const p of BLUEFIN_LETTERS) {
    const src = { cv: CV4, answers: {}, posting: LONG_POSTINGS['Bluefin Outfitters'], company: 'Bluefin Outfitters', role: 'Data Analyst Intern' };
    assert.deepEqual(flaggedSentencesOf(p, src), [], p);
  }
  for (const L of HONEST) {
    const src = { cv: CVH, answers: {}, posting: LONG_POSTINGS[L.company], company: L.company, role: L.role };
    const flaggedSentences = flaggedSentencesOf(L.p, src);
    assert.equal(flaggedSentences.length, L.flagged, `${L.company}: ${JSON.stringify(flaggedSentences)}`);
    for (const s of flaggedSentences) assert.match(s, /\blearn\b/, s);
  }
});
