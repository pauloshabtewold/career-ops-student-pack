// SYNTHETIC FIXTURE: placeholder people, companies and cv text only.
// M-004 fix 7: target names are structural. The model writes {first_name}, {company}, {title} and {applied_date}; a
// draft that writes the company (or its initials), the job title or the submit date as is gets one retry, then is
// flagged. A claim about {company} or {title} (an experience verb in its sentence with no apply, join or wish word
// between, a where/who/when clause after it, "hired me", "my internship at", back/again/former, "after interning") is
// flagged per sentence. The submit date is no fact, so its numbers ground nothing. An acronym passes only when cv.md or
// the profile holds it or its expansion from the fixed table. The real values are filled in only after every check.
// Scratch roots, synthetic placeholder people and companies, example.com addresses and an injected headless runner:
// no real model, network, Gmail or LinkedIn. LIVE_DRAFTS are the real-model drafts of live rounds 3 and 4 (synthetic
// student), with the company, title, date and greeting name turned into placeholders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check as factCheck } from '../../lib/fact-gate.mjs';
import { readBatch } from '../../lib/batch-file.mjs';
import { resolvePaths } from '../../lib/paths.mjs';
import { serializeTsv } from '../../lib/tsv.mjs';
import { ACRONYMS, contactRoles, draftChecks, draftFacts, draftPrompt, fillPlaceholders, literalTargets, outreachDrafts, targetClaims } from '../../scripts/outreach-drafts.mjs';
import { makeRoot } from '../helpers/script-harness.mjs';

const DAY = '2026-11-22';
const ACME = 'Acme Example';
const GLOBEX = 'Globex Example';
const INITECH = 'Initech Example';
const TITLE = 'Software Engineering Intern';
const GLOBEX_APP = 'https://jobs.example.com/globex/swe-intern';

// The live-round student cv (synthetic).
const CV_LIVE = `# Sam Placeholder

Computer science student at Example State University, graduating May 2027. GPA 3.6.

## Experience
- Software engineering intern at Sample Labs (summer 2026): built a Python script that cut a weekly report from 2 hours to 10 minutes.
- Teaching assistant for Data Structures at Example State University (2025 to 2026).

## Projects
- Campus Bus Tracker: a small web app in JavaScript and Python that shows live bus times.

## Skills
Python, JavaScript, SQL, Git
`;
// The reviewers' probe cv: look-alike initials, no CS, AI, MBA, HP or IBM, and none of the target names.
const CV_PROBE = `# Sam Placeholder

## Education
State University, BS Biology, 2027

## Experience
Campus Bookstore, Customer Service Associate, 2024 to 2025
- Customer service at the front desk
- Artistic illustration for club posters
- Monthly budget audits for the hiking club
- Managed budget allocation for the hiking club
- Health Promotion Club, member
- Intro Business Management, course project
`;

const person = (name, company, action = 'warm-opener') => ({ action, channel: 'linkedin', contact: { name, company } });
const ALICE = person('Alice Alpha', ACME);
const CARL = person('Carl Chen', INITECH);
const HANA = person('Hana Ho', 'HP');
const IAN = person('Ian Ito', 'IBM');
const APP = { action: 'application-follow-up', channel: 'email', contact: { name: 'Hiring team', company: GLOBEX }, application: { target: GLOBEX_APP, company: GLOBEX, submitted: '2026-11-14', title: TITLE } };
const ROWS = [{ name: 'Carl Chen', company: INITECH, role: 'Data Engineer' }];

const flagsOf = (text, job, cv = CV_PROBE) => draftChecks(text, { ...job, roles: contactRoles(job, ROWS) }, { cv, facts: draftFacts(job, { candidate: { full_name: 'Sam Placeholder' } }) });
// The placeholder form of a literal probe sentence.
const toPlaceholders = (text, job) => (job.application?.title ? text.replaceAll(job.application.title, '{title}') : text).replaceAll(job.contact.company, '{company}');

