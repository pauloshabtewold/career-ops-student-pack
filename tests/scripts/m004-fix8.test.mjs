// SYNTHETIC FIXTURE: placeholder people, companies and cv text only.
// M-004 fix 8: the outreach fact gate is closed by construction. Code writes every sentence that names the target (the
// greeting, an application follow-up's "I applied for the {title} role at {company} on {applied_date}." and an email's
// "Thank you for your time and consideration." plus sign-off); the model writes only the body, and its own greeting or
// sign-off is dropped. In the body {company} and {title} may appear only in a closed list of no-claim phrases, and every
// clause with first-person experience wording that refers to the target (a placeholder phrase, there, your team, with
// you ...) is flagged. Brace variants are flagged and never sent. Literal names match case-sensitively, and a name cv.md
// holds is no exception. The shared fact gate keeps its c9d0be8 ordinal rules for cover letters and fill plans; the
// reader-question and send-first exemptions are behind the outreach option only.
// Review r6 probe sentences (M1, M2, M3, S1-S3, N1) and live round 5 model replies (ev/r5) in the new body-only shape.
// The r4 and r5 claim probes (A, B, C, F, H) run in m004-fix7.test.mjs. Scratch roots, example.com addresses and an
// injected headless runner: no real model, network, Gmail or LinkedIn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check as factCheck } from '../../lib/fact-gate.mjs';
import { readBatch } from '../../lib/batch-file.mjs';
import { resolvePaths } from '../../lib/paths.mjs';
import { serializeTsv } from '../../lib/tsv.mjs';
import { writeCover } from '../../scripts/cover.mjs';
import { assembleDraft, contactRoles, draftChecks, draftFacts, fillPlaceholders, literalTargets, modelBody, outreachDrafts, targetClaims } from '../../scripts/outreach-drafts.mjs';
import { makeRoot } from '../helpers/script-harness.mjs';

const DAY = '2026-11-22';
const ACME = 'Acme Example';
const GLOBEX = 'Globex Example';
const TITLE = 'Software Engineering Intern';
const GLOBEX_APP = 'https://jobs.example.com/globex/swe-intern';

const CV = `# Sam Placeholder

Computer science student at Example State University, graduating May 2027. GPA 3.6.

## Experience
- Software engineering intern at Sample Labs (summer 2026): built a Python script that cut a weekly report from 2 hours to 10 minutes.
- Teaching assistant for Data Structures at Example State University (2025 to 2026).

## Projects
- Campus Bus Tracker: a small web app in JavaScript and Python that shows live bus times.

## Skills
Python, JavaScript, SQL, Git
`;

const person = (name, company, action = 'warm-opener', extra = {}) => ({ action, channel: 'linkedin', contact: { name, company }, ...extra });
const ALICE = person('Alice Alpha', ACME);
const APP = { action: 'application-follow-up', channel: 'email', contact: { name: 'Hiring team', company: GLOBEX }, application: { target: GLOBEX_APP, company: GLOBEX, submitted: '2026-11-14', title: TITLE } };
const flagsOf = (text, job, cv = CV) => draftChecks(text, { ...job, roles: contactRoles(job, []) }, { cv, facts: draftFacts(job, { candidate: { full_name: 'Sam Placeholder' } }) });
const CLAIM = /makes a claim about the company or job title/;

