// SYNTHETIC FIXTURE: placeholder people, companies and cv text only.
// M-004 live-verify fixes. Row 1: an apply.* row (target = application url) never becomes an outreach contact, so an
// applied company gets no `connect <url>` line. Row 2: the fact gate grounds each outreach draft in cv.md plus the facts
// that belong to that draft (contact full and first name, company, role, job title, submit date, profile fields, "Hiring
// team"), and an acronym passes only when cv.md or the profile holds it as is or spelled out; an invented employer or
// degree is still flagged. Row 2b: `outreach-drafts.mjs --followup-to "<Company>" <email>` works from the command line.
// Row 7: the drafts round, --followup-to and batch.mjs approve end with the Next / Type / Why footer.
// Scratch roots, synthetic placeholder people and companies, example.com addresses, an injected headless runner or a
// fake `claude` on an isolated PATH: no real model, network, Gmail or LinkedIn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { check as factCheck } from '../../lib/fact-gate.mjs';
import { listBatches, readBatch, writeBatches } from '../../lib/batch-file.mjs';
import { contactRecords } from '../../lib/outreach-state.mjs';
import { resolvePaths } from '../../lib/paths.mjs';
import { appendTsv, serializeTsv } from '../../lib/tsv.mjs';
import { main as batchMain } from '../../scripts/batch.mjs';
import { addFollowupTo, draftFacts, outreachDrafts, spellOutAcronyms } from '../../scripts/outreach-drafts.mjs';
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
  assert.equal(spellOutAcronyms('a CS student and a former TA', cv), 'a computer science student and a former teaching assistant');
  assert.equal(spellOutAcronyms('my CV', cv), 'my CV', 'no CV and no spelled-out form: left for the gate');
  assert.equal(spellOutAcronyms('my CV', 'Curriculum vitae on request.'), 'my curriculum vitae');
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

test('row 2 draftFacts holds the contact, company, role, job title, submit date, profile fields and Hiring team', () => {
  const contactRows = [{ name: 'Alice Alpha', company: ACME, role: 'Data Engineer' }];
  const person = draftFacts({ action: 'reply', contact: { name: 'Alice Alpha', company: ACME } }, { candidate: { full_name: 'Sam Placeholder', links: { site: 'sam.example.com' } }, contactRows });
  for (const f of ['Alice Alpha', 'Alice', ACME, 'Data Engineer', 'Sam Placeholder', 'sam.example.com', 'Hiring team']) assert.ok(person.includes(f), `${f} in ${person}`);
  const app = draftFacts({ action: 'application-follow-up', contact: { name: 'Hiring team', company: GLOBEX }, application: { target: GLOBEX_APP, company: GLOBEX, submitted: '2026-11-14', title: 'Software Engineering Intern' } });
  for (const f of ['Hiring team', GLOBEX, 'Software Engineering Intern', '2026-11-14']) assert.ok(app.includes(f), `${f} in ${app}`);
  assert.ok(!app.includes('Hiring'), 'an application follow-up has no person first name');
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
