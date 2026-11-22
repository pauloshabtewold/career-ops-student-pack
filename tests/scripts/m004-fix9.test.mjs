// SYNTHETIC FIXTURE: placeholder people, companies and cv text only.
// M-004 fix 9, "slots + facts by id": no student claim is model free text. Code numbers the cv.md lines (factList); the
// model returns one JSON object of short slots (warm_line, question) and fact ids per draft kind; code places each picked
// fact word for word in a fixed frame and writes every other sentence (greeting, openings, referral question, closing,
// sign-off). Each slot passes a closed grammar (slotProblems) or the draft gets one retry naming the broken rules, then
// is flagged. The final message is assembled once; the final checks read that exact string, and it is the string
// stored and sent. The shared fact gate has no outreach option any more.
// Every review probe of rounds r4 to r7 is put into a slot and shown rejected; honest lines from the live rounds pass in
// their slot shape. Scratch roots, example.com addresses and an injected headless runner: no real model, network, Gmail
// or LinkedIn. The module is imported as a namespace so the M1, M4 and M5 tests (which use only outreachDrafts,
// sendEmail and the fact gate) also load against older code for the revert proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check as factCheck } from '../../lib/fact-gate.mjs';
import { readBatch } from '../../lib/batch-file.mjs';
import { sendEmail } from '../../lib/gmail-chrome.mjs';
import { resolvePaths } from '../../lib/paths.mjs';
import { serializeTsv } from '../../lib/tsv.mjs';
import * as od from '../../scripts/outreach-drafts.mjs';
import { makeRoot } from '../helpers/script-harness.mjs';

const DAY = '2026-11-22';
const ACME = 'Acme Example';
const GLOBEX = 'Globex Example';
const INITECH = 'Initech Example';
const TITLE = 'Software Engineering Intern';
const GLOBEX_APP = 'https://jobs.example.com/globex/swe-intern';

// The live-round student cv (synthetic).
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
const PROFILE = 'candidate:\n  full_name: "Sam Placeholder"\n  email: "sam@example.com"\n';

const person = (name, company, action = 'warm-opener', extra = {}) => ({ action, channel: 'linkedin', contact: { name, company }, ...extra });
const ALICE = person('Alice Alpha', ACME);
const NOTION = person('Nina Note', 'Notion');
const RITA = person('Rita Reply', INITECH, 'reply', { replyText: 'Thanks for connecting! When do you graduate, and which team interests you?' });
const APP = { action: 'application-follow-up', channel: 'email', to: 'recruiter@example.com', contact: { name: 'Hiring team', company: GLOBEX }, application: { target: GLOBEX_APP, company: GLOBEX, submitted: '2026-11-14', title: TITLE }, signature: 'Sam Placeholder' };

const facts = () => od.factList(CV);
const ctx = (job) => ({ facts: facts(), cv: CV, own: od.draftFacts(job, { candidate: { full_name: 'Sam Placeholder' } }) });
const reply = (slots) => JSON.stringify({ fact_ids: [], ...slots });
const check = (slots, job = ALICE) => od.checkDraft(typeof slots === 'string' ? slots : reply(slots), job, ctx(job));
const asQuestion = (t) => `${t.trim().replace(/[.!]+$/, '')}?`;