// Review r6 M1: claims about {company}/{title} that are not "I/we + adverb + verb", and no-claim verbs with a claim object.
const M1 = [
  ['S1', 'Having interned at {company} last summer, I would love to learn more.'],
  ['S2', "As {company}'s summer intern, I would like to stay in touch."],
  ['S3', 'As a {title} at {company} last summer, I would like to follow up.', APP],
  ['S4', "I'm glad to have interned at {company}."],
  ['S5', "I'm excited to have worked with the {company} data team."],
  ['S6', 'I really enjoyed working at {company} last summer.'],
  ['S7', 'I successfully interned at {company}.'],
  ['S8', 'Interning at {company} last summer showed me what good code review looks like.'],
  ['S9', 'Last summer at {company} was the best part of my degree.'],
  ['S10', 'Our team partnered with {company} on a campus project.'],
  ['S11', 'My team and I shipped a feature for {company} last summer.'],
  ['S12', 'I, too, interned at {company}.'],
  ['S13', "I'm thrilled to still be part of {company}."],
  ['S14', 'Working at {company} taught me Python.'],
  ['N1', 'I applied my Python skills at {company} last summer.'],
  ['N2', "I submitted a pull request to {company}'s open source repo."],
  ['N3', 'I wanted to thank {company} for hosting me last summer.'],
  ['N4', "I reached the finals of {company}'s hackathon."],
  ['N5', 'I wanted to thank {company} for the internship last summer.'],
  ['N6', 'I heard about {company} from my manager there.'],
  ['N7', "I'm interested in {company} because I used to work there."],
  ['N8', 'I decided to follow up since I spent a summer at {company}.'],
  ['N9', 'I hoped {company} remembered my internship.'],
  ['N10', "I saw {company}'s office from the inside during my co-op."],
  ['N11', 'I learned how {company} reviews code while on its campus team.'],
  ['W1', 'I would love to rejoin the work at {company}.'],
  ['W2', 'I got to work with your team last summer.'],
];

test('fix 8 M1 every r6 claim about {company} or {title} is flagged, whatever its wording', () => {
  for (const [id, text, job = ALICE] of M1) assert.match(flagsOf(text, job).join('; '), CLAIM, `${id}: ${text}`);
});

// Review r6 M2: the claim sits in a sentence that refers to the target by pronoun ("there", "your team", "with you").
const M2 = [
  ['P1', 'Hi {first_name}, I know {company} well. I interned there last summer.'],
  ['P2', "Hi {first_name}, I'm curious about {company}. I worked there in the summer."],
  ['P3', 'Hi {first_name}, I enjoyed working with your team last summer.'],
  ['P4', 'Hi {first_name}, it was great working with you all on the data team.'],
  ['P5', 'I interned with your team in 2026.', APP],
  ['P5b', 'I interned with your team last summer.', APP],
  ['P6', 'Hi {first_name}, I loved my summer there and want to learn more about {company}.'],
  ['P7', 'Hello {company} hiring team, I interned with you last summer.', APP],
  ['P8', "I'm curious about the work at {company}. There I interned for a summer."],
  ['P9', 'I was on your team last year.'],
];

test('fix 8 M2 a claim that refers to the target as there, your team or with you is flagged in every body sentence', () => {
  for (const [id, text, job = ALICE] of M2) assert.match(flagsOf(text, job).join('; '), CLAIM, `${id}: ${text}`);
});

// Review r6 M3: invented ranks that the cover-letter and fill-plan gate must flag, exactly as c9d0be8 did.
const COVER_CV = '# Sam Placeholder\n\nComputer science student at Example State University.\n\n## Projects\n- Campus Bus Tracker, hackathon entry (2025).\n';
const RANKS = [
  ['Our bus tracker got first.', ['first']],
  ['At the 2025 campus hackathon our team got first.', ['first']],
  ['My essay was awarded first.', ['first']],
  ['I graduated first.', ['first']],
  ['Our app scored first.', ['first']],
  ['My robot took home first.', ['first']],
  ['Out of all the teams, we ended up first.', ['first']],
  ['Our team finished first.', ['finished first']],
  ['I placed first.', ['placed first']],
  ['Should I send my CV first?', ['first', 'CV']],
];

test('fix 8 M3 the cover-letter gate flags every invented rank as c9d0be8 did, through writeCover', async () => {
  for (const [sentence, expected] of RANKS) {
    assert.deepEqual(factCheck(sentence, { cv: COVER_CV, company: ACME, role: 'Data Analyst' }), expected, sentence);
    const r = makeRoot();
    try {
      const headless = async () => ({ text: sentence, model: 'sonnet', usage: null });
      const res = await writeCover({ cv: COVER_CV, posting: 'Data Analyst at Acme Example.', answers: {}, company: ACME, role: 'Data Analyst', presets: [], signature: 'Sam Placeholder', dataDir: r.data, date: DAY, headless });
      assert.equal(res.ok, false, `cover path: ${sentence}`);
      assert.match(res.flags.join('; '), /cover paragraph named facts absent from cv\.md: .*first/, sentence);
    } finally {
      r.cleanup();
    }
  }
});