// Review r4 (A) and r5 (F, C, H) probe sentences that must be flagged, written with the real names.
const CLAIMS = [
  ['A1', 'Hi Alice, I interned at Acme Example last summer and loved it.', ALICE],
  ['A2', 'Hi Alice, I worked at Acme Example on the data team.', ALICE],
  ['A3', 'Hello Globex Example hiring team, I was a Software Engineering Intern at Globex Example before.', APP],
  ['A4', 'Hello hiring team, I worked as a Software Engineering Intern last year.', APP],
  ['A5', 'Hi Carl, I also worked as a Data Engineer at Initech Example.', CARL],
  ['F1', 'I applied to Acme Example, where I interned last summer.', ALICE],
  ['F1b', 'Hello hiring team, I applied for the Software Engineering Intern position, where I worked last summer.', APP],
  ['F1c', 'Hello hiring team, I applied to Globex Example, where I interned in 2025.', APP],
  ['F1d', 'Thanks, Acme Example, where I interned last summer, was great.', ALICE],
  ['F2', "I'm curious about the work at Acme Example, where I interned last summer.", ALICE],
  ['F2b', "I'm curious about the data team at Acme Example who trained me.", ALICE],
  ['F3', "I'm curious about returning to the data team at Acme Example.", ALICE],
  ['F3b', "I'm curious about getting back to the team at Acme Example.", ALICE],
  ['F3c', "I'd love to return to the team at Acme Example.", ALICE],
  ['F4', 'Hello Globex Example hiring team, I interned with you last summer.', APP],
  ['F4b', 'Hello Globex Example team,\nI interned at Globex Example in 2025.', APP],
  ['F5', 'Hello hiring team, I applied for the Software Engineering Intern role after interning there.', APP],
  ['F6', 'Hi Alice, my internship at Acme Example taught me a lot.', ALICE],
  ['F7', 'Hi Alice, Acme Example hired me last summer.', ALICE],
  ['F8', "Hi Alice, Acme Example's data team is where I interned.", ALICE],
  ['F9', 'Hi Alice, it would be great to be back at Acme Example.', ALICE],
  ['F10', 'I applied to Acme Example again after my summer at Acme Example.', ALICE],
  ['F11', "Hello hiring team, I've applied for the Software Engineering Intern role I held at Globex Example in 2025.", APP],
  ['C1', 'Acme Example, where I interned last summer, is my top choice.', ALICE],
  ['C2', "I'd love to join Acme Example, where I interned last summer.", ALICE],
  ['C3', "I'd love to work at Acme Example, where I interned last summer.", ALICE],
  ['H1', 'Hi Hana, I interned at HP last summer.', HANA],
  ['H2', 'Hi Ian, I worked at IBM on the data team.', IAN],
];

test('fix 7 M1 every probe claim is flagged as a claim in placeholder form and as a literal name in the written form', () => {
  for (const [id, text, job] of CLAIMS) {
    const ph = toPlaceholders(text, job);
    assert.notEqual(ph, text, `${id} names a target`);
    assert.match(flagsOf(ph, job).join('; '), /makes a claim about the company or job title/, `${id}: ${ph}`);
    assert.match(flagsOf(text, job).join('; '), /as is instead of \{company\}, \{title\} or \{applied_date\}/, `${id}: ${text}`);
  }
});

test('fix 7 M1 targetClaims judges each sentence on its own: a true claim elsewhere never flags an honest company sentence', () => {
  const text = 'Hello hiring team,\n\nI applied for the {title} position at {company} on {applied_date}, and I wanted to follow up. During my internship at Sample Labs I built a Python script.';
  assert.deepEqual(targetClaims(text), []);
  assert.deepEqual(flagsOf(text, APP, CV_LIVE), []);
  const reply = "Hi {first_name}, I'm open to software engineering roles at {company}. This past summer I interned at Sample Labs and built a Python script.";
  assert.deepEqual(flagsOf(reply, person('Rita Reply', INITECH, 'reply'), CV_LIVE), []);
});

test('fix 7 M2 and M3 acronyms: look-alike cv initials ground nothing, and an acronym company is a literal name or a placeholder claim', () => {
  for (const [text, term] of [['Hi {first_name}, I hold a CS degree and want to learn more.', 'CS'], ['Hi {first_name}, I build AI models in my spare time.', 'AI'], ['Hi {first_name}, I am finishing my MBA this spring.', 'MBA'], ['Hi {first_name}, I do ML research.', 'ML']]) {
    assert.match(flagsOf(text, ALICE).join('; '), new RegExp(`names facts absent from cv\\.md: .*\\b${term}\\b`), text);
  }
  assert.match(flagsOf("Hi {first_name}, I'm a CS student.", ALICE, 'BS Computer Science, Example State University, 2027').join('; '), /^$/);
  assert.deepEqual(flagsOf("Hi {first_name}, I'd love to learn about your work at {company}.", HANA), []);
  assert.deepEqual(literalTargets('I interned at HP.', HANA), ['HP']);
  assert.deepEqual(literalTargets('I worked at IBM.', IAN), ['IBM']);
  assert.deepEqual(literalTargets('I met people from AE at a fair.', ALICE), ['AE'], 'a company of two or more words is caught by its initials too');
  for (const k of ['CS', 'TA', 'GPA', 'CV', 'AI', 'ML', 'UX', 'UI', 'SQL', 'API']) assert.ok(ACRONYMS[k]?.length, k);
});

