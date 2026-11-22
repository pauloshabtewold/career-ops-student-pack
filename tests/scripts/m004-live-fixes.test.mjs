// SYNTHETIC FIXTURE: placeholder people, companies and cv text only.
// M-004 live-verify fixes. Row 1: an apply.* row (target = application url) never becomes an outreach contact, so an
// applied company gets no `connect <url>` line. Row 2: the fact gate grounds each outreach draft in cv.md plus the names
// of that draft that make no claim (contact full and first name, submit date, profile fields, "Hiring team"); the company,
// job title and contact role pass only as the gate's company and role names, so an experience or title claim with them is
// flagged. An acronym passes only when cv.md or the profile holds it as is or spells it out on one line with the first
// word capitalized; an invented employer or degree is still flagged. Fix 6 cases are at the end of the file. Row 2b: `outreach-drafts.mjs --followup-to "<Company>" <email>` works from the command line.
// Row 7: the drafts round, --followup-to and batch.mjs approve end with the Next / Type / Why footer.
// Scratch roots, synthetic placeholder people and companies, example.com addresses, an injected headless runner or a
// fake `claude` on an isolated PATH: no real model, network, Gmail or LinkedIn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check as factCheck } from '../../lib/fact-gate.mjs';
import { listBatches, readBatch, writeBatches } from '../../lib/batch-file.mjs';
import { sendEmail } from '../../lib/gmail-chrome.mjs';
import { contactRecords } from '../../lib/outreach-state.mjs';
import { resolvePaths } from '../../lib/paths.mjs';
import { appendTsv, serializeTsv } from '../../lib/tsv.mjs';
import { main as batchMain } from '../../scripts/batch.mjs';
import { addFollowupTo, contactRoles, draftFacts, maskTargetNames, outreachDrafts, spellOutAcronyms, stripSubjectLine } from '../../scripts/outreach-drafts.mjs';
import { LOG_HEADER, at, makePack, row, shiftDate } from '../helpers/budget-harness.mjs';
import { due, linesFor } from '../helpers/outreach-harness.mjs';
import { PACK_ROOT, makeRoot } from '../helpers/script-harness.mjs';

const DAY = '2026-11-22';
const SUBMITTED = shiftDate(DAY, -8);
const ACME = 'Acme Example';
const WAYNE = 'Wayne Example';
const UMBRELLA = 'Umbrella Example';
const INITECH = 'Initech Example';
const GLOBEX = 'Globex Example';
const SOYLENT = 'Soylent Example';
const GLOBEX_APP = 'https://jobs.example.com/globex/swe-intern';
const SOYLENT_APP = 'https://jobs.example.com/soylent/data-intern';

const CV = `# Sam Placeholder: CV

Computer science student at Example State University, graduating May 2027.

## Experience
- Software engineering intern at Sample Labs (summer 2026): built a Python script that cut a weekly report from 2 hours to 10 minutes.
- Teaching assistant for Data Structures at Example State University (2025 to 2026).

## Skills
Python, JavaScript, SQL, Git
`;
const PROFILE = 'candidate:\n  full_name: "Sam Placeholder"\n  email: "sam@example.com"\n';