test('fix 8 M3 the fill-plan gate call (factCheck(text, { cv })) flags every invented rank; only outreach passes the option', () => {
  for (const [sentence] of RANKS) {
    assert.ok(factCheck(sentence, { cv: COVER_CV }).some((x) => /first/.test(x)), `fill path: ${sentence}`);
  }
  for (const [sentence] of RANKS.slice(0, 9)) {
    assert.ok(factCheck(sentence, { cv: COVER_CV, outreach: true }).some((x) => /first/.test(x)), `a rank stays a claim with the outreach option: ${sentence}`);
  }
  const question = 'What was the biggest surprise in your first year of engineering work?';
  assert.deepEqual(factCheck(question, { cv: COVER_CV }), ['first year'], 'the cover and fill gate keeps the c9d0be8 reading');
  assert.deepEqual(factCheck(question, { cv: COVER_CV, outreach: true }), []);
  assert.deepEqual(factCheck('Should I send my CV first?', { cv: COVER_CV, answers: ['CV'], outreach: true }), []);
  assert.deepEqual(factCheck('In my first year I won the hackathon.', { cv: COVER_CV, outreach: true }), ['first year'], 'not a question to the reader');
});

// Live round 5 false positives and the r6 S1 honest lines, in the body-only shape: the greeting and an application
// follow-up's opening sentence are code-written, so the model body starts after them.
const HONEST = [
  ['E1', "I'm a CS student at Example State University and a former Data Structures TA. I'm reaching out because I'd love to learn how people at {company} got started in software. What was the biggest surprise in your first year of engineering work?"],
  ['E2', 'I wanted to follow up to say how interested I am in the position.', APP],
  ['H4', 'I built a bus tracker app in Python and JavaScript.', APP],
  ['H5', 'I am a computer science student graduating in May 2027.', APP],
  ['H11', 'I was a teaching assistant for Data Structures, which is why the {title} role at {company} appeals to me.', APP],
  ['F1', 'Hello {company} hiring team, I am following up on my application for the {title} role.', APP],
  ['F7', 'Hi {first_name}, I noticed {company} is hiring interns.'],
  ['F8', 'Hi {first_name}, I read your post about {company} hiring interns.'],
  ['H3', "I'm curious about the work at {company}. What do you enjoy most about your role?"],
  ['H6', "I'm a computer science student and I'd love to hear how you got started at {company}."],
  ['H7', 'I am still very interested in the {title} role at {company}.', APP],
  ['H10', 'As a computer science student, I was excited to apply for the {title} role at {company}.', APP],
  ['J1', 'I would love to join your team and contribute to the work at {company}.'],
  ['J2', 'At my Sample Labs internship I built a Python script that cut a weekly report from 2 hours to 10 minutes, and I think that kind of work could be useful to your team.'],
  ['J3', 'Is there a team there that you think would be a good fit for someone with my background?'],
  ['J4', 'Would it be easier to chat briefly, or should I send over my CV first?'],
];

test('fix 8 E the live round 5 false positives and the r6 S1 honest lines pass', () => {
  for (const [id, text, job = ALICE] of HONEST) assert.deepEqual(flagsOf(text, job), [], `${id}: ${text}`);
});