// Every claim probe of reviews r4 to r7 (first-person or not). A probe rejected in every slot of its kind cannot reach a
// message: the only student text a message carries is a cv.md fact, word for word.
const PROBES = [
  // r4/r5 (fix 7)
  'Hi Alice, I interned at Acme Example last summer and loved it.', 'Hi Alice, I worked at Acme Example on the data team.',
  'I was a Software Engineering Intern at Globex Example before.', 'I worked as a Software Engineering Intern last year.',
  'I also worked as a Data Engineer at Initech Example.', 'I applied to Acme Example, where I interned last summer.',
  'I applied for the Software Engineering Intern position, where I worked last summer.', 'Thanks, Acme Example, where I interned last summer, was great.',
  "I'm curious about the work at Acme Example, where I interned last summer.", "I'm curious about the data team at Acme Example who trained me.",
  "I'm curious about returning to the data team at Acme Example.", "I'm curious about getting back to the team at Acme Example.",
  "I'd love to return to the team at Acme Example.", 'Hello Globex Example hiring team, I interned with you last summer.',
  'I applied for the Software Engineering Intern role after interning there.', 'My internship at Acme Example taught me a lot.',
  'Acme Example hired me last summer.', "Acme Example's data team is where I interned.", 'It would be great to be back at Acme Example.',
  'I applied to Acme Example again after my summer at Acme Example.', "I've applied for the Software Engineering Intern role I held at Globex Example in 2025.",
  'Acme Example, where I interned last summer, is my top choice.', "I'd love to join Acme Example, where I interned last summer.",
  'I interned at HP last summer.', 'I worked at IBM on the data team.', 'I mentored 14 students last year.', 'I grew signups by 11% at my club.',
  'I hold a CS degree.', 'I build AI models in my spare time.', 'I am finishing my MBA this spring.', 'I do ML research.',
  // r6 (fix 8)
  'Having interned at {company} last summer, I would love to learn more.', "As {company}'s summer intern, I would like to stay in touch.",
  'As a {title} at {company} last summer, I would like to follow up.', "I'm glad to have interned at {company}.", "I'm excited to have worked with the {company} data team.",
  'I really enjoyed working at {company} last summer.', 'I successfully interned at {company}.', 'Interning at {company} last summer showed me what good code review looks like.',
  'Last summer at {company} was the best part of my degree.', 'Our team partnered with {company} on a campus project.', 'My team and I shipped a feature for {company} last summer.',
  'I, too, interned at {company}.', "I'm thrilled to still be part of {company}.", 'Working at {company} taught me Python.', 'I applied my Python skills at {company} last summer.',
  "I submitted a pull request to {company}'s open source repo.", 'I wanted to thank {company} for hosting me last summer.', "I reached the finals of {company}'s hackathon.",
  'I heard about {company} from my manager there.', "I'm interested in {company} because I used to work there.", 'I decided to follow up since I spent a summer at {company}.',
  'I hoped {company} remembered my internship.', 'I would love to rejoin the work at {company}.', 'I got to work with your team last summer.',
  'I know {company} well. I interned there last summer.', 'I enjoyed working with your team last summer.', 'It was great working with you all on the data team.',
  'I interned with your team in 2026.', 'I loved my summer there and want to learn more about {company}.', "I'm curious about the work at {company}. There I interned for a summer.",
  'I was on your team last year.', 'I interned at AE last summer.', 'I hold an MBA.', 'I build ML models at Sample Labs.', 'I interned at Initrode Example last summer.',
  'I studied at Example Tech, not just Example State University.', 'I know Kubernetes and Rust well.', 'I was a TA at {company}.', 'I applied on 11/14.',
  // r7
  "I'm curious about the work at {company}. I interned with them last summer.", '{company} is hiring, and I know them well: I interned with them last summer.',
  "It's where I interned last summer.", 'They hired me as an intern last summer.', 'I interned at the company last summer.', 'I interned for you last summer.',
  'I worked under you on the data team last summer.', 'You hired me last summer, so I wanted to reconnect.', 'You were my manager during my internship.',
  'I was one of your interns last summer.', 'I interned on your engineering team last summer.', 'I was on your data team last summer.',
  'As your former intern, I would love to reconnect.', 'Your engineers mentored me last summer.', "I interned with y'all last summer.",
  "I developed {company}'s product last summer.", "I designed {company}'s mission statement.", "{company}'s product is something I helped design.",
  "I wrote the docs for {company}'s products.", 'I supported your work at {company} last summer.', 'I applied to {company} last year and got an offer.',
  'I applied with {company} last year and was hired.', 'I held the {title} role last summer.', 'I was offered the {title} position last spring.',
  'I completed the {title} internship last summer.', 'The people at {company} were so welcoming last summer.', 'I learned so much from the people at {company} last summer.',
  'I miss the people at {company}.', '{company} could have a position for me since I already know the codebase.', 'I had lunch with you at {company} last week.',
  'I loved the work at {company} last summer.', 'I read about {company} in my offer letter.', "I'd been interning there.", 'Having spent a summer with your team, I would love to reconnect.',
  'As an intern on your team, I learned a lot.', 'I used to intern with the people at {company}.', "I'm interested in {company} because I interned there.",
  '{company} is hiring former interns like me.', 'Interned with your team last summer and loved it.', 'I have been working with your team since June.',
  'I interned at acme example last summer.', 'I interned at ACME EXAMPLE last summer.', 'I interned at Acme-Example last summer.', 'I interned at AcmeExample last summer.',
  'I met folks from A.E. at a fair.', 'I was a software engineering intern at globex example.', 'I applied for the role on november 14.',
  'Happy to share that our team won first.', "I'd love to share that my Campus Bus Tracker took first.", 'Can I share that I graduated first?',
  'I was your first intern, remember?', 'Was I your first intern hire?', 'I built 14 apps at Sample Labs.', 'I use Kubernetes and Rust daily.', 'I interned at initrode last summer.',
];