test('fix 7 M4 the submit date grounds no number; it is written only as {applied_date}', () => {
  assert.ok(!draftFacts(APP).includes('2026-11-14'));
  for (const [text, n] of [['I mentored 14 students last year.', '14'], ['I grew signups by 11% at my club.', '11%'], ['I tutored 2026 students.', '2026']]) {
    assert.match(flagsOf(text, APP).join('; '), new RegExp(`absent from cv\\.md: .*${n}`), text);
  }
  for (const text of ['I applied on 14 November 2026.', 'I applied on November 14.', 'I applied on Nov. 14th.', 'I applied on 11/14.', 'I applied for the {title} role at {company} on 2026-11-14.']) {
    assert.equal(literalTargets(text, APP).length, 1, text);
  }
  assert.deepEqual(flagsOf('I applied for the {title} role on {applied_date}.', APP), []);
});

test('fix 7 S1 honest follow-ups and openers pass', () => {
  const pass = [
    ['Hello hiring team,\n\nI recently applied to the {title} role at {company} and wanted to follow up.', APP],
    ['Hello hiring team,\n\nI applied for the {title} position at {company} on {applied_date}.', APP],
    ['Hello {company} hiring team,\n\nI applied for the {title} role at {company} on {applied_date}.', APP],
    ['Dear {company} hiring team,\n\nI am following up on my application.', APP],
    ['Hi {company} recruiting team,\n\nFollowing up on my {title} application.', APP],
    ['Good morning {company} hiring team,\n\nI am writing about my application for the {title} role.', APP],
    ["Hi {first_name}, I'm curious about the work at {company}.", ALICE],
    ["Hi {first_name}, I'm curious how your team at {company} works.", ALICE],
    ['Hi {first_name}, I saw that {company} is hiring interns.', ALICE],
  ];
  for (const [text, job] of pass) assert.deepEqual(flagsOf(text, job, CV_LIVE), [], text);
});

test('fix 7 a sentence-final "first" (send my CV first) is no ordinal claim; "I finished first" still is', () => {
  assert.deepEqual(factCheck('Would it be easier to chat briefly, or should I send over my CV first?', { cv: CV_LIVE, answers: ['CV'] }), []);
  assert.deepEqual(factCheck('In the hackathon I finished first.', { cv: CV_LIVE }), ['finished first']);
});