// Drafts shaped like the live real-model run: first-name greetings, CS and TA, the company outside a fixed context,
// a "hiring team" greeting and a submit day number.
const LIVE = {
  'Alice Alpha': "Hi Alice, I'm Sam, a CS student at Example State University. I'm reaching out because I'm curious about the work at Acme Example. I recently built a Python script that turned a 2 hour weekly report into 10 minutes, so I enjoy practical automation. What kind of problems does your team work on?",
  'Carl Connect': "Hi Carl, I'm a CS student at Example State and a former TA for Data Structures. I'd enjoy following your work at Wayne Example.",
  'Nora Nudge': "Hi Nora, just following up on my earlier note in case it got buried. I'm a computer science student at Example State University, graduating May 2027, and I recently built a Python script during an internship at Sample Labs that cut a weekly report from 2 hours to 10 minutes. I'd still love to be considered for a role at Umbrella Example. Would it be easier if I sent over my CV, or is there a better person for me to reach out to?\n\nThanks,\nSam",
  'Rita Reply': "Hi Rita, thanks for getting back to me. I graduate in May 2027 with a computer science degree from Example State University.\n\nI'm most interested in software engineering work where I can use Python, JavaScript and SQL. This past summer I interned at Sample Labs, where I built a Python script that cut a weekly report from 2 hours to 10 minutes. I also enjoyed being a teaching assistant for Data Structures.\n\nWhich teams at Initech Example are growing right now?\n\nBest,\nSam",
  'Hiring team': 'Hello Globex Example hiring team,\n\nI applied for the Software Engineering Intern role on 14 November 2026 and wanted to follow up briefly.\n\nI think I would be a good fit because of my internship at Sample Labs last summer, where I built a Python script that cut a weekly report from 2 hours to 10 minutes.\n\nIs there anything else I can send, such as code samples or more detail on my projects?\n\nBest regards,\nSam Placeholder',
};
const STATE = {
  due: [
    { name: 'Alice Alpha', company: ACME, stage: 'connected', action: 'warm-opener' },
    { name: 'Carl Connect', company: WAYNE, stage: 'new', action: 'connect' },
    { name: 'Nora Nudge', company: UMBRELLA, stage: 'connected', action: 'follow-up', channel: 'linkedin' },
  ],
  followups: [{ target: GLOBEX_APP, company: GLOBEX, submitted: '2026-11-14', email: 'recruiter@example.com' }],
};
const REPLIES = [{ name: 'Rita Reply', company: INITECH, text: 'Thanks for connecting! When do you graduate, and which team interests you?' }];

// A headless runner that answers each prompt with the draft for the contact it names; texts overrides some contacts.
const headlessFor = (texts = {}) => async (opts) => {
  const name = Object.keys(LIVE).find((n) => String(opts.prompt).includes(`Contact: ${n} at`));
  return { text: texts[name] ?? LIVE[name] ?? 'Thanks for connecting.', model: 'sonnet', usage: null };
};

function liveRoot({ config = '' } = {}) {
  const r = makeRoot({ config });
  r.write('cv.md', CV);
  r.write('config/profile.yml', PROFILE);
  r.write('data/contacts.tsv', serializeTsv(['date', 'company', 'name', 'stage', 'role'], [
    { date: shiftDate(DAY, -10), company: ACME, name: 'Alice Alpha', stage: 'accepted', role: 'Data Engineer' },
  ]));
  r.write('data/pipeline.md', `# Pipeline\n\n## Processed\n\n- [x] ${GLOBEX_APP} | ${GLOBEX} | Software Engineering Intern | Remote\n`);
  return r;
}

const run = (r, { texts, state = STATE, replies = REPLIES } = {}) => {
  const said = [];
  return outreachDrafts({ paths: resolvePaths({ root: r.root, dataDir: r.data }), today: DAY, replies, deps: { headless: headlessFor(texts), state, t6On: false }, say: (s) => said.push(String(s)) }).then((res) => ({ res, said }));
};

// Same rule as lintGuided in tests/ops/guided-messages.test.mjs (locked, so repeated here): null when the text holds
// every guided line.
function lintGuided(name, text) {
  const lines = String(text).split('\n').map((l) => l.replace(/^[\s>*_-]+/, '').replace(/^\*\*(Next|Type|Why):\*\*/, '$1:'));
  const missing = ['Next:', 'Type:', 'Why:'].filter((p) => !lines.some((l) => l.startsWith(p)));
  return missing.length ? `${name}: missing the ${missing.join(', ')} line${missing.length > 1 ? 's' : ''}` : null;
}

// Row 1

test('row 1 contactRecords builds no contact from apply.* rows, whose target is an application url', () => {
  const ts = at(SUBMITTED, 12, 0);
  const rows = ['apply.submit', 'apply.pending', 'apply.easy_apply', 'apply.followup'].map((action) => ({ ...row({ ts, action, target: SOYLENT_APP, company: SOYLENT }), ms: Date.parse(ts) }));
  assert.deepEqual(contactRecords([], rows), []);
  const withPerson = contactRecords([], [...rows, { ...row({ ts, action: 'linkedin.connect', target: 'Sally Person', company: SOYLENT }), ms: Date.parse(ts) }]);
  assert.deepEqual(withPerson.map((c) => c.name), ['Sally Person']);
});