// Claims with no first-person word, the next shape a probe takes once "I" is ruled out.
const SUBJECTLESS = [
  'Interned at {company} last summer.', 'Former {company} intern.', 'Currently interning at {company}.', 'Proud {company} alum.',
  'Fellow intern on your team.', 'Part of your data team.', 'Glad to be back at {company}.', 'Python developer here.',
  'This student interned at {company}.', 'Fluent in Rust and Go.', 'Holds an MBA.', 'Built the data pipeline your team uses.',
  'Experienced data engineer, ready to help.', 'Knows your codebase well.', 'Already familiar with your codebase.', 'Recent MBA graduate.',
  'The team at {company} was great to work with.', 'Spent a summer with your team.', 'Kubernetes and Rust are strong points.', 'Great to reconnect.',
  'Yours truly helped ship your mobile app.', 'Big fan of acme example since the internship.', 'Your engineers taught a lot.', 'Studying at Example Tech.',
];

test('fix 9 G every r4 to r7 probe is rejected in every slot of its kind, and each draft is flagged, never stored', () => {
  assert.equal(PROBES.length, 125, 'every probe sentence is listed');
  for (const text of [...PROBES, ...SUBJECTLESS]) {
    const isApp = /\{title\}|Software Engineering Intern|11\/14|november 14|globex example/i.test(text);
    const job = isApp ? APP : NOTION.contact.company && /notion/i.test(text) ? NOTION : ALICE;
    for (const slot of od.KINDS[job.action].slots) {
      const value = slot === 'question' ? asQuestion(text) : text;
      const r = check({ [slot]: value, ...(slot === 'warm_line' && job.action === 'warm-opener' ? { question: 'What does a typical week look like for you?' } : {}) }, job);
      assert.ok(r.flags.length > 0, `${slot} passed: ${value}`);
      assert.equal(r.text, '', `a flagged draft has no text: ${value}`);
    }
  }
});

test('fix 9 G (S3) placeholder tokens of every shape are rejected; only {first_name}, {company} and {title} where the job has one', () => {
  for (const t of ['I am curious about {company }.', 'What about {COMPANY}?', 'What about {company_name}?', 'What about {{ company }}?', 'What about {{company}}?', 'What about <company>?',
    'What about ${company}?', 'What about ｛company｝?', 'What about (company name)?', 'What about [Company Name]?', 'What about &lt;company&gt;?', 'Congrats on {applied_date}?',
    'What does {title} mean here?', 'What about [Company]?', 'What about {Company}?', 'What about { company }?', 'What about the ___ team?', 'What about XXX?', 'What about the (Company) team?']) {
    assert.ok(check({ question: t }).flags.length, t);
  }
  assert.deepEqual(check({ question: 'What is it like working at {company}?' }).flags, []);
  assert.equal(check({ question: 'What is it like working at {company}?' }).text, `Hi Alice,\n\nWhat is it like working at ${ACME}?`);
});