const LIVE_DRAFTS = [
  {src: "r3 batch",action: "warm-opener",text: "Hi {first_name}, I'm Sam, a computer science student at Example State University. I interned at Sample Labs this summer and built a Python script to automate a weekly report. I'd love to learn about your work at {company}. What does a typical week look like for you?"},
  {src: "r3 batch",action: "connect",text: "Hi {first_name}, I'm a CS student at Example State and a Data Structures TA. I built a Python script at Sample Labs that cut a weekly report from 2 hours to 10 minutes. I'd like to connect."},
  {src: "r3 batch",action: "follow-up",text: "Hi {first_name}, just a quick follow-up on my earlier note. I'm a computer science student at Example State University, graduating May 2027, and I recently finished a software engineering internship at Sample Labs where I built a Python script that cut a weekly report from 2 hours to 10 minutes. I'd still love to be considered for a role at {company}. Would it help if I sent over my CV or a short link to my Campus Bus Tracker project?\n\nThanks,\nSam"},
  {src: "r3 batch",action: "reply",text: "Hi {first_name}, thanks for getting back to me. I don't have a specific team in mind yet. I'm a computer science student at Example State University, and I'm open to software engineering roles where I can keep building with Python, JavaScript and SQL. I graduate in May 2027.\n\nThis past summer I interned at Sample Labs, where I built a Python script that cut a weekly report from 2 hours to 10 minutes. I also built a small web app called Campus Bus Tracker that shows live bus times. If you tell me which teams at {company} are hiring, I'd be happy to say which one fits best. Is there a team you think would suit my background?"},
  {src: "r3 batch",action: "application-follow-up",text: "Hello {company} hiring team,\n\nI applied for the {title} position on {applied_date} and wanted to follow up to say I remain very interested in the role.\n\nI think I would be a good fit because of my internship at Sample Labs this past summer, where I built a Python script that cut a weekly report from 2 hours to 10 minutes. I also work with Python, JavaScript, SQL and Git, and I have been a teaching assistant for Data Structures at Example State University.\n\nIf there is anything else I can send, such as code samples or more details about my projects, I would be happy to share them. I understand you are busy, so there is no rush at all.\n\n\n\nBest regards,\nSam Placeholder"},
  {src: "r3 drafts file",action: "warm-opener",text: "Hi {first_name}, I'm Sam, a CS student at Example State University. I'm reaching out because I'd love to learn from people at {company}. I recently built a Python script that cut a weekly report from 2 hours to 10 minutes. What kind of problems does your team spend most of its time on?"},
  {src: "r3 drafts file",action: "connect",text: "Hi {first_name}, I'm a CS student at Example State and built a Python script at Sample Labs that cut a weekly report from 2 hours to 10 minutes. I'd like to follow your work at {company}."},
  {src: "r3 drafts file",action: "follow-up",text: "Hi {first_name},\n\nJust a quick nudge on my earlier note. I'm a computer science student at Example State University, graduating in May 2027, and I'd still love to be considered for a role at {company}. At my Sample Labs internship I built a Python script that cut a weekly report from 2 hours to 10 minutes, and I think that kind of work could be useful to your team.\n\nWould it be easier if I sent over my CV, or is there a better person for me to reach out to?\n\nThanks so much,\nSam"},
  {src: "r3 drafts file",action: "reply",text: "Hi {first_name}, thanks for getting back to me. I haven't picked one specific team yet. I'm a computer science student and I'd be glad to join wherever my Python, JavaScript and SQL skills are most useful, so I'd love to hear which teams at {company} take interns or new grads.\n\nI graduate in May 2027 from Example State University. This past summer I interned at Sample Labs, where I wrote a Python script that cut a weekly report from 2 hours to 10 minutes. Is there a team you think would be a good fit?\n\nSam"},
  {src: "r4 2-cap-model-texts",action: "warm-opener",text: "Hi {first_name}, I'm a CS student at Example State University and a former TA for Data Structures. I'm reaching out because I'd love to learn from people at {company}. I recently built a Python script that cut a weekly report from 2 hours to 10 minutes. What kind of work does your team do?"},
  {src: "r4 2-cap-model-texts",action: "connect",text: "Hi {first_name}, I'm a CS student at Example State and I built a Python script at Sample Labs that cut a weekly report from 2 hours to 10 minutes. I'd like to connect with you at {company}."},
  {src: "r4 2-cap-model-texts",action: "follow-up",text: "Hi {first_name},\n\nJust a quick reminder about my earlier note. I'm a computer science student at Example State University, and I recently finished a software engineering internship at Sample Labs, where I built a Python script that cut a weekly report from 2 hours to 10 minutes.\n\nWould it be easier to chat briefly, or should I send over my CV first?\n\nThanks,\nSam"},
  {src: "r4 2-cap-model-texts",action: "reply",text: "Hi {first_name}, thanks for getting back to me! I graduate in May 2027 with a computer science degree from Example State University. I haven't picked one specific team, but I'm most interested in software engineering work where I can use Python, JavaScript and SQL. This past summer I interned at Sample Labs, where I built a Python script that cut a weekly report from 2 hours to 10 minutes, and I enjoyed that kind of problem solving a lot. Is there a team at {company} that you think would be a good fit for that background? I'd be happy to share my resume or set up a quick chat.\n\nBest,\nSam"},
  {src: "r4 2-cap-model-texts",action: "application-follow-up",text: "Hello {company} hiring team,\n\nI applied for the {title} role on {applied_date} and wanted to follow up briefly.\n\nI think I would be a good fit because of my internship at Sample Labs, where I built a Python script that cut a weekly report from 2 hours to 10 minutes. I enjoy turning slow, manual work into something simple and reliable, and I would like to bring that to your team.\n\nIf there is anything else I can send, such as code samples or more detail on my projects, I would be happy to share it. Thank you for your time and for considering my application.\n\nBest regards,\nSam Placeholder"},
  {src: "r4 3-capoff-model-texts",action: "warm-opener",text: "Hi {first_name}, I'm Sam, a CS student at Example State University. I'm reaching out because I'd love to learn more about your work at {company}. I enjoy building practical tools, like a Python script that turned a 2 hour report into 10 minutes. What do you enjoy most about your work?"},
  {src: "r4 3-capoff-model-texts",action: "connect",text: "Hi {first_name}, I'm a CS student at Example State and built a Python script at Sample Labs that cut a weekly report from 2 hours to 10 minutes. I'd like to connect with you at {company}."},
  {src: "r4 3-capoff-model-texts",action: "follow-up",text: "Hi {first_name}, just following up on my earlier note in case it got buried. I'm a computer science student at Example State University graduating in May 2027, and I recently interned at Sample Labs, where I built a Python script that cut a weekly report from 2 hours to 10 minutes. I'd still love to be considered for a role at {company}. Is there a good time this week for a quick chat, or is there someone else I should reach out to instead?\n\nThanks,\nSam"},
  {src: "r4 3-capoff-model-texts",action: "reply",text: "Hi {first_name}, thanks for getting back to me! I graduate in May 2027 from Example State University, where I study computer science. I don't have a specific team in mind yet. I'm open to software engineering roles at {company}, especially anything using Python, JavaScript or SQL.\n\nThis past summer I interned at Sample Labs and built a Python script that cut a weekly report from 2 hours to 10 minutes, and I enjoyed that kind of work. I've also been a teaching assistant for Data Structures. Which teams are hiring for new grads, and what would you suggest as a good fit?"},
  {src: "r4 3-capoff-model-texts",action: "application-follow-up",text: "Hello Hiring team,\n\nI applied for the {title} position at {company} on {applied_date}, and I wanted to follow up briefly to say I am still very interested.\n\nI think I would be a good fit because of my internship at Sample Labs last summer. There I built a Python script that cut a weekly report from 2 hours to 10 minutes. I enjoy finding practical ways to make work simpler, and I would like to do the same for your team.\n\nIf there is anything else I can send, such as code samples or more details about my projects, please let me know. I understand you are busy, and I appreciate your time and consideration.\n\nBest regards,\nSam Placeholder"},
  {src: "r4 3-capoff-texts-try1",action: "warm-opener",text: "Hi {first_name}, I'm Sam, a computer science student at Example State University. I'm reaching out because I'm curious about the work at {company}. I recently built a Python script that turned a 2 hour weekly report into 10 minutes. What kind of problems does your team spend most of its time on?"},
  {src: "r4 3-capoff-texts-try1",action: "connect",text: "Hi {first_name}, I'm a CS student at Example State University. I built a Python script at Sample Labs that cut a weekly report from 2 hours to 10 minutes. I'd like to connect with you at {company}."},
  {src: "r4 3-capoff-texts-try1",action: "follow-up",text: "Hi {first_name},\n\nJust a quick follow-up on my earlier note. I'm a computer science student at Example State University, graduating May 2027, and I'd love to be considered for a software role at {company}. Last summer I interned at Sample Labs, where I wrote a Python script that cut a weekly report from 2 hours to 10 minutes.\n\nWould it be easier if I sent over my CV, or is there a better person for me to reach out to?\n\nThanks so much,\nSam"},
  {src: "r4 3-capoff-texts-try1",action: "reply",text: "Hi {first_name}, thanks for getting back to me. I haven't picked one specific team yet, but I'm most interested in software engineering roles where I can build on my Python and JavaScript work. I graduate in May 2027 from Example State University.\n\nLast summer I interned at Sample Labs, where I wrote a Python script that cut a weekly report from 2 hours to 10 minutes. I also built a small web app called Campus Bus Tracker that shows live bus times. If you have a team in mind at {company} that fits this kind of work, I'd love to hear about it. Is there a good time for a quick chat?\n\nBest,\nSam"},
  {src: "r4 3-capoff-texts-try1",action: "application-follow-up",text: "Hello {company} hiring team,\n\nI applied for the {title} position on {applied_date} and wanted to follow up politely. I am still very interested in the role.\n\nOne reason I think I am a good fit: during my software engineering internship at Sample Labs this summer, I built a Python script that cut a weekly report from 2 hours to 10 minutes. I enjoy finding practical ways to make work faster and simpler, and I would like to bring that approach to your team.\n\nIf there is anything else I can send, such as code samples or more details about my projects, I would be happy to provide it. I understand you are busy, so please take your time.\n\nThank you for considering my application.\n\nBest regards,\nSam Placeholder"},
];
const LIVE_PEOPLE = { 'warm-opener': 'Alice Alpha', connect: 'Carl Connect', 'follow-up': 'Nora Nudge', reply: 'Rita Reply' };
const LIVE_COMPANY = { 'warm-opener': ACME, connect: 'Wayne Example', 'follow-up': 'Umbrella Example', reply: INITECH };