test('row 1 outreach-state due with only an apply.submit row lists its application follow-up and no connect to the url', async () => {
  const p = await makePack({ rows: [row({ ts: at(SUBMITTED, 12, 0), action: 'apply.submit', target: SOYLENT_APP, company: SOYLENT })] });
  try {
    const r = due(p, { today: DAY });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const lines = linesFor(r.stdout, SOYLENT_APP);
    assert.equal(lines.length, 1, r.stdout);
    assert.match(lines[0], /^application-follow-up/);
    assert.ok(!/^connect\t/m.test(r.stdout), `no connect line: ${r.stdout}`);
  } finally {
    p.cleanup();
  }
});

// Row 2

test('row 2 realistic drafts like the live ones pass the fact gate and all reach the batch', async () => {
  const r = liveRoot();
  try {
    const { res, said } = await run(r);
    assert.deepEqual(res.flagged, [], said.join('\n'));
    assert.equal(res.ready, 5, said.join('\n'));
    const items = res.ids.flatMap((id) => readBatch(r.data, id).items);
    assert.deepEqual(items.map((i) => i.company).sort(), [ACME, GLOBEX, INITECH, UMBRELLA, WAYNE]);
  } finally {
    r.cleanup();
  }
});

test('row 2 an invented employer or degree in a draft is still flagged and kept out of the batch', async () => {
  const r = liveRoot();
  try {
    const texts = {
      'Alice Alpha': "Hi Alice, I'm Sam. Last summer I interned at Initrode Systems, and I would like to hear about your work at Acme Example.",
      'Nora Nudge': "Hi Nora, just following up. I'm finishing my MBA at Example State University and would still love to hear from you.",
    };
    const { res } = await run(r, { texts });
    const flags = Object.fromEntries(res.flagged.map((f) => [f.name, f.flags.join('; ')]));
    assert.match(flags['Alice Alpha'] ?? '', /Initrode Systems/);
    assert.match(flags['Nora Nudge'] ?? '', /MBA/);
    const batched = JSON.stringify(res.ids.flatMap((id) => readBatch(r.data, id).items));
    assert.ok(!batched.includes(ACME) && !batched.includes(UMBRELLA), batched);
    assert.equal(res.ready, 3);
  } finally {
    r.cleanup();
  }
});

test('row 2 an acronym passes only when the cv or profile holds it as is or spelled out; acronyms are not allowed globally', () => {
  const cv = 'Computer science student. Teaching assistant for Data Structures.';
  assert.equal(spellOutAcronyms('a CS student and a former TA', cv), 'a Computer science student and a former Teaching assistant', 'the cv casing is kept');
  assert.equal(spellOutAcronyms('my CV', cv), 'my CV', 'no CV and no spelled-out form: left for the gate');
  assert.equal(spellOutAcronyms('my CV', 'Curriculum vitae on request.'), 'my Curriculum vitae');
  assert.equal(spellOutAcronyms('my CV', 'Full CV on request.'), 'my CV');
  assert.equal(spellOutAcronyms('a CS student', 'Contact for Sam.'), 'a CS student', 'a stop word never spells an acronym');
  const facts = draftFacts({ action: 'warm-opener', contact: { name: 'Alice Alpha', company: ACME } }, { candidate: { full_name: 'Sam Placeholder' } });
  const gate = (text, own) => factCheck(spellOutAcronyms(text, [own, ...facts].join('\n')), { cv: own, answers: facts, company: ACME, extra: ['Alice Alpha'] });
  assert.deepEqual(gate("Hi Alice, I'm a CS student and a former TA.", cv), []);
  assert.deepEqual(gate("I'm a CS student.", 'Biology student.'), ['CS']);
});

test('row 2 CV, résumé and resume name the document and pass in every draft; an acronym claim such as CS degree still flags', () => {
  const cv = 'Biology student at Example State University.';
  const facts = draftFacts({ action: 'warm-opener', contact: { name: 'Alice Alpha', company: ACME } });
  for (const w of ['CV', 'résumé', 'resume']) assert.ok(facts.includes(w), `${w} in ${facts}`);
  const gate = (text) => factCheck(spellOutAcronyms(text, [cv, ...facts].join('\n')), { cv, answers: facts, company: ACME, extra: ['Alice Alpha'] });
  assert.deepEqual(gate("I've attached my CV."), []);
  assert.deepEqual(gate('Happy to send my Résumé or resume.'), []);
  assert.deepEqual(gate('I hold a CS degree.'), ['CS']);
});