// Honest lines of the live rounds (ev/r3 to ev/r6) and the r7 S2 questions, in their slot shape: the student's own
// facts become fact ids, the rest becomes a warm_line or a question with no first-person word.
const HONEST = [
  [ALICE, { warm_line: 'Thanks for connecting.', question: 'How did you choose your field?' }],
  [ALICE, { question: 'What projects is your team working on right now?' }],
  [ALICE, { question: 'What is it like working at {company}?' }],
  [ALICE, { question: 'How did you get started working at {company}?' }],
  [ALICE, { question: 'What kind of problems does your work involve most often?', fact_ids: [3] }],
  [ALICE, { question: 'What do you enjoy most about your role at {company}?', fact_ids: [1] }],
  [ALICE, { question: 'What does a typical week look like for you?' }],
  [ALICE, { question: 'What has been the most interesting part of your work lately?' }],
  [ALICE, { warm_line: 'Your recent post on testing is a great read.', question: 'What does your team use for code review?' }],
  [ALICE, { warm_line: 'The work your team does looks really interesting.', question: 'What is it like working at ACME EXAMPLE?' }],
  [ALICE, { warm_line: 'Great to connect, Alice.', question: "What's the team like there?" }],
  [person('Carl Connect', 'Wayne Example', 'connect', { noteChars: 200 }), { warm_line: 'The work your team does looks really interesting, and following your updates would be great.' }],
  [person('Carl Connect', 'Wayne Example', 'connect', { noteChars: 300 }), { warm_line: 'Your posts on developer tooling are a great read.', fact_ids: [1] }],
  [person('Nora Nudge', 'Umbrella Example', 'follow-up'), { question: 'What kinds of early-career roles does {company} hire for?', fact_ids: [1] }],
  [person('Nora Nudge', 'Umbrella Example', 'follow-up'), { question: 'Would you be open to a short chat sometime in the next couple of weeks?' }],
  [person('Nora Nudge', 'Umbrella Example', 'follow-up'), { question: 'Is your team hiring interns this year?' }],
  [person('Nora Nudge', 'Umbrella Example', 'follow-up'), { question: 'Would a short chat or a copy of the CV be more helpful?' }],
  [person('Nora Nudge', 'Umbrella Example', 'follow-up'), { question: 'Is there a better person to reach out to?' }],
  [RITA, { warm_line: 'Thanks for getting back so quickly!', question: 'Is there a team you would suggest looking at?', fact_ids: [1, 3] }],
  [RITA, { question: 'Which teams at {company} would you suggest for someone who likes practical tools?', fact_ids: [1, 6] }],
  [person('Gina Globex', GLOBEX, 'referral-ask'), { warm_line: 'Thanks so much for the conversation about the platform team.' }],
  [APP, { warm_line: 'The focus on practical internal tools in this role stands out.', fact_ids: [3] }],
  [APP, { fact_ids: [3, 4] }],
  [APP, {}],
];

test('fix 9 G honest live lines and the r7 S2 networking questions pass in their slot shape', () => {
  for (const [job, slots] of HONEST) {
    const r = check(slots, job);
    assert.deepEqual(r.flags, [], `${job.action} ${JSON.stringify(slots)}`);
    assert.ok(r.text && !/[{}]/.test(r.text), r.text);
  }
});

test('fix 9 A the fact list is the cv.md lines word for word; a picked fact is placed verbatim and an unknown id is a flag', () => {
  const list = facts();
  assert.deepEqual(list.map((f) => f.text), [
    'Computer science student at Example State University, graduating May 2027.',
    'GPA 3.6.',
    'Software engineering intern at Sample Labs (summer 2026): built a Python script that cut a weekly report from 2 hours to 10 minutes.',
    'Teaching assistant for Data Structures at Example State University (2025 to 2026).',
    'Campus Bus Tracker: a small web app in JavaScript and Python that shows live bus times.',
    'Python, JavaScript, SQL, Git',
  ]);
  for (const f of list) assert.ok(CV.includes(f.text.replace(/\.$/, '')), f.text);
  assert.ok(!list.some((f) => /Sam Placeholder|^Experience$|^Skills$/.test(f.text)), 'headings are no facts');
  assert.deepEqual(od.factList(`# N\n\n- ${'word '.repeat(40).trim()}.\n- Short line.`).map((f) => f.text), ['Short line.'], 'a sentence over the cap is left out, never cut');
  const r = check({ question: 'What does your team build?', fact_ids: [3] });
  assert.ok(r.text.includes(`A bit about me: ${list[2].text.replace(/\.$/, '')}.`), r.text);
  for (const bad of [[99], [0], ['3'], [1.5], [3, 3], [1, 3]]) {
    const f = check({ question: 'What does your team build?', fact_ids: bad }).flags.join('; ');
    assert.match(f, /fact_ids/, JSON.stringify(bad));
  }
  assert.match(check({ question: 'What does your team build?', fact_ids: 3 }).flags.join('; '), /fact_ids: not a list/);
});

