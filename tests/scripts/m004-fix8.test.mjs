// SYNTHETIC FIXTURE: placeholder people, companies and cv text only.
// M-004 fix 8, re-pinned in the fix 9 shape ("slots + facts by id"). The r6 probe sentences (M1, M2, S1-S3, N1) and
// the live round 5 model replies (ev/r5) are kept: each probe is rejected in every slot of its kind, and each honest live
// question with no first-person word passes as a question slot. The shared fact gate keeps its c9d0be8 ordinal rules
// for cover letters and fill plans, and there is no outreach option any more. Code writes the frame (greeting,
// application opening, closing, sign-off) around the slots and the cv.md facts. Scratch roots, example.com addresses
// and an injected headless runner: no real model, network, Gmail or LinkedIn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check as factCheck } from '../../lib/fact-gate.mjs';
import { readBatch } from '../../lib/batch-file.mjs';
import { resolvePaths } from '../../lib/paths.mjs';
import { serializeTsv } from '../../lib/tsv.mjs';
import { writeCover } from '../../scripts/cover.mjs';
import { KINDS, assembleDraft, checkDraft, contactRoles, draftFacts, factList, fillPlaceholders, outreachDrafts, slotProblems } from '../../scripts/outreach-drafts.mjs';
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
// The result of one slot reply for a job.
const flagsOf = (slots, job, cv = CV) => checkDraft(JSON.stringify({ fact_ids: [], ...slots }), { ...job, roles: contactRoles(job, []) }, { facts: factList(cv), cv, own: draftFacts(job, { candidate: { full_name: 'Sam Placeholder' } }) });
const asQuestion = (t) => `${t.trim().replace(/[.!]+$/, '')}?`;
const inSlot = (slot, text, job) => ({ [slot]: slot === 'question' ? asQuestion(text) : text, ...(slot === 'warm_line' && KINDS[job.action].required.includes('question') ? { question: 'What does a typical week look like for you?' } : {}) });
// Every slot of the job's kind rejects the text, and a rejected draft has no text.
function rejectedEverywhere(id, text, job) {
  for (const slot of KINDS[job.action].slots) {
    const r = flagsOf(inSlot(slot, text, job), job);
    assert.ok(r.flags.length, `${id} ${slot}: ${text}`);
    assert.equal(r.text, '');
  }
}
const FIRST_PERSON = /(?<![\p{L}'])(?:i|me|my|mine|myself|we|us|our|ours)(?![\p{L}])/iu;

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

test('fix 8 M1 (fix 9 shape) every r6 claim about {company} or {title} is rejected in every slot, whatever its wording', () => {
  for (const [id, text, job = ALICE] of M1) rejectedEverywhere(id, text, job);
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

test('fix 8 M2 (fix 9 shape) a claim that refers to the target as there, your team or with you is rejected in every slot', () => {
  for (const [id, text, job = ALICE] of M2) {
    rejectedEverywhere(id, text, job);
    for (const sentence of text.replace(/^(?:Hi|Hello)[^,]*,\s*/, '').split(/(?<=[.!?])\s+/)) if (/interned|worked|working|was on/.test(sentence)) rejectedEverywhere(`${id} sentence`, sentence, job);
  }
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

test('fix 8 M3 the fill-plan gate call (factCheck(text, { cv })) flags every invented rank; the old outreach option changes nothing (fix 9)', () => {
  for (const [sentence] of RANKS) {
    assert.ok(factCheck(sentence, { cv: COVER_CV }).some((x) => /first/.test(x)), `fill path: ${sentence}`);
  }
  for (const [sentence] of RANKS.slice(0, 9)) {
    assert.ok(factCheck(sentence, { cv: COVER_CV, outreach: true }).some((x) => /first/.test(x)), `a rank stays a claim with the outreach option: ${sentence}`);
  }
  const question = 'What was the biggest surprise in your first year of engineering work?';
  assert.deepEqual(factCheck(question, { cv: COVER_CV }), ['first year'], 'the cover and fill gate keeps the c9d0be8 reading');
  assert.deepEqual(factCheck(question, { cv: COVER_CV, outreach: true }), ['first year'], 'fix 9: no reader-ordinal exemption');
  assert.deepEqual(factCheck('Should I send my CV first?', { cv: COVER_CV, answers: ['CV'], outreach: true }), ['first'], 'fix 9: no send-first exemption');
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

test('fix 8 E (fix 9 shape) the honest lines: questions with no first-person word pass as a question slot; "your first year" takes the retry path', () => {
  let n = 0;
  for (const [id, text, job = ALICE] of HONEST) {
    for (const q of text.split(/(?<=[.!?])\s+/).filter((x) => /\?$/.test(x) && !FIRST_PERSON.test(x) && !/first year/.test(x))) {
      assert.deepEqual(slotProblems('question', q, job), [], `${id}: ${q}`);
      n += 1;
    }
  }
  assert.ok(n >= 1, `${n} questions`);
  // The first-person honest lines in their slot shape: the student part is a fact id, the rest a question or nothing.
  for (const [id, slots, job = ALICE] of [
    ['E2', {}, APP], ['H4', { fact_ids: [5] }, APP], ['H5', { fact_ids: [1] }, APP], ['H7', { warm_line: 'The role stands out.' }, APP],
    ['F7', { question: 'Is {company} hiring interns?' }], ['F8', { warm_line: 'Your post about hiring interns is a great read.', question: 'What does the internship involve?' }],
    ['H6', { question: 'How did you get started at {company}?', fact_ids: [1] }], ['J2', { question: 'Could that kind of work be useful to your team?', fact_ids: [3] }],
    ['J3', { question: 'Is there a team there that would be a good fit?', fact_ids: [1] }], ['J4', { question: 'Would a short chat or the CV be easier?' }],
  ]) assert.deepEqual(flagsOf(slots, job).flags, [], `${id}: ${JSON.stringify(slots)}`);
  assert.match(slotProblems('question', 'What was the biggest surprise in your first year of engineering work?', ALICE).join('; '), /ordinal "first"/, 'retried with the rule named (m004-fix9)');
  assert.deepEqual(slotProblems('question', 'What was the biggest surprise when you started out in engineering?', ALICE), []);
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
const r5Job = (kind) => (kind === 'app' ? APP : person('Rita Reply', ACME, kind ?? 'warm-opener', kind === 'connect' ? { noteChars: 300 } : {}));

test('fix 8 F (fix 9 shape) every live round 5 model reply: its questions with no first-person word pass, and its student facts are cv.md lines', () => {
  assert.equal(R5.length, 15);
  const facts = factList(CV).map((f) => f.text).join('\n');
  for (const [src, text, kind] of R5) {
    for (const q of text.split(/(?<=[.!?])\s+|\n+/).filter((x) => /\?$/.test(x) && !FIRST_PERSON.test(x) && !/first year/.test(x))) {
      assert.deepEqual(slotProblems('question', q, r5Job(kind)), [], `${src}: ${q}`);
    }
    if (/Python script/.test(text)) assert.ok(facts.includes('built a Python script that cut a weekly report from 2 hours to 10 minutes'), src);
  }
});

test('fix 8 S2 (fix 9 shape) brace variants in a slot are rejected, and a flagged draft never reaches a batch', async () => {
  for (const t of ['What about the { company } role?', 'What about {company name}?', 'What about {{company}}?', 'What about [Company]?', 'What about {Company}?']) {
    assert.match(flagsOf({ question: t }, ALICE).flags.join('; '), /placeholder-like or bracket text/, t);
  }
  assert.match(flagsOf({ warm_line: 'The work of {first_name} stands out.' }, APP).flags.join('; '), /placeholder-like/, 'no first name on an application follow-up');
  const { res, prompts, items } = await followupRound([JSON.stringify({ warm_line: 'The {company name} team stands out.' }), JSON.stringify({ warm_line: 'The {{company}} team stands out.' })]);
  assert.equal(prompts.length, 2, 'one retry, naming the malformed placeholder');
  assert.match(prompts[1], /placeholder-like or bracket text "\{company name\}"/);
  assert.equal(items.length, 0);
  assert.match(res.flagged[0]?.flags.join('; ') ?? '', /\{\{company\}\}|placeholder-like/);
});

test('fix 8 N1 (fix 9 shape) a company name in any case is named only in a question; a statement naming it fails closed', () => {
  const notion = person('Nina Note', 'Notion');
  assert.deepEqual(flagsOf({ question: 'Is the notion of small teams common at {company}?' }, notion).flags, []);
  assert.match(flagsOf({ warm_line: 'The notion of small teams is appealing.', question: 'What is new?' }, notion).flags.join('; '), /names the company/);
  assert.match(flagsOf({ warm_line: 'Big fan of NOTION.', question: 'What is new?' }, notion).flags.join('; '), /names the company/);
});

test('fix 8 S3 (fix 9 shape) a company or title that cv.md holds is still never named in a statement', () => {
  const held = `${CV}- Acme Example Scholarship recipient (2025).\n`;
  assert.match(flagsOf({ warm_line: 'Acme Example is great.', question: 'What is new?' }, ALICE, held).flags.join('; '), /names the company/);
  const heldTitle = `${CV}- ${TITLE} at Initrode Example (2025).\n`;
  assert.match(flagsOf({ warm_line: `The ${TITLE} work stands out.` }, APP, heldTitle).flags.join('; '), /names the company or job title/);
  assert.match(flagsOf({ warm_line: 'The {title} work stands out.' }, APP, heldTitle).flags.join('; '), /names the company or job title/);
});

test('fix 8 A (fix 9 shape) the code frame gives the exact final text per draft kind, at most one blank line and no Subject line', () => {
  const sign = { signature: 'Sam Placeholder' };
  const final = (slots, job) => fillPlaceholders(assembleDraft({ slots, picked: [] }, { ...job, ...sign }), { ...job, ...sign });
  assert.equal(final({ warm_line: 'Your posts on Python tools are a great read.' }, person('Carl Connect', 'Wayne Example', 'connect')), 'Hi Carl, your posts on Python tools are a great read.');
  assert.equal(final({ question: 'What do you enjoy most about the work at {company}?' }, ALICE), `Hi Alice,\n\nWhat do you enjoy most about the work at ${ACME}?`);
  const emailFollow = person('Nora Nudge', 'Umbrella Example', 'follow-up', { channel: 'email' });
  assert.equal(final({ question: 'Is the team growing?' }, emailFollow), 'Hello Nora,\n\nJust following up on my earlier note in case it got buried. Is the team growing?\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder');
  const app = final({ warm_line: 'Thank you so much.' }, APP);
  assert.equal(app, `Hello ${GLOBEX} hiring team,\n\nI applied for the ${TITLE} role at ${GLOBEX} on November 14, 2026, and I wanted to follow up.\n\nPlease let me know if there is anything else I can send.\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder`);
  const noTitle = { ...APP, application: { ...APP.application, title: '' } };
  assert.match(final({}, noTitle), /^Hello Globex Example hiring team,\n\nI applied for a role at Globex Example on November 14, 2026, and I wanted to follow up\./);
  assert.ok(!/\n[ \t]*\n[ \t]*\n/.test(app), 'at most one blank line');
  assert.ok(!/^subject:/im.test(app));
  assert.equal(app.match(/Thank you/g).length, 1, 'the closing thanks once: a thanks-only warm_line is dropped in an email');
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

test('fix 8 A (fix 9 shape) a stored application follow-up is the code frame around the slots and the picked fact', async () => {
  const { res, prompts, items } = await followupRound([JSON.stringify({ warm_line: 'The focus on practical tools in this role stands out.', fact_ids: [3] })]);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /Code writes the greeting, any sentence about an application or its date, the closing thanks and the sign-off/);
  assert.deepEqual(res.flagged, []);
  assert.equal(items[0].message, `Hello ${GLOBEX} hiring team,\n\nI applied for the ${TITLE} role at ${GLOBEX} on November 14, 2026, and I wanted to follow up. The focus on practical tools in this role stands out.\n\nA bit about my background: Software engineering intern at Sample Labs (summer 2026): built a Python script that cut a weekly report from 2 hours to 10 minutes.\n\nPlease let me know if there is anything else I can send.\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder`);
  assert.ok(!/[{}]/.test(items[0].message));
});

test('fix 8 retry budget (fix 9 shape): at most 2 model calls per draft, whatever the reasons', async () => {
  const both = await followupRound([JSON.stringify({ warm_line: `The ${GLOBEX} and {company name} teams stand out.`, fact_ids: [42] })]);
  assert.equal(both.prompts.length, 2, 'every broken rule shares the one retry');
  assert.equal(both.items.length, 0);
  const claim = await followupRound([JSON.stringify({ warm_line: 'Interned with your team last summer.' })]);
  assert.equal(claim.prompts.length, 2);
  assert.equal(claim.items.length, 0);
});

test('fix 8 (fix 9 shape) text outside the kind\'s slots is never placed: a claim in an extra key never reaches the message', () => {
  const r = checkDraft(JSON.stringify({ body: 'I interned there last summer.', greeting: 'Hello from a former intern,', question: 'What is new on the team?', fact_ids: [] }), ALICE, { facts: factList(CV), cv: CV, own: draftFacts(ALICE) });
  assert.deepEqual(r.flags, []);
  assert.equal(r.text, 'Hi Alice,\n\nWhat is new on the team?');
});