test('row 2 draftFacts holds the contact, submit date, profile fields and Hiring team, never the company, role or job title', () => {
  const contactRows = [{ name: 'Alice Alpha', company: ACME, role: 'Data Engineer' }];
  const reply = { action: 'reply', contact: { name: 'Alice Alpha', company: ACME } };
  const person = draftFacts(reply, { candidate: { full_name: 'Sam Placeholder', links: { site: 'sam.example.com' } } });
  for (const f of ['Alice Alpha', 'Alice', 'Sam Placeholder', 'sam.example.com', 'Hiring team']) assert.ok(person.includes(f), `${f} in ${person}`);
  for (const f of [ACME, 'Data Engineer']) assert.ok(!person.includes(f), `${f} not in ${person}`);
  assert.deepEqual(contactRoles(reply, contactRows), ['Data Engineer'], 'the role goes to the gate as a role name');
  const appJob = { action: 'application-follow-up', contact: { name: 'Hiring team', company: GLOBEX }, application: { target: GLOBEX_APP, company: GLOBEX, submitted: '2026-11-14', title: 'Software Engineering Intern' } };
  const app = draftFacts(appJob);
  for (const f of ['Hiring team', '2026-11-14']) assert.ok(app.includes(f), `${f} in ${app}`);
  for (const f of [GLOBEX, 'Software Engineering Intern']) assert.ok(!app.includes(f), `${f} not in ${app}`);
  assert.ok(!app.includes('Hiring'), 'an application follow-up has no person first name');
  assert.deepEqual(contactRoles(appJob, contactRows), []);
});

// Row 2b

// A fake `claude` on an isolated PATH that prints a fixed draft and counts its calls, so the CLI never reaches a real model.
function fakeClaude(r, text) {
  const bin = r.file('bin');
  const home = r.file('home');
  mkdirSync(bin);
  mkdirSync(home);
  const calls = r.file('calls.txt');
  const body = `#!${process.execPath}\nconst fs = require('node:fs');\nfs.appendFileSync(${JSON.stringify(calls)}, 'call\\n');\nprocess.stdout.write(JSON.stringify({ result: ${JSON.stringify(text)}, modelUsage: { 'fake-model': {} }, usage: { input_tokens: 1, output_tokens: 1 } }));\n`;
  writeFileSync(join(bin, 'claude'), body);
  chmodSync(join(bin, 'claude'), 0o755);
  return { env: { PATH: bin, HOME: home }, calls: () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').length : 0) };
}

const drafts = (r, args, env) => {
  const out = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'outreach-drafts.mjs'), ...args, '--root', r.root, '--data-dir', r.data, '--today', DAY], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 60000, env });
  return { code: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '' };
};

test('row 2b outreach-drafts.mjs --followup-to "<Company>" <email> adds the follow-up from the command line', async () => {
  const r = liveRoot();
  try {
    await appendTsv(r.file('data/action-log.tsv'), LOG_HEADER, [row({ ts: at(SUBMITTED, 12, 0), action: 'apply.submit', target: SOYLENT_APP, company: SOYLENT })]);
    const fake = fakeClaude(r, 'Thanks for considering my application. I would be glad to send anything else you need.');
    const res = drafts(r, ['--followup-to', SOYLENT, 'soylent-hr@example.com'], fake.env);
    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.equal(fake.calls(), 1, 'one call to the fake claude');
    assert.match(res.stdout, /follow-up to soylent-hr@example\.com is item 1 of /);
    assert.equal(lintGuided('--followup-to success', res.stdout), null, res.stdout);
    const items = listBatches(r.data).flatMap((id) => readBatch(r.data, id).items);
    assert.equal(items.length, 1);
    assert.equal(items[0].to, 'soylent-hr@example.com');
    assert.equal(items[0].target, SOYLENT_APP);
  } finally {
    r.cleanup();
  }
});