test('fix 9 B and I the prompt keeps the fixed rules and fact list first, the per-contact data last, and never asks for the date', () => {
  const list = facts();
  const a = od.draftPrompt({ ...ALICE, cv: CV, facts: list });
  const b = od.draftPrompt({ ...APP, cv: CV, facts: list });
  const prefix = a.slice(0, a.indexOf('Task:'));
  assert.ok(prefix.length > 200 && b.startsWith(prefix), 'the same cacheable prefix for every kind');
  assert.match(prefix, /3: Software engineering intern at Sample Labs/);
  assert.match(prefix, /one JSON object/);
  assert.match(prefix, /no first-person words/);
  assert.ok(a.indexOf('Contact: Alice Alpha at Acme Example') > a.indexOf('Task:'));
  assert.ok(!/2026-11-14|\{applied_date\}/.test(b), b);
  assert.match(b, /JSON shape: \{"warm_line": "\.\.\.", "fact_ids": \[\]\}/);
});

test('fix 9 C the slot grammar: one sentence, word cap, no first person, numbers, links or unknown names; names match in any case', () => {
  const p = (slot, t, job = ALICE) => od.slotProblems(slot, t, job).join('; ');
  assert.match(p('question', 'What do you do? What do you like?'), /more than one sentence/);
  assert.match(p('question', `${'very '.repeat(30)}good?`), /more than 30 words/);
  for (const w of ['I', 'me', 'my', 'mine', 'we', 'us', 'our', "I'm", "I've", "I'd", "we're", 'myself', 'ours']) assert.match(p('question', `Would ${w} fit?`), /first-person/, w);
  assert.match(p('question', 'Is a 15 minute chat ok?'), /digit/);
  assert.match(p('question', 'Is a fifteen minute chat ok?'), /number word/);
  assert.match(p('question', 'What was your first year like?'), /ordinal "first"/);
  assert.match(p('question', 'Is https://example.com yours?'), /link/);
  assert.match(p('question', 'Is sam@example.com right?'), /link/);
  assert.match(p('question', 'Do you know Initrode Systems?'), /not allowed here: Initrode, Systems/);
  assert.equal(p('question', 'Is the team at acme example hiring?'), '');
  assert.equal(p('question', 'Is the team at ACME EXAMPLE hiring?'), '');
  assert.match(p('warm_line', 'Big fan of acme example.'), /names the company or job title in a statement/);
  assert.match(p('warm_line', 'Big fan of ACME EXAMPLE.'), /names the company/);
  assert.match(p('warm_line', 'Thanks for connecting'), /^$/);
  assert.match(p('warm_line', 'Thanks for connecting?'), /question mark in a statement/);
  assert.match(p('question', 'Thanks for connecting.'), /does not end with "\?"/);
  assert.equal(p('warm_line', 'Great to connect, alice.'), '', 'the first name in any case');
});