// Every live round 5 real-model reply (ev/r5 *-model-texts.txt, synthetic student), as the model wrote it.
const R5 = [
  ['2a warm-opener', "Hi {first_name}, I'm a CS student at Example State University and a former Data Structures TA. I'm reaching out because I'd love to learn how people at {company} got started in software. What was the biggest surprise in your first year of engineering work?"],
  ['2a connect', "Hi {first_name}, I'm a CS student at Example State and recently built a Python script at an internship that cut a weekly report from 2 hours to 10 minutes. I'd like to connect with you at {company}.", 'connect'],
  ['2a follow-up', "Hi {first_name}, just a quick nudge on my earlier note. I'm a computer science student graduating in May 2027, and I recently built a Python script during an internship that cut a weekly report from 2 hours to 10 minutes. I'd love to learn more about the work at {company}. Would you be open to a short chat sometime in the next few weeks?\n\nThanks, Sam", 'follow-up'],
  ['2a reply', "Hi {first_name}, thanks for getting back to me! I'm open on team, but I'm most drawn to software engineering roles where I can build tools that save people time. At Sample Labs I wrote a Python script that cut a weekly report from 2 hours to 10 minutes, and I'd love to do more of that kind of work. I graduate in May 2027 from Example State University with a CS degree. Is there a team at {company} you think would be a good fit for that? Happy to share more about my background if useful.", 'reply'],
  ['2a application-follow-up', 'Hello Hiring team,\n\nI applied for the {title} role at {company} on {applied_date}, and I wanted to follow up to say I am still very interested.\n\nI think I would be a good fit because during my software engineering internship at Sample Labs I built a Python script that cut a weekly report from 2 hours to 10 minutes. I enjoyed finding a practical way to save people time, and I would be glad to bring that approach to your team.\n\nIf there is anything else I can send, such as code samples or more details about my projects, please let me know. I understand you are busy, and there is no rush at all.\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder', 'app'],
  ['2b warm-opener', "Hi {first_name}, I'm a CS student at Example State University and I'm curious about the work you do at {company}. I recently built a Python script that turned a 2 hour weekly report into 10 minutes, so I enjoy practical automation. What kind of problems does your team spend most time on?"],
  ['2b connect', "Hi {first_name}, I'm a CS student at Example State and built a Python script at an internship that cut a weekly report from 2 hours to 10 minutes. I'd like to connect and follow your work at {company}.", 'connect'],
  ['2b follow-up', "Hi {first_name}, just a quick nudge on my earlier note in case it got buried. I'm a computer science student graduating in May 2027, and I'd love to hear whether {company} might have a role that fits someone with Python, JavaScript and SQL experience. Would it be okay if I sent over my CV so you can take a look?\n\nThanks so much, and no worries at all if the timing isn't right.\n\nSam", 'follow-up'],
  ['2b application-follow-up', 'Hello Hiring team,\n\nI applied for the {title} role at {company} on {applied_date}, and I wanted to follow up to say how interested I am in the position.\n\nI think I would be a good fit because of my software engineering internship at Sample Labs, where I built a Python script that cut a weekly report from 2 hours to 10 minutes. I enjoy finding practical ways to save people time with code.\n\nIf there is anything else I can send, such as code samples or references, I would be glad to share it. I understand you are busy, so please do not feel any rush to reply.\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder', 'app'],
  ['3a warm-opener', "Hi {first_name}, I'm a CS student at Example State University and I'm curious about the work at {company}. I recently built a Python script that cut a weekly report from 2 hours to 10 minutes during an internship. What's been the most interesting part of your work lately?"],
  ['3a connect', "Hi {first_name}, I'm a CS student at Example State and a former software engineering intern. I'd love to connect with you and follow the work happening at {company}.", 'connect'],
  ['3a follow-up', "Hi {first_name}, just a quick nudge on my earlier note. I'm a computer science student graduating in May 2027, and I'd still love to learn more about what the team at {company} is looking for in interns or new grads. Would you be open to a quick chat, or is there a better person for me to reach out to?", 'follow-up'],
  ['3a reply', "Hi {first_name}, thanks for getting back to me! I graduate in May 2027 with a computer science degree from Example State University. I'm most interested in software engineering, ideally a team where I can keep building with Python, JavaScript and SQL. This past summer I interned at Sample Labs, where I wrote a Python script that cut a weekly report from 2 hours to 10 minutes, and I'd love to do more of that kind of work at {company}. Is there a team there that you think would be a good fit for someone with my background?", 'reply'],
  ['3a application-follow-up', 'Dear Hiring team,\n\nI applied for the {title} position at {company} on {applied_date}, and I wanted to follow up to say I am still very interested.\n\nOne reason I think I would be a good fit: during my software engineering internship at Sample Labs, I built a Python script that cut a weekly report from 2 hours to 10 minutes. I enjoy finding practical ways to make work faster and simpler, and I would be glad to bring that approach to your team.\n\nIf there is anything else I can send, such as code samples or more details about my projects, I would be happy to share it. There is no rush, and thank you for your time.\n\nBest regards,\nSam Placeholder', 'app'],
  ['3b application-follow-up retry', 'Hello Hiring team at {company},\n\nI applied for the {title} position on {applied_date} and wanted to follow up briefly. I am excited about the role.\n\nOne reason I think I am a good fit is my summer 2026 internship at Sample Labs, where I built a Python script that cut a weekly report from 2 hours to 10 minutes. I enjoy turning slow, manual work into something simple and reliable, and I would be glad to bring that approach to your team.\n\nIf there is anything else I can send, such as code samples or more details about my projects, please let me know. I understand you are busy, so there is no pressure at all.\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder', 'app'],
];
// The body-only shape: the model's greeting, the application opening sentence and the closing are gone.
const bodyOnly = (text, kind) => {
  const body = modelBody(text);
  return kind === 'app' ? body.replace(/^I applied for the \{title\} (?:role|position)[^.]*?(?:,\s+and\s+|\.\s+|\s+and\s+)/u, '').replace(/^\p{Ll}/u, (c) => c.toUpperCase()) : body;
};
const r5Job = (kind) => (kind === 'app' ? APP : person('Rita Reply', ACME, kind ?? 'warm-opener', kind === 'connect' ? { noteChars: 300 } : {}));