test('row 2b and row 7 --followup-to without the email or with two words exits 2 with the usage line and the guided footer', () => {
  const r = liveRoot();
  try {
    const fake = fakeClaude(r, 'unused');
    for (const args of [['--followup-to', SOYLENT], ['--followup-to', SOYLENT, 'a@example.com', 'extra']]) {
      const res = drafts(r, args, fake.env);
      assert.equal(res.code, 2, res.stdout + res.stderr);
      assert.match(res.stderr, /usage: outreach-drafts\.mjs --followup-to/);
      assert.equal(lintGuided('--followup-to usage', res.stderr), null, res.stderr);
    }
    assert.equal(fake.calls(), 0);
  } finally {
    r.cleanup();
  }
});

// Row 7

test('row 7 a round with flagged drafts ends with a footer that says what happened and the prompt to fix them', async () => {
  const r = liveRoot();
  try {
    const { said } = await run(r, { texts: { 'Alice Alpha': 'Hi Alice, I interned at Initrode Systems.' } });
    const text = said.join('\n');
    assert.match(text, /flagged and kept out of the batch/);
    assert.equal(lintGuided('flagged round', text), null, text);
    assert.match(text, /^Next: 1 draft\(s\) were flagged and kept out of the batch/m);
    assert.match(text, /^Type: fix my flagged outreach$/m);
    assert.ok(said.at(-1).startsWith('Just ask'), 'the footer ends the output');
  } finally {
    r.cleanup();
  }
});

test('row 7 the batch summary, the drafts-file line and an empty round each end with the guided footer', async () => {
  const on = liveRoot();
  const draftsMode = liveRoot({ config: 'switches:\n  outreach: drafts\n' });
  const empty = liveRoot();
  try {
    const a = await run(on);
    assert.equal(lintGuided('batch summary', a.said.join('\n')), null);
    assert.match(a.said.join('\n'), /^Type: show batch /m);
    const b = await run(draftsMode);
    const bText = b.said.join('\n');
    assert.match(bText, /contact draft\(s\) in .*drafts-/);
    assert.equal(lintGuided('drafts file', bText), null, bText);
    assert.match(bText, /^Next: send draft 1 from .*drafts-.* yourself$/m);
    const c = await run(empty, { state: { due: [], followups: [] }, replies: [] });
    assert.equal(lintGuided('empty round', c.said.join('\n')), null);
  } finally {
    on.cleanup();
    draftsMode.cleanup();
    empty.cleanup();
  }
});

test('row 7 an added and a flagged --followup-to draft each end with the guided footer', async () => {
  const r = liveRoot();
  try {
    const paths = resolvePaths({ root: r.root, dataDir: r.data });
    const state = { due: [], followups: [{ target: SOYLENT_APP, company: SOYLENT, submitted: SUBMITTED }] };
    const said = [];
    const bad = await addFollowupTo({ paths, today: DAY, which: SOYLENT, email: 'hr@example.com', deps: { headless: async () => ({ text: 'I interned at Initrode Systems.', model: 'sonnet', usage: null }), state }, say: (s) => said.push(s) });
    assert.equal(bad.id, null);
    assert.equal(lintGuided('flagged follow-up', said.join('\n')), null, said.join('\n'));
    said.length = 0;
    const ok = await addFollowupTo({ paths, today: DAY, which: SOYLENT, email: 'hr@example.com', deps: { headless: async () => ({ text: 'Is there anything else I can send?', model: 'sonnet', usage: null }), state }, say: (s) => said.push(s) });
    assert.equal(ok.item, 1);
    assert.equal(lintGuided('added follow-up', said.join('\n')), null, said.join('\n'));
  } finally {
    r.cleanup();
  }
});

test('row 7 batch.mjs approve success and its exit-5 could-not-read reply end with the guided footer', async () => {
  const r = makeRoot();
  try {
    const [id] = writeBatches(r.data, { date: DAY, kind: 'outreach', items: [{ company: ACME, role: 'Alice Alpha (warm-opener)', score: null, preview: 'Hi', link: '', message: 'Hi', action: 'warm-opener', channel: 'linkedin', target: 'Alice Alpha' }] });
    const base = ['--root', r.root, '--data-dir', r.data, '--today', DAY];
    const said = [];
    const runner = () => ({ code: 0, stdout: '', stderr: '' });
    const code = await batchMain(['approve', id, 'send all', ...base], { say: (s) => said.push(s), runner });
    assert.equal(code, 0, said.join('\n'));
    assert.match(said.join('\n'), /approved items 1 of /);
    assert.equal(lintGuided('approve success', said.join('\n')), null, said.join('\n'));
    said.length = 0;
    const unread = await batchMain(['approve', id, 'maybe later', ...base], { say: (s) => said.push(s), runner });
    assert.equal(unread, 5, said.join('\n'));
    assert.equal(lintGuided('approve could not read', said.join('\n')), null, said.join('\n'));
    assert.match(said.join('\n'), /^Type: send all, or all except 3$/m);
  } finally {
    r.cleanup();
  }
});