// A round for one Globex follow-up whose fake model answers with the replies in turn.
async function followupRound(replies, { send = false } = {}) {
  const r = makeRoot();
  r.write('cv.md', CV);
  r.write('config/profile.yml', PROFILE);
  r.write('data/contacts.tsv', serializeTsv(['date', 'company', 'name', 'stage', 'role'], []));
  r.write('data/pipeline.md', `# Pipeline\n\n## Processed\n\n- [x] ${GLOBEX_APP} | ${GLOBEX} | ${TITLE} | Remote\n`);
  const prompts = [];
  const headless = async (opts) => {
    prompts.push(String(opts.prompt));
    return { text: replies[Math.min(prompts.length - 1, replies.length - 1)], model: 'sonnet', usage: null };
  };
  try {
    const paths = resolvePaths({ root: r.root, dataDir: r.data });
    const state = { due: [], followups: [{ target: GLOBEX_APP, company: GLOBEX, submitted: '2026-11-14', email: 'recruiter@example.com' }] };
    const res = await outreachDraftsQuiet(paths, { headless, state });
    const items = res.ids.flatMap((id) => readBatch(r.data, id).items);
    let sentBody = null;
    if (send && items.length) {
      const passAll = () => ({ code: 0, stdout: 'ok', stderr: '' });
      const out = await sendEmail({ paths, port: 9, email: { batchId: res.ids[0], item: 1, target: GLOBEX_APP, company: GLOBEX, followup: { target: GLOBEX_APP, company: GLOBEX } }, date: DAY, runner: passAll, browser: async () => 'sent' });
      assert.equal(out.code, 0, JSON.stringify(out));
      const dir = r.file('data/threads');
      const archived = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
      const mark = `Subject: ${items[0].subject}\n\n`;
      sentBody = archived.slice(archived.indexOf(mark) + mark.length).replace(/\n+$/, '');
    }
    return { res, prompts, items, sentBody };
  } finally {
    r.cleanup();
  }
}
const outreachDraftsQuiet = (paths, deps) => od.outreachDrafts({ paths, today: DAY, replies: [], deps: { t6On: false, ...deps }, say: () => {} });

// One round for one contact (a warm opener at Acme by default) whose fake model answers with the replies in turn.
async function contactRound(replies, due = { name: 'Alice Alpha', company: ACME, action: 'warm-opener' }) {
  const r = makeRoot();
  r.write('cv.md', CV);
  r.write('config/profile.yml', PROFILE);
  r.write('data/contacts.tsv', serializeTsv(['date', 'company', 'name', 'stage', 'role'], []));
  const prompts = [];
  const headless = async (opts) => {
    prompts.push(String(opts.prompt));
    return { text: replies[Math.min(prompts.length - 1, replies.length - 1)], model: 'sonnet', usage: null };
  };
  try {
    const res = await outreachDraftsQuiet(resolvePaths({ root: r.root, dataDir: r.data }), { headless, state: { due: [due], followups: [] } });
    return { res, prompts, items: res.ids.flatMap((id) => readBatch(r.data, id).items) };
  } finally {
    r.cleanup();
  }
}

// Review r7 M1 (D1 to D4): text after an early sign-off or a second greeting was stored but never checked.
const M1_REPLIES = [
  "I'm curious about the work at {company}. What do you enjoy most about it?\n\nThanks!\n\nP.S. I interned with your team in 2025 and led 3 projects for {company}.\n\nBest,\nSam",
  'Hello from a former Globex Example intern, I would love to reconnect.\n\nIs there anything else I can send?',
  'Regards, everyone I met\n\nI managed the Globex Example data pipeline for two summers.\n\nBest regards,\nSam Placeholder',
];
const M1_CLAIM = /interned with your team|former Globex Example intern|managed the Globex Example data pipeline|led 3 projects/;

test('fix 9 M1 a reply with a claim after an early sign-off or a second greeting never reaches a stored or sent message', async () => {
  for (const text of M1_REPLIES) {
    const app = await followupRound([text]);
    assert.ok(!app.items.some((i) => M1_CLAIM.test(i.message)), `application follow-up stored: ${JSON.stringify(app.items.map((i) => i.message))}`);
    const opener = await contactRound([text]);
    assert.ok(!opener.items.some((i) => M1_CLAIM.test(i.message)), `warm opener stored: ${JSON.stringify(opener.items.map((i) => i.message))}`);
  }
});