test('fix 7 every live round 3 and round 4 real-model draft passes in placeholder form', () => {
  assert.equal(LIVE_DRAFTS.length, 24);
  for (const d of LIVE_DRAFTS) {
    const job = d.action === 'application-follow-up' ? APP : { ...person(LIVE_PEOPLE[d.action], LIVE_COMPANY[d.action], d.action), noteChars: 200 };
    assert.deepEqual(flagsOf(d.text, job, CV_LIVE), [], `${d.src} ${d.action}: ${d.text}`);
  }
});

test('fix 7 the placeholders are filled in only after the checks, to the exact final text', () => {
  assert.equal(fillPlaceholders('Hello {company} hiring team, I applied for the {title} role on {applied_date}.', APP), `Hello ${GLOBEX} hiring team, I applied for the ${TITLE} role on November 14, 2026.`);
  assert.equal(fillPlaceholders("Hi {first_name}, I'd love to hear about {company}.", ALICE), `Hi Alice, I'd love to hear about ${ACME}.`);
  assert.match(flagsOf('Hi {first_name}, I applied for the {title} role.', ALICE).join('; '), /uses \{title\}, which this draft has no value for/);
  const prompt = draftPrompt({ ...APP, cv: CV_LIVE });
  assert.match(prompt, /\{company\}/);
  assert.match(prompt, /\{applied_date\}/);
  assert.match(prompt, /Never write the company name, job title or date themselves/);
});