// Round 5

test('row 5b an email draft that starts with its own Subject line is stored and sent from the greeting, under the item subject', async () => {
  const r = liveRoot();
  try {
    const prompts = [];
    const texts = { 'Hiring team': `Subject: Following up on my Software Engineering Intern application\n\n${LIVE['Hiring team']}` };
    const said = [];
    const headless = async (opts) => {
      prompts.push(String(opts.prompt));
      return headlessFor(texts)(opts);
    };
    const paths = resolvePaths({ root: r.root, dataDir: r.data });
    const res = await outreachDrafts({ paths, today: DAY, replies: [], deps: { headless, state: { due: [], followups: STATE.followups }, t6On: false }, say: (s) => said.push(String(s)) });
    assert.deepEqual(res.flagged, [], said.join('\n'));
    const [id] = res.ids;
    const item = readBatch(r.data, id).items[0];
    assert.ok(item.message.startsWith('Hello Globex Example hiring team,'), item.message);
    assert.ok(!/^subject:/im.test(item.message), item.message);
    assert.equal(item.subject, `Following up on my application to ${GLOBEX}`);
    assert.match(prompts[0], /no subject line, start with the greeting/);

    const passAll = () => ({ code: 0, stdout: 'ok', stderr: '' });
    const sent = await sendEmail({ paths, port: 9, email: { batchId: id, item: 1, target: GLOBEX_APP, company: GLOBEX, followup: { target: GLOBEX_APP, company: GLOBEX } }, date: DAY, runner: passAll, browser: async () => 'sent' });
    assert.equal(sent.code, 0, JSON.stringify(sent));
    const threads = r.file('data/threads');
    const archived = readdirSync(threads).map((f) => readFileSync(join(threads, f), 'utf8')).join('\n');
    const body = archived.slice(archived.indexOf(`Subject: ${item.subject}`) + `Subject: ${item.subject}`.length);
    assert.ok(body.includes('Hello Globex Example hiring team,'), archived);
    assert.ok(!/^subject:/im.test(body), `the sent body has no Subject line: ${archived}`);
  } finally {
    r.cleanup();
  }
});

const LONG_NOTE = 'Hi Carl, I would enjoy following your work at Wayne Example and learning from your path in software. '.repeat(3).trim();
const SHORT_NOTE = 'Hi Carl, I would enjoy following your work at Wayne Example and learning from your path in software.';
const CONNECT_STATE = { due: [{ name: 'Carl Connect', company: WAYNE, stage: 'new', action: 'connect' }], followups: [] };

async function connectRound(replies) {
  const r = liveRoot({ config: 'linkedin_tier: free\n' });
  const prompts = [];
  const headless = async (opts) => {
    prompts.push(String(opts.prompt));
    return { text: replies[Math.min(prompts.length - 1, replies.length - 1)], model: 'sonnet', usage: null };
  };
  try {
    const res = await outreachDrafts({ paths: resolvePaths({ root: r.root, dataDir: r.data }), today: DAY, replies: [], deps: { headless, state: CONNECT_STATE, t6On: false }, say: () => {} });
    return { res, prompts, items: res.ids.flatMap((id) => readBatch(r.data, id).items) };
  } finally {
    r.cleanup();
  }
}

test('row 2 a connect note over the limit is asked for once more with the limit and the overrun; a fitting retry is batched', async () => {
  assert.ok(LONG_NOTE.length > 200 && SHORT_NOTE.length <= 200);
  const { res, prompts, items } = await connectRound([LONG_NOTE, SHORT_NOTE]);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], new RegExp(`${LONG_NOTE.length} characters, ${LONG_NOTE.length - 200} over the hard limit of 200`));
  assert.deepEqual(res.flagged, []);
  assert.equal(items.length, 1);
  assert.equal(items[0].message, SHORT_NOTE, 'the retry text is kept whole');
});

