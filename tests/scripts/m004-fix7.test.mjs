// SYNTHETIC FIXTURE: placeholder people, companies and cv text only.
// M-004 fix 7 cases, re-pinned in the fix 10 shape ("warm prose + hard rails + independent verifier"). The fix 7
// probes (claims about the company or title, acronym look-alikes, the submit date as a number source) are no longer
// judged by a regex claim rule: each, as written and in placeholder form, reaches the verifier verbatim inside the final
// string, and a verdict naming it keeps it out. The live round 3 and 4 drafts pass the rails. The cover and fill gate
// keeps the c9d0be8 reading of "first". Scratch roots, synthetic placeholder people and companies, example.com
// addresses and an injected headless runner: no real model, network, Gmail or LinkedIn. LIVE_DRAFTS are the real-model
// drafts of live rounds 3 and 4 (synthetic student), with the company, title, date and greeting name turned into
// placeholders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check as factCheck } from '../../lib/fact-gate.mjs';
import { checkDraft, draftPrompt, fillPlaceholders } from '../../scripts/outreach-drafts.mjs';
import { ACME, APP, CV as CV_LIVE, GLOBEX, INITECH, SOURCES, TITLE, draftIn, person, roundFor } from '../helpers/outreach-verify-harness.mjs';

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

// Contact probes run as a follow-up (no length cap, no first-message referral rail), so only the verifier can hold them.
const follow = (name, company) => person(name, company, 'follow-up');
const ALICE = follow('Alice Alpha', ACME);
const CARL = follow('Carl Chen', INITECH);
const HANA = follow('Hana Ho', 'HP');
const IAN = follow('Ian Ito', 'IBM');

const check = (text, job, sources = SOURCES) => checkDraft(text, job, { sources });
// The placeholder form of a literal probe sentence.
const toPlaceholders = (text, job) => (job.application?.title ? text.replaceAll(job.application.title, '{title}') : text).replaceAll(job.contact.company, '{company}');
// The probe as it must appear in the final string: a leading greeting off, the placeholders filled.
const expected = (text, job) => fillPlaceholders(text.replace(/^(?:hi|hello)\b[^,\n]*,\s*/i, '').replace(/^\p{Ll}/u, (c) => c.toUpperCase()), job);

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


// Fix 7 M2/M3 (acronym look-alikes) and M4 (the submit date as a number source), as model bodies.
const ACRONYMS = [
  ['M2a', 'I hold a CS degree.', ALICE], ['M2b', 'I am finishing my MBA this spring.', ALICE], ['M2c', 'I build AI models in my spare time.', ALICE],
  ['M2d', 'I do ML research.', ALICE], ['M2e', 'I met folks from AE at a fair.', ALICE], ['M4a', 'I mentored 14 students last year.', APP],
  ['M4b', 'Signups grew by 11% at my club.', APP], ['M4c', 'I applied on 11/14 and also interned there.', APP],
];

test('fix 7 M1 to M4 (fix 10) every probe claim, as written and in placeholder form, reaches the verifier verbatim and its verdict keeps it out', async () => {
  for (const [id, text, job] of [...CLAIMS.map(([id, t, j]) => [id, t, j.action === 'application-follow-up' ? j : follow(j.contact.name, j.contact.company)]), ...ACRONYMS]) {
    const forms = ACRONYMS.some((a) => a[0] === id) ? [text] : [text, toPlaceholders(text, job)];
    if (forms.length === 2) assert.notEqual(forms[1], text, `${id} names a target`);
    for (const form of forms) {
      const want = expected(form, job);
      const out = await roundFor(job, { drafts: [form], cv: CV_PROBE, verdict: (prompt) => JSON.stringify({ unsupported: draftIn(prompt).includes(want) ? [want] : [] }) });
      assert.ok(out.verifies.length >= 1, `${id} verified: ${JSON.stringify(out.res.flagged)}`);
      assert.ok(draftIn(out.verifies[0].prompt).includes(want), `${id}: ${want}`);
      assert.ok(out.verifies[0].prompt.includes(CV_PROBE.trim()), 'the probe cv is the fact source');
      assert.equal(out.items.length, 0, `${id} kept out`);
    }
  }
});

