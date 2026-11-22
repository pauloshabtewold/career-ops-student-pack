// SYNTHETIC FIXTURE: placeholder people, companies and cv text only.
// M-004 fix 8 cases, re-pinned in the fix 10 shape ("warm prose + hard rails + independent verifier"). The r6 probe
// sentences (M1, M2) are no longer judged by a regex claim rule: each reaches the verifier verbatim inside the final
// string, and a verdict naming it keeps it out. The shared fact gate keeps its c9d0be8 ordinal rules for cover letters
// and fill plans (M3). The honest r6 S1 lines and every live round 5 model reply (ev/r5) pass the rails with no flag.
// Code writes the frame (greeting, application opening, closing, sign-off) around the model body. Scratch roots,
// example.com addresses and an injected headless runner: no real model, network, Gmail or LinkedIn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check as factCheck } from '../../lib/fact-gate.mjs';
import { writeCover } from '../../scripts/cover.mjs';
import { checkDraft, fillPlaceholders } from '../../scripts/outreach-drafts.mjs';
import { makeRoot } from '../helpers/script-harness.mjs';
import { ACME, ALICE, APP, DAY, GLOBEX, SOURCES, TITLE, draftIn, person, roundFor } from '../helpers/outreach-verify-harness.mjs';

const check = (text, job = ALICE) => checkDraft(text, job, { sources: SOURCES });
// The probe as it must appear in the final string: a leading greeting off, the placeholders filled.
const expected = (text, job) => fillPlaceholders(text.replace(/^(?:hi|hello)\b[^,\n]*,\s*/i, '').replace(/^\p{Ll}/u, (c) => c.toUpperCase()), job);
// Contact probes run as a follow-up (no length cap, no first-message referral rail), so only the verifier can hold them.
const NORA = person('Nora Nudge', ACME, 'follow-up');
// The probe reaches the verify prompt verbatim inside the exact final string, and a verdict naming it keeps it out.
async function verifiedAndHeld(id, text, job) {
  const want = expected(text, job);
  const out = await roundFor(job, { drafts: [text], verdict: (prompt) => JSON.stringify({ unsupported: draftIn(prompt).includes(want) ? [want] : [] }) });
  assert.ok(out.verifies.length >= 1, `${id} verified: ${JSON.stringify(out.res.flagged)}`);
  const draft = draftIn(out.verifies[0].prompt);
  assert.ok(draft.includes(want), `${id}: ${want}\n---\n${draft}`);
  assert.equal(draft, check(text, job).text);
  assert.equal(out.items.length, 0, `${id} kept out`);
}

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