test('row 2 a connect note still over the limit after the one retry is flagged, never cut', async () => {
  const { res, prompts, items } = await connectRound([LONG_NOTE, LONG_NOTE]);
  assert.equal(prompts.length, 2, 'one retry only');
  assert.equal(items.length, 0);
  assert.match(res.flagged[0]?.flags.join('; ') ?? '', /exceeds the 200 limit/);
});

// Fix 6 (re-review r4)

const ALICE_ONLY = { due: [STATE.due[0]], followups: [] };
const GLOBEX_ONLY = { due: [], followups: STATE.followups };

// One round for one contact with the given draft text, in a root whose cv.md is cv (the live cv by default).
async function roundFor(state, name, text, { cv } = {}) {
  const r = liveRoot();
  if (cv !== undefined) r.write('cv.md', cv);
  try {
    const { res, said } = await run(r, { texts: { [name]: text }, state, replies: [] });
    return { res, said, items: res.ids.flatMap((id) => readBatch(r.data, id).items), flags: res.flagged.map((f) => f.flags.join('; ')).join(' | ') };
  } finally {
    r.cleanup();
  }
}

test('fix 6 M1 an experience or title claim with the target company, job title or contact role is flagged and kept out', async () => {
  const cases = [
    [ALICE_ONLY, 'Alice Alpha', 'Hi Alice, I interned at Acme Example last summer and loved it.', /Acme Example/],
    [ALICE_ONLY, 'Alice Alpha', 'Hi Alice, I worked at Acme Example on the data team.', /Acme Example/],
    [GLOBEX_ONLY, 'Hiring team', 'Hello Globex Example hiring team, I was a Software Engineering Intern at Globex Example before.', /Software Engineering Intern/],
    [GLOBEX_ONLY, 'Hiring team', 'Hello hiring team, I worked as a Software Engineering Intern last year.', /Software Engineering Intern/],
    [ALICE_ONLY, 'Alice Alpha', 'Hi Alice, I also worked as a Data Engineer at Acme Example.', /Data Engineer/],
  ];
  // The reviewer's probe cv, which holds none of these employers or titles.
  for (const [state, name, text, flag] of cases) {
    const { res, items, flags } = await roundFor(state, name, text, { cv: CV_LOOKALIKE });
    assert.equal(res.ready, 0, `${text} must be flagged`);
    assert.equal(items.length, 0, text);
    assert.match(flags, flag, text);
  }
});

const CV_CS = '# Sam Placeholder\n\n## Education\nBS Computer Science, Example State University, 2027\n\n## Skills\nPython, SQL\n';

test('fix 6 M1 natural lines pass: a first-name greeting, a CS student, the company team greeting and the application to the title', async () => {
  const opener = "Hi Alice, I'm a CS student at Example State University. I'd love to learn about your work at Acme Example.";
  const a = await roundFor(ALICE_ONLY, 'Alice Alpha', opener, { cv: CV_CS });
  assert.equal(a.flags, '', a.said.join('\n'));
  assert.equal(a.items[0]?.message, opener);
  const follow = 'Hello Globex Example hiring team,\n\nI am following up on my application for the Software Engineering Intern role, sent on 14 November 2026.\n\nBest regards,\nSam Placeholder';
  const g = await roundFor(GLOBEX_ONLY, 'Hiring team', follow, { cv: CV_CS });
  assert.equal(g.flags, '', g.said.join('\n'));
  assert.equal(g.items.length, 1);
  const applied = await roundFor(GLOBEX_ONLY, 'Hiring team', 'Hello Globex Example hiring team,\n\nI applied for the Software Engineering Intern position on 14 November 2026.\n\nBest,\nSam', { cv: CV_CS });
  assert.equal(applied.flags, '', applied.said.join('\n'));
});

test('fix 6 M1 maskTargetNames blanks only the greeting, application and curiosity contexts', () => {
  const opts = { company: GLOBEX, title: 'Software Engineering Intern' };
  assert.ok(!maskTargetNames('Hello Globex Example hiring team,', opts).includes(GLOBEX));
  assert.ok(!maskTargetNames("I've applied for the Software Engineering Intern role.", opts).includes('Software Engineering Intern'));
  assert.ok(!maskTargetNames("I'm curious about the work at Globex Example.", opts).includes(GLOBEX));
  for (const kept of ['I interned at Globex Example.', 'Last year I was at Globex Example, hiring team lead.', "I'm curious about my old team at Globex Example.", 'I worked as a Software Engineering Intern.']) {
    assert.equal(maskTargetNames(kept, opts), kept, kept);
  }
});

