// SYNTHETIC FIXTURE: placeholder people, companies and cv text only.
// M-004 fix 7, re-pinned in the fix 9 shape ("slots + facts by id"). The fix 7 probes (claims about the company or
// title, acronym look-alikes, the submit date as a number source) and the live round 3 and 4 drafts are kept; the model
// now returns slot JSON, so each probe is shown rejected in every slot of its kind, and each honest live question passes
// as a question slot while the student facts of those drafts are cv.md lines in the fact list. The cover and fill gate
// keeps the c9d0be8 reading of "first". Scratch roots, synthetic placeholder people and companies, example.com addresses
// and an injected headless runner: no real model, network, Gmail or LinkedIn. LIVE_DRAFTS are the real-model drafts of
// live rounds 3 and 4 (synthetic student), with the company, title, date and greeting name turned into placeholders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check as factCheck } from '../../lib/fact-gate.mjs';
import { readBatch } from '../../lib/batch-file.mjs';
import { resolvePaths } from '../../lib/paths.mjs';
import { serializeTsv } from '../../lib/tsv.mjs';
import { KINDS, checkDraft, contactRoles, draftFacts, draftPrompt, factList, fillPlaceholders, outreachDrafts, slotProblems } from '../../scripts/outreach-drafts.mjs';
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

// The flags of one slot reply for a job, against a cv (the probe cv by default).
const flagsOf = (slots, job, cv = CV_PROBE) => checkDraft(JSON.stringify({ fact_ids: [], ...slots }), { ...job, roles: contactRoles(job, ROWS) }, { facts: factList(cv), cv, own: draftFacts(job, { candidate: { full_name: 'Sam Placeholder' } }) });
// The placeholder form of a literal probe sentence.
const toPlaceholders = (text, job) => (job.application?.title ? text.replaceAll(job.application.title, '{title}') : text).replaceAll(job.contact.company, '{company}');
const asQuestion = (t) => `${t.trim().replace(/[.!]+$/, '')}?`;
// A slot reply that puts text in one slot (an opener also gets an honest question, so only the probe can fail).
const inSlot = (slot, text, job) => ({ [slot]: slot === 'question' ? asQuestion(text) : text, ...(slot === 'warm_line' && KINDS[job.action].required.includes('question') ? { question: 'What does a typical week look like for you?' } : {}) });

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

test('fix 7 M1 (fix 9 shape) every probe claim, as written and in placeholder form, is rejected in every slot of its kind', () => {
  for (const [id, text, job] of CLAIMS) {
    const ph = toPlaceholders(text, job);
    assert.notEqual(ph, text, `${id} names a target`);
    for (const form of [text, ph]) {
      for (const slot of KINDS[job.action].slots) {
        const r = flagsOf(inSlot(slot, form, job), job);
        assert.ok(r.flags.length, `${id} ${slot}: ${form}`);
        assert.equal(r.text, '', `${id}: a flagged draft has no text`);
      }
    }
  }
});

test('fix 7 M1 (fix 9 shape) a true cv fact never makes an honest slot fail; the fact is placed word for word', () => {
  const app = flagsOf({ fact_ids: [3] }, APP, CV_LIVE);
  assert.deepEqual(app.flags, []);
  assert.ok(app.text.includes('Software engineering intern at Sample Labs (summer 2026): built a Python script that cut a weekly report from 2 hours to 10 minutes.'), app.text);
  const reply = flagsOf({ question: 'Which software engineering teams at {company} are growing?', fact_ids: [1, 3] }, person('Rita Reply', INITECH, 'reply'), CV_LIVE);
  assert.deepEqual(reply.flags, []);
});

test('fix 7 M2 and M3 (fix 9 shape) acronyms: look-alike cv initials ground nothing; an acronym company is named only in a question', () => {
  for (const [slots, term] of [[{ question: 'Does a CS degree help on your team?' }, 'CS'], [{ question: 'Does an MBA help on your team?' }, 'MBA'], [{ warm_line: 'Builds AI models.', question: 'What is new?' }, /AI|Builds/], [{ warm_line: 'Does ML research.', question: 'What is new?' }, /ML|statement/]]) {
    assert.match(flagsOf(slots, ALICE).flags.join('; '), term instanceof RegExp ? term : new RegExp(`\\b${term}\\b`), JSON.stringify(slots));
  }
  assert.ok(!factList(CV_PROBE).some((f) => /\b(?:CS|AI|MBA|HP|IBM)\b/.test(f.text)), 'the probe cv holds none of them, so no fact can carry them');
  assert.deepEqual(flagsOf({ question: 'What is the work at HP like?' }, HANA).flags, []);
  assert.match(flagsOf({ warm_line: 'Interned at HP.', question: 'What is new?' }, HANA).flags.join('; '), /names the company/);
  assert.match(flagsOf({ warm_line: 'Worked at IBM on the data team.', question: 'What is new?' }, IAN).flags.join('; '), /names the company/);
  assert.match(flagsOf({ question: 'Do you know people from AE?' }, ALICE).flags.join('; '), /not allowed here: AE/, 'the initials of a two-word company are no allowed name');
});

test('fix 7 M4 (fix 9 shape) the submit date grounds no number: no slot holds a digit or a date, and only code states the date', () => {
  assert.ok(!draftFacts(APP).includes('2026-11-14'));
  for (const t of ['I mentored 14 students last year.', 'Signups grew by 11% at the club.', 'The role on 11/14 stands out.', 'The role posted November 14 stands out.', 'Congrats on the 2026 launch.']) {
    assert.ok(flagsOf({ warm_line: t }, APP).flags.length, t);
  }
  const prompt = draftPrompt({ ...APP, cv: CV_LIVE });
  assert.ok(!/2026-11-14|\{applied_date\}/.test(prompt), prompt);
  const r = flagsOf({}, APP, CV_LIVE);
  assert.deepEqual(r.flags, []);
  assert.equal(r.text.match(/November 14, 2026/g).length, 1, 'the date once, in the code-written opening');
});