test('fix 8 F every live round 5 model reply passes, as written and in the body-only shape', () => {
  assert.equal(R5.length, 15);
  for (const [src, text, kind] of R5) {
    assert.deepEqual(flagsOf(text, r5Job(kind)), [], `${src} as written`);
    const body = bodyOnly(text, kind);
    assert.ok(!/^(?:hi|hello|dear)\b/i.test(body) && !/best regards|thank you for your time and consideration/i.test(body), `${src} body: ${body}`);
    assert.deepEqual(flagsOf(body, r5Job(kind)), [], `${src} body-only: ${body}`);
  }
});

test('fix 8 S2 brace variants in the body are flagged, and a flagged draft never reaches a batch', async () => {
  for (const t of ['I applied for the { company } role.', 'I would love to learn about {company name}.', 'I would love to learn more about {{company}}.', 'I am curious about [Company].', 'I am curious about {Company}.', 'Hello there, I would love to hear about {first_name} work.']) {
    const job = t.includes('{first_name}') ? APP : ALICE;
    assert.match(flagsOf(t, job).join('; '), /uses .*which this draft has no value for/, t);
  }
  const { res, prompts, items } = await followupRound(['I am curious about the {company name} team.', 'I am curious about {{company}}.']);
  assert.equal(prompts.length, 2, 'one retry, stating the malformed placeholder');
  assert.match(prompts[1], /"\{company name\}", which is not a placeholder/);
  assert.equal(items.length, 0);
  assert.match(res.flagged[0]?.flags.join('; ') ?? '', /\{\{company\}\}/);
});

test('fix 8 N1 literal names match case-sensitively; the acronym of a two-word company still counts', () => {
  const notion = person('Nina Note', 'Notion');
  assert.deepEqual(literalTargets('I like the notion of small teams.', notion), []);
  assert.deepEqual(flagsOf('I like the notion of small teams that ship often.', notion), []);
  assert.deepEqual(literalTargets('I interned at Notion.', notion), ['Notion']);
  assert.deepEqual(literalTargets('I met people from AE at a fair.', ALICE), ['AE']);
});

test('fix 8 S3 a company or title that cv.md holds is still a literal name and still claim-checked', () => {
  const held = `${CV}- Acme Example Scholarship recipient (2025).\n`;
  assert.match(flagsOf('I interned at Acme Example last summer.', ALICE, held).join('; '), /writes Acme Example as is/);
  assert.match(flagsOf('Hi {first_name}, I interned at {company} last summer.', ALICE, held).join('; '), CLAIM);
  const heldTitle = `${CV}- ${TITLE} at Initrode Example (2025).\n`;
  assert.deepEqual(literalTargets(`I was a ${TITLE} at Sample Labs.`, APP), [TITLE]);
  assert.match(flagsOf(`I was a ${TITLE} at Sample Labs.`, APP, heldTitle).join('; '), /as is/);
  assert.match(flagsOf('I was a {title} at Sample Labs.', APP, heldTitle).join('; '), CLAIM);
});