const CV_LOOKALIKE = '# Sam Placeholder\n\n## Experience\nCampus Bookstore, Sales Associate, 2024 to 2025\n- Handled customer service at the front desk\n- Helped with artistic illustration for club posters\n- Managed budget allocation for the hiking club\n';

test('fix 6 M2 an acronym is not spelled out by look-alike cv words: CS degree, AI models and my MBA are flagged', async () => {
  for (const [text, flag] of [['Hi Alice, I hold a CS degree and want to learn more.', /\bCS\b/], ['Hi Alice, I build AI models in my spare time.', /\bAI\b/], ['Hi Alice, I am finishing my MBA this spring.', /\bMBA\b/]]) {
    const { res, flags } = await roundFor(ALICE_ONLY, 'Alice Alpha', text, { cv: CV_LOOKALIKE });
    assert.equal(res.ready, 0, text);
    assert.match(flags, flag, text);
  }
  assert.equal(spellOutAcronyms('a CS degree', CV_LOOKALIKE), 'a CS degree');
  assert.equal(spellOutAcronyms('AI models', CV_LOOKALIKE), 'AI models');
  assert.equal(spellOutAcronyms('my MBA', CV_LOOKALIKE), 'my MBA');
});

test('fix 6 M2 CS is spelled out only from one cv line with the first word capitalized, in the cv casing', async () => {
  assert.equal(spellOutAcronyms('a CS student', CV_CS), 'a Computer Science student');
  assert.equal(spellOutAcronyms('a CS student', 'BS computer science'), 'a CS student', 'a lowercase first word is not a spelling-out');
  assert.equal(spellOutAcronyms('a CS student', 'Studied Computer\nScience'), 'a CS student', 'never across a line break');
  const { res, said } = await roundFor(ALICE_ONLY, 'Alice Alpha', "Hi Alice, I'm a CS student and would love to hear about your team.", { cv: CV_CS });
  assert.deepEqual(res.flagged, [], said.join('\n'));
  assert.equal(res.ready, 1);
});

test('fix 6 N1 a bold Subject line is stripped; a reply that is only a Subject line is flagged as empty, never batched', async () => {
  assert.equal(stripSubjectLine('**Subject:** Following up\n\nHello team,'), 'Hello team,');
  assert.equal(stripSubjectLine('Subject: only line'), '');
  const { res, items, flags } = await roundFor(GLOBEX_ONLY, 'Hiring team', '**Subject:** Following up on my application');
  assert.equal(items.length, 0);
  assert.equal(res.ready, 0);
  assert.match(flags, /empty/);
});

test('fix 6 N2 an email draft has 3 or more line breaks in a row collapsed to one blank line before it is stored', async () => {
  const text = 'Hello Globex Example hiring team,\n\n\n\nI am following up on my application for the Software Engineering Intern role.\n\n \n\nBest regards,\nSam Placeholder';
  const { items, said } = await roundFor(GLOBEX_ONLY, 'Hiring team', text);
  assert.equal(items.length, 1, said.join('\n'));
  assert.equal(items[0].message, 'Hello Globex Example hiring team,\n\nI am following up on my application for the Software Engineering Intern role.\n\nBest regards,\nSam Placeholder');
});

test('ruling a LinkedIn profile view is research: it creates no contact and no connect due item', async () => {
  const ts = at(shiftDate(DAY, -1), 12, 0);
  const view = { ...row({ ts, action: 'linkedin.profile_view', target: 'Vera Viewed', company: SOYLENT }), ms: Date.parse(ts) };
  assert.deepEqual(contactRecords([], [view]), []);
  const p = await makePack({ rows: [row({ ts, action: 'linkedin.profile_view', target: 'Vera Viewed', company: SOYLENT })] });
  try {
    const r = due(p, { today: DAY });
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(linesFor(r.stdout, 'Vera Viewed'), [], r.stdout);
  } finally {
    p.cleanup();
  }
});