test('fix 7 S1 (fix 9 shape) honest follow-ups and openers pass', () => {
  const pass = [
    [{}, APP],
    [{ warm_line: 'The focus on practical tools in this role stands out.' }, APP],
    [{ fact_ids: [3, 4] }, APP],
    [{ question: 'What is the work at {company} like?' }, ALICE],
    [{ question: 'How does your team at {company} work day to day?' }, ALICE],
    [{ question: 'Is {company} hiring interns?' }, ALICE],
  ];
  for (const [slots, job] of pass) assert.deepEqual(flagsOf(slots, job, CV_LIVE).flags, [], JSON.stringify(slots));
});

test('fix 7 "send my CV first" is a claim to the shared gate with or without the old outreach option; "I finished first" always is', () => {
  assert.deepEqual(factCheck('Would it be easier to chat briefly, or should I send over my CV first?', { cv: CV_LIVE, answers: ['CV'] }), ['first'], 'the cover and fill gate is the c9d0be8 gate');
  assert.deepEqual(factCheck('Would it be easier to chat briefly, or should I send over my CV first?', { cv: CV_LIVE, answers: ['CV'], outreach: true }), ['first'], 'fix 9: no outreach exemption');
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

// First-person words, which no slot may hold.
const FIRST_PERSON = /(?<![\p{L}'])(?:i|me|my|mine|myself|we|us|our|ours)(?![\p{L}])/iu;

test('fix 7 every live round 3 and round 4 draft: its questions with no first-person word pass as a question slot, and its student facts are cv.md lines', () => {
  assert.equal(LIVE_DRAFTS.length, 24);
  const facts = factList(CV_LIVE).map((f) => f.text).join('\n');
  let questions = 0;
  for (const d of LIVE_DRAFTS) {
    const job = d.action === 'application-follow-up' ? APP : person(LIVE_PEOPLE[d.action], LIVE_COMPANY[d.action], d.action);
    for (const q of d.text.split(/(?<=[.!?])\s+|\n+/).filter((x) => /\?$/.test(x) && !FIRST_PERSON.test(x))) {
      assert.deepEqual(slotProblems('question', q, job), [], `${d.src} ${d.action}: ${q}`);
      questions += 1;
    }
  }
  assert.ok(questions >= 8, `${questions} live questions`);
  for (const claim of ['built a Python script that cut a weekly report from 2 hours to 10 minutes', 'Teaching assistant for Data Structures', 'Computer science student at Example State University, graduating May 2027', 'Campus Bus Tracker: a small web app in JavaScript and Python that shows live bus times']) {
    assert.ok(facts.includes(claim), `${claim} is a fact the model can pick by id`);
  }
});

test('fix 7 the placeholders are filled in only after the checks, to the exact final text', () => {
  assert.equal(fillPlaceholders('Hello {company} hiring team, I applied for the {title} role on {applied_date}.', APP), `Hello ${GLOBEX} hiring team, I applied for the ${TITLE} role on November 14, 2026.`);
  assert.equal(fillPlaceholders("Hi {first_name}, what is new at {company}?", ALICE), `Hi Alice, what is new at ${ACME}?`);
  assert.match(flagsOf({ question: 'What does the {title} role involve?' }, ALICE).flags.join('; '), /placeholder-like or bracket text "\{title\}"/);
  const prompt = draftPrompt({ ...APP, cv: CV_LIVE });
  assert.match(prompt, /\{company\}/);
  assert.match(prompt, /one JSON object/);
  assert.match(prompt, /Code writes the greeting, any sentence about an application or its date/);
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

const LITERAL_REPLY = `Hello ${GLOBEX} hiring team,\n\nI am still interested in the ${TITLE} role at ${GLOBEX}.\n\nBest regards,\nSam Placeholder`;
// Fact 3 of CV_LIVE is the internship line.
const SLOT_REPLY = JSON.stringify({ warm_line: 'The focus on practical tools in this role stands out.', fact_ids: [3] });

test('fix 7 (fix 9 shape) a free-text reply naming the company or title gets one retry stating why, then is flagged; a slot reply is filled', async () => {
  const twice = await followupRound([LITERAL_REPLY, LITERAL_REPLY]);
  assert.equal(twice.prompts.length, 2, 'one retry only');
  assert.match(twice.prompts[1], /Your last reply broke these rules:\n- the reply is not one JSON object/);
  assert.equal(twice.items.length, 0);
  assert.match(twice.res.flagged[0]?.flags.join('; ') ?? '', /not one JSON object/);
  const fixed = await followupRound([LITERAL_REPLY, SLOT_REPLY]);
  assert.equal(fixed.prompts.length, 2);
  assert.deepEqual(fixed.res.flagged, []);
  assert.equal(fixed.items[0].message, `Hello ${GLOBEX} hiring team,\n\nI applied for the ${TITLE} role at ${GLOBEX} on November 14, 2026, and I wanted to follow up. The focus on practical tools in this role stands out.\n\nA bit about my background: Software engineering intern at Sample Labs (summer 2026): built a Python script that cut a weekly report from 2 hours to 10 minutes.\n\nPlease let me know if there is anything else I can send.\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder`);
  const first = await followupRound([SLOT_REPLY]);
  assert.equal(first.prompts.length, 1, 'a slot reply that keeps every rule needs no retry');
  assert.equal(first.items.length, 1);
});