// A round for one Globex follow-up whose fake model answers with the replies in turn.
async function followupRound(replies) {
  const r = makeRoot();
  r.write('cv.md', CV_LIVE);
  r.write('data/contacts.tsv', serializeTsv(['date', 'company', 'name', 'stage', 'role'], []));
  r.write('data/pipeline.md', `# Pipeline\n\n## Processed\n\n- [x] ${GLOBEX_APP} | ${GLOBEX} | ${TITLE} | Remote\n`);
  const prompts = [];
  const headless = async (opts) => {
    prompts.push(String(opts.prompt));
    return { text: replies[Math.min(prompts.length - 1, replies.length - 1)], model: 'sonnet', usage: null };
  };
  try {
    const state = { due: [], followups: [{ target: GLOBEX_APP, company: GLOBEX, submitted: '2026-11-14', email: 'recruiter@example.com' }] };
    const res = await outreachDrafts({ paths: resolvePaths({ root: r.root, dataDir: r.data }), today: DAY, replies: [], deps: { headless, state, t6On: false }, say: () => {} });
    return { res, prompts, items: res.ids.flatMap((id) => readBatch(r.data, id).items) };
  } finally {
    r.cleanup();
  }
}

const LITERAL_REPLY = `Hello ${GLOBEX} hiring team,\n\nI applied for the ${TITLE} role and wanted to follow up.\n\nBest regards,\nSam Placeholder`;
const PLACEHOLDER_REPLY = 'Hello {company} hiring team,\n\nI applied for the {title} role on {applied_date} and wanted to follow up.\n\nBest regards,\nSam Placeholder';

test('fix 7 a reply that writes the company or title as is gets one retry stating why, then is flagged', async () => {
  const twice = await followupRound([LITERAL_REPLY, LITERAL_REPLY]);
  assert.equal(twice.prompts.length, 2, 'one retry only');
  // The live cv holds "Software engineering intern" itself, so only the company counts as a target name written as is.
  assert.match(twice.prompts[1], new RegExp(`Your last draft wrote "${GLOBEX}" as is`));
  assert.equal(twice.items.length, 0);
  assert.match(twice.res.flagged[0]?.flags.join('; ') ?? '', /as is instead of \{company\}/);
  const fixed = await followupRound([LITERAL_REPLY, PLACEHOLDER_REPLY]);
  assert.equal(fixed.prompts.length, 2);
  assert.deepEqual(fixed.res.flagged, []);
  assert.equal(fixed.items[0].message, `Hello ${GLOBEX} hiring team,\n\nI applied for the ${TITLE} role on November 14, 2026 and wanted to follow up.\n\nBest regards,\nSam Placeholder`);
  const first = await followupRound([PLACEHOLDER_REPLY]);
  assert.equal(first.prompts.length, 1, 'a placeholder draft needs no retry');
  assert.equal(first.items.length, 1);
});