test('fix 9 M1 and E the checked string, the stored message and the sent body are the same string', async () => {
  const slots = reply({ warm_line: 'The focus on practical internal tools in this role stands out.', fact_ids: [3] });
  const checked = od.checkDraft(slots, APP, ctx(APP));
  assert.deepEqual(checked.flags, []);
  const { items, sentBody, prompts } = await followupRound([slots], { send: true });
  assert.equal(prompts.length, 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].message, checked.text, 'stored === checked');
  assert.equal(sentBody, checked.text, 'sent === checked');
  assert.equal(od.finalChecks(items[0].message, APP, [facts()[2]]).length, 0);
});

test('fix 9 M4 a lowercase or uppercase company name never carries a claim into a stored message', async () => {
  for (const text of ['I interned at acme example last summer.', 'I interned at ACME EXAMPLE last summer.', reply({ warm_line: 'Big fan of acme example.', question: 'Is the team growing?' })]) {
    const { items, res } = await contactRound([text]);
    assert.equal(items.length, 0, `stored: ${JSON.stringify(items.map((i) => i.message))}`);
    assert.equal(res.flagged.length, 1);
  }
  const notion = await contactRound(['I interned at notion last summer.'], { name: 'Nina Note', company: 'Notion', action: 'warm-opener' });
  assert.equal(notion.items.length, 0, `stored: ${JSON.stringify(notion.items.map((i) => i.message))}`);
  const app = await followupRound(['I was a software engineering intern at globex example.']);
  assert.equal(app.items.length, 0, `stored: ${JSON.stringify(app.items.map((i) => i.message))}`);
});

test('fix 9 M5 the shared fact gate has no outreach exemption: invented ranks are claims whatever option is passed', async () => {
  const cv = CV;
  for (const s of ['Happy to share that our team won first.', "I'd love to share that my Campus Bus Tracker took first.", 'Can I share that I graduated first?', 'I was your first intern, remember?', 'Was I your first intern hire?']) {
    assert.ok(factCheck(s, { cv, outreach: true }).some((x) => /first/.test(x)), `outreach option: ${s}`);
    assert.ok(factCheck(s, { cv }).some((x) => /first/.test(x)), `default: ${s}`);
  }
  assert.deepEqual(factCheck('What was the biggest surprise in your first year of engineering work?', { cv, outreach: true }), ['first year'], 'the cover and fill reading for everyone');
  const { items } = await contactRound(['Happy to share that our team won first.']);
  assert.equal(items.length, 0);
});

test('fix 9 G a number or ordinal in a question gets one retry naming the rule; the fixed question is batched', async () => {
  const cases = [
    ['What was the biggest surprise in your first year of engineering work?', 'What was the biggest surprise when you started out in engineering?', /ordinal "first"/],
    ['Would you be open to a quick 15 minute chat in the next couple of weeks?', 'Would you be open to a quick chat in the next couple of weeks?', /digit/],
  ];
  for (const [bad, good, rule] of cases) {
    const { prompts, items, res } = await contactRound([reply({ question: bad }), reply({ question: good })]);
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /Your last reply broke these rules:/);
    assert.match(prompts[1], rule);
    assert.deepEqual(res.flagged, []);
    assert.equal(items[0].message, `Hi Alice,\n\n${good}`);
  }
});

test('fix 9 retry budget: at most 2 calls; a reply still breaking a rule is flagged; plain text is never stored', async () => {
  const twice = await contactRound([reply({ question: 'I have built Kubernetes clusters for your platform team, right?', fact_ids: [99] })]);
  assert.equal(twice.prompts.length, 2);
  assert.equal(twice.items.length, 0);
  assert.match(twice.res.flagged[0].flags.join('; '), /fact_ids: 99 is not an id/);
  assert.match(twice.res.flagged[0].flags.join('; '), /first-person/);
  const plain = await contactRound(["Hi {first_name}, I'm curious about the work at {company}. What do you enjoy most?"]);
  assert.equal(plain.prompts.length, 2);
  assert.equal(plain.items.length, 0);
  assert.match(plain.res.flagged[0].flags.join('; '), /not one JSON object/);
  const fenced = await contactRound(['```json\n{"question": "What do you enjoy most about your work?", "fact_ids": []}\n```']);
  assert.equal(fenced.prompts.length, 1);
  assert.equal(fenced.items[0].message, 'Hi Alice,\n\nWhat do you enjoy most about your work?');
});