test('fix 7 M4 (fix 10) the drafting prompt holds no submit date; only code states it, once', () => {
  const prompt = draftPrompt({ ...APP, cv: CV_LIVE });
  assert.ok(!/2026-11-14|November 14|\{applied_date\}/.test(prompt), prompt);
  const r = check('My internship at Sample Labs is a close match for the role.', APP);
  assert.deepEqual(r.flags, []);
  assert.equal(r.text.match(/November 14, 2026/g).length, 1, 'the date once, in the code-written opening');
});

test('fix 7 S1 (fix 10) honest follow-ups and openers pass the rails', () => {
  const pass = [
    ['The focus on practical tools in this role stands out.', APP],
    ['I am still interested in the {title} role at {company}, and my Sample Labs internship is a close match.', APP],
    ['What is the work at {company} like?', person('Alice Alpha', ACME)],
    ['How does your team at {company} work day to day?', person('Alice Alpha', ACME)],
    ['Is {company} hiring interns?', person('Alice Alpha', ACME)],
  ];
  for (const [text, job] of pass) assert.deepEqual(check(text, job).flags, [], text);
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


test('fix 7 (fix 10) every live round 3 and round 4 draft passes the rails; an over-long opener is the length rail, nothing else', () => {
  assert.equal(LIVE_DRAFTS.length, 24);
  for (const d of LIVE_DRAFTS) {
    const job = d.action === 'application-follow-up' ? APP : person(LIVE_PEOPLE[d.action], LIVE_COMPANY[d.action], d.action, d.action === 'connect' ? { noteChars: 300 } : d.action === 'reply' ? { replyText: 'Which team interests you?' } : {});
    const r = check(d.text, job);
    const flags = r.flags.filter((f) => !/^opener of \d+ characters exceeds the 299 limit$/.test(f));
    assert.deepEqual(flags, [], `${d.src} ${d.action}: ${r.text}`);
    if (job === APP) assert.equal(r.text.match(/November 14, 2026/g).length, 1, `${d.src}: the date once: ${r.text}`);
  }
});

test('fix 7 the placeholders are filled in the final text; a placeholder the job has no value for is a rail failure', () => {
  assert.equal(fillPlaceholders('Hello {company} hiring team, I applied for the {title} role on {applied_date}.', APP), `Hello ${GLOBEX} hiring team, I applied for the ${TITLE} role on November 14, 2026.`);
  assert.equal(fillPlaceholders('Hi {first_name}, what is new at {company}?', person('Alice Alpha', ACME)), `Hi Alice, what is new at ${ACME}?`);
  assert.match(check('What does the {title} role involve?', person('Alice Alpha', ACME)).flags.join('; '), /placeholder-like text "\{title\}"/);
  const prompt = draftPrompt({ ...APP, cv: CV_LIVE });
  assert.match(prompt, /\{company\}/);
  assert.match(prompt, /Write the body only\. Code adds the greeting/);
});

test('fix 7 (fix 10) a reply naming the company or title literally is no code rule: it is verified and stored as the exact final string', async () => {
  const literal = `Hello ${GLOBEX} hiring team,\n\nI am still interested in the ${TITLE} role at ${GLOBEX}, and my Sample Labs internship is a close match.\n\nBest regards,\nSam Placeholder`;
  const out = await roundFor(APP, { drafts: [literal] });
  assert.equal(out.drafting.length, 1);
  assert.equal(out.items[0].message, `Hello ${GLOBEX} hiring team,\n\nI applied for the ${TITLE} role at ${GLOBEX} on November 14, 2026, and I wanted to follow up.\n\nI am still interested in the ${TITLE} role at ${GLOBEX}, and my Sample Labs internship is a close match.\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder`);
  assert.equal(draftIn(out.verifies[0].prompt), out.items[0].message);
});