test('fix 8 A the code frame gives the exact final text per draft kind, at most one blank line and no Subject line', () => {
  const sign = { signature: 'Sam Placeholder' };
  const final = (body, job) => fillPlaceholders(assembleDraft(modelBody(body), { ...job, ...sign }), { ...job, ...sign });
  assert.equal(final('Hi {first_name}, I build Python tools.\n\nBest,\nSam', person('Carl Connect', 'Wayne Example', 'connect')), 'Hi Carl, I build Python tools.');
  assert.equal(final("Hi {first_name},\n\nI'm curious about the work at {company}. What do you enjoy most?\n\nThanks,\nSam", ALICE), "Hi Alice,\n\nI'm curious about the work at Acme Example. What do you enjoy most?");
  const emailFollow = person('Nora Nudge', 'Umbrella Example', 'follow-up', { channel: 'email' });
  assert.equal(final('Subject: Checking in\n\nHello {first_name},\n\njust a quick nudge on my earlier note.\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder', emailFollow), 'Hello Nora,\n\nJust a quick nudge on my earlier note.\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder');
  const app = final('Dear Hiring team,\n\nI wanted to follow up to say how interested I am in the position.\n\n\n\nIs there anything else I can send?\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder', APP);
  assert.equal(app, `Hello ${GLOBEX} hiring team,\n\nI applied for the ${TITLE} role at ${GLOBEX} on November 14, 2026. I wanted to follow up to say how interested I am in the position.\n\nIs there anything else I can send?\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder`);
  const noTitle = { ...APP, application: { ...APP.application, title: '' } };
  assert.match(final('Is there anything else I can send?', noTitle), /^Hello Globex Example hiring team,\n\nI applied for a role at Globex Example on November 14, 2026\. Is there/);
  for (const t of [app]) {
    assert.ok(!/\n[ \t]*\n[ \t]*\n/.test(t), 'at most one blank line');
    assert.ok(!/^subject:/im.test(t));
    assert.equal(t.match(/Thank you for your time and consideration\./g).length, 1, 'the closing once');
  }
});

// A round for one Globex follow-up whose fake model answers with the replies in turn.
async function followupRound(replies) {
  const r = makeRoot();
  r.write('cv.md', CV);
  r.write('config/profile.yml', 'candidate:\n  full_name: "Sam Placeholder"\n  email: "sam@example.com"\n');
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

test('fix 8 A a stored application follow-up is the code frame around the body, with the model greeting, opening and sign-off gone', async () => {
  const { res, prompts, items } = await followupRound(['Hello Hiring team at Globex Example,\n\nI wanted to follow up to say how interested I am in the position.\n\nThank you again for your time.\n\nBest regards,\nSam Placeholder']);
  assert.equal(prompts.length, 1, 'a literal name only in the dropped greeting needs no retry');
  assert.match(prompts[0], /no greeting, no subject line, no sign-off/);
  assert.match(prompts[0], /the sentence saying when you applied/);
  assert.deepEqual(res.flagged, []);
  assert.equal(items[0].message, `Hello ${GLOBEX} hiring team,\n\nI applied for the ${TITLE} role at ${GLOBEX} on November 14, 2026. I wanted to follow up to say how interested I am in the position.\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder`);
  assert.ok(!/[{}]/.test(items[0].message));
});

test('fix 8 retry budget: at most 2 model calls per draft, whatever the reasons', async () => {
  const both = await followupRound([`I am curious about ${GLOBEX} and {company name}.`]);
  assert.equal(both.prompts.length, 2, 'a literal name and a malformed placeholder share the one retry');
  assert.equal(both.items.length, 0);
  const claim = await followupRound(['I interned with your team last summer.']);
  assert.equal(claim.prompts.length, 1, 'a claim is flagged with no retry');
  assert.match(claim.res.flagged[0]?.flags.join('; ') ?? '', CLAIM);
});

test('fix 8 targetClaims reads the body only: a claim in the dropped greeting or sign-off is never sent, one in the body is flagged', () => {
  assert.deepEqual(targetClaims('Hello {company} hiring team,\n\nIs there anything else I can send?\n\nBest regards,\nSam'), []);
  assert.deepEqual(targetClaims('Hello hiring team,\n\nI interned there last summer.'), ['I interned there last summer.']);
});