test('fix 9 D (S1, N1) code owns the frame: the application is stated once, thanks once, at most one blank line, no Subject line', () => {
  const r = check({ warm_line: 'Thanks for reading.', fact_ids: [3] }, APP);
  assert.deepEqual(r.flags, []);
  assert.equal(r.text.match(/applied/gi).length, 1, 'the application is stated once');
  assert.equal(r.text.match(/November 14, 2026/g).length, 1);
  assert.equal(r.text.match(/thank/gi).length, 1, 'a thanks-only warm_line is dropped in an email');
  assert.ok(!/\n[ \t]*\n[ \t]*\n/.test(r.text) && !/^subject:/im.test(r.text));
  assert.match(check({ warm_line: 'Applied for the role recently.' }, APP).flags.join('; '), /past tense "applied"/);
  assert.match(check({ question: 'What is new?', fact_ids: [1] }, person('Nora Nudge', 'Umbrella Example', 'follow-up', { channel: 'email', signature: 'Sam Placeholder' })).text, /^Hello Nora,\n\nJust following up on my earlier note in case it got buried\. A bit about me: .*\n\nThank you for your time and consideration\.\n\nBest regards,\nSam Placeholder$/s);
  assert.match(check({ warm_line: 'Great to connect.' }, person('Carl Connect', 'Wayne Example', 'connect', { noteChars: 20 })).flags.join('; '), /exceeds the 20 limit/);
});

test('fix 9 H four sample drafts from realistic slot JSON read warm and natural (printed for the report)', (t) => {
  const samples = [
    ['warm opener', ALICE, { warm_line: 'Thanks for connecting, Alice.', question: 'What kind of problems does your team at {company} spend the most time on?', fact_ids: [3] }],
    ['reply suggestion', RITA, { warm_line: 'Thanks for getting back so quickly!', question: 'Is there a team at {company} you would suggest looking at?', fact_ids: [1, 3] }],
    ['referral ask', person('Gina Globex', GLOBEX, 'referral-ask'), { warm_line: 'Thanks so much for the conversation about the platform team, it is a big help.', fact_ids: [5] }],
    ['application follow-up', APP, { warm_line: 'The focus on practical internal tools in this role stands out.', fact_ids: [3] }],
  ];
  const expected = {
    'warm opener': `Hi Alice,\n\nThanks for connecting, Alice. A bit about me: Software engineering intern at Sample Labs (summer 2026): built a Python script that cut a weekly report from 2 hours to 10 minutes. What kind of problems does your team at ${ACME} spend the most time on?`,
    'reply suggestion': `Hi Rita,\n\nThanks for getting back so quickly! A bit about me: Computer science student at Example State University, graduating May 2027. Also: Software engineering intern at Sample Labs (summer 2026): built a Python script that cut a weekly report from 2 hours to 10 minutes. Is there a team at ${INITECH} you would suggest looking at?`,
    'referral ask': `Hi Gina,\n\nThanks so much for the conversation about the platform team, it is a big help. One of my projects: Campus Bus Tracker: a small web app in JavaScript and Python that shows live bus times. Would you be comfortable referring me for an open role at ${GLOBEX}? It is completely fine to say no.`,
    'application follow-up': `Hello ${GLOBEX} hiring team,\n\nI applied for the ${TITLE} role at ${GLOBEX} on November 14, 2026, and I wanted to follow up. The focus on practical internal tools in this role stands out.\n\nA bit about my background: Software engineering intern at Sample Labs (summer 2026): built a Python script that cut a weekly report from 2 hours to 10 minutes.\n\nPlease let me know if there is anything else I can send.\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder`,
  };
  for (const [name, job, slots] of samples) {
    const r = check(slots, job);
    assert.deepEqual(r.flags, [], name);
    assert.equal(r.text, expected[name], name);
    t.diagnostic(`--- ${name}\n${r.text}`);
  }
});