test('fix 8 M1 (fix 10) every r6 claim about {company} or {title} reaches the verifier verbatim and its verdict keeps it out', async () => {
  for (const [id, text, job = NORA] of M1) await verifiedAndHeld(id, text, job);
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

test('fix 8 M2 (fix 10) a claim that refers to the target as there, your team or with you reaches the verifier verbatim and is kept out', async () => {
  for (const [id, text, job = NORA] of M2) await verifiedAndHeld(id, text, job);
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

test('fix 8 E (fix 10) the honest lines, including "your first year" and "a quick 15 minute chat", pass the rails with no flag', () => {
  for (const [id, text, job = ALICE] of [...HONEST, ['E3', 'Would you be open to a quick 15 minute chat in the next couple of weeks?', NORA]]) {
    const r = check(text, job);
    // F1 only restates the application, which code already states: it is taken off, so that body is empty (a redraft).
    if (id === 'F1') assert.deepEqual(r.flags, ['the message has no body'], r.text);
    else assert.deepEqual(r.flags, [], `${id}: ${r.text}`);
    if (job === APP) assert.equal(r.text.match(/applied for/g).length, 1, `${id}: the application once: ${r.text}`);
  }
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
const r5Job = (kind) => (kind === 'app' ? APP : person('Rita Reply', ACME, kind ?? 'warm-opener', kind === 'connect' ? { noteChars: 300 } : kind === 'reply' ? { replyText: 'When do you graduate, and which team interests you?' } : {}));

test('fix 8 F (fix 10) every live round 5 model reply passes the rails with no flag; an email states the application, the date and the thanks once', () => {
  assert.equal(R5.length, 15);
  for (const [src, text, kind] of R5) {
    const r = check(text, r5Job(kind));
    assert.deepEqual(r.flags, [], `${src}: ${r.text}`);
    if (kind === 'app') {
      assert.equal(r.text.match(/November 14, 2026/g).length, 1, src);
      assert.equal(r.text.match(/thank/gi).length, 1, `${src}: ${r.text}`);
      assert.ok(!/Hiring team,\n\n.*Hiring team/s.test(r.text) && r.text.startsWith(`Hello ${GLOBEX} hiring team,\n\nI applied for`), r.text);
    }
  }
});

test('fix 8 S2 (fix 10) brace variants are rail failures; the redraft names the whole token, and a flagged draft never reaches a batch', async () => {
  for (const t of ['What about the { company } role?', 'What about {company name}?', 'What about {{company}}?', 'What about [Company]?', 'What about {Company}?']) {
    assert.match(check(t).flags.join('; '), /placeholder-like text/, t);
  }
  assert.match(check('The work of {first_name} stands out.', APP).flags.join('; '), /placeholder-like/, 'no first name on an application follow-up');
  const out = await roundFor(APP, { drafts: ['The {company name} team stands out.', 'The {{company}} team stands out.'] });
  assert.equal(out.drafting.length, 2, 'one redraft, naming the malformed placeholder');
  assert.match(out.drafting[1].prompt, /placeholder-like text "\{company name\}"/);
  assert.equal(out.verifies.length, 0);
  assert.equal(out.items.length, 0);
  assert.match(out.res.flagged[0]?.flags.join('; ') ?? '', /\{Globex Example\}|placeholder-like/);
});

test('fix 8 N1 and S3 (fix 10) a company name in any case, or one cv.md holds, is no code rule: the sentence passes the rails and goes to the verifier', async () => {
  const notion = person('Nina Note', 'Notion');
  for (const [job, text] of [[notion, 'The notion of small teams is appealing. Is that common at {company}?'], [notion, 'Big fan of NOTION. What is new?'], [ALICE, 'Acme Example is great. What is new?'], [APP, `The ${TITLE} work stands out.`]]) {
    assert.deepEqual(check(text, job).flags, [], text);
    const out = await roundFor(job, { drafts: [text] });
    assert.equal(draftIn(out.verifies[0].prompt), out.items[0].message);
  }
});

test('fix 8 A (fix 10) the code frame gives the exact final text per draft kind, at most one blank line and no Subject line', () => {
  assert.equal(check('Your posts on Python tools are a great read.', person('Carl Connect', 'Wayne Example', 'connect', { noteChars: 300 })).text, 'Hi Carl, your posts on Python tools are a great read.');
  assert.equal(check('Carl, your posts on Python tools are a great read.', person('Carl Connect', 'Wayne Example', 'connect', { noteChars: 300 })).text, 'Hi Carl, your posts on Python tools are a great read.', 'the name once (r8)');
  assert.equal(check('What do you enjoy most about the work at {company}?').text, `Hi Alice,\n\nWhat do you enjoy most about the work at ${ACME}?`);
  assert.equal(check('Is the team growing?', person('Nora Nudge', 'Umbrella Example', 'follow-up', { channel: 'email' })).text, 'Hello Nora,\n\nIs the team growing?\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder');
  const app = check('I would be glad to send code samples.\n\nThank you so much.', APP).text;
  assert.equal(app, `Hello ${GLOBEX} hiring team,\n\nI applied for the ${TITLE} role at ${GLOBEX} on November 14, 2026, and I wanted to follow up.\n\nI would be glad to send code samples.\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder`);
  const noTitle = { ...APP, application: { ...APP.application, title: '' } };
  assert.match(check('The team looks great.', noTitle).text, /^Hello Globex Example hiring team,\n\nI applied for a role at Globex Example on November 14, 2026, and I wanted to follow up\./);
  assert.ok(!/\n[ \t]*\n[ \t]*\n/.test(app), 'at most one blank line');
  assert.ok(!/^subject:/im.test(app));
  assert.equal(app.match(/Thank you/g).length, 1, 'the closing thanks once: a thanks-only closing paragraph is taken off in an email');
});

test('fix 8 (fix 10) a JSON-shaped reply is a rail failure (braces), never stored, and the budget is 2 drafting calls', async () => {
  const json = JSON.stringify({ body: 'I interned there last summer.', question: 'What is new on the team?' });
  const out = await roundFor(ALICE, { drafts: [json] });
  assert.equal(out.drafting.length, 2);
  assert.equal(out.verifies.length, 0);
  assert.equal(out.items.length, 0);
  assert.equal(out.res.flagged.length, 1);
});
