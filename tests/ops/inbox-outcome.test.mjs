// Assumed (M-005): lib/outcome-rules.mjs decideOutcome(mail, company, { t7On, classify }) takes a normalized mail
// { id, from, subject, snippet, date } and the tracked company name. classify(mail) resolves to the agent class, one of
// the OUTCOMES keys (rejection, interview, offer) or 'unclear'. The result is the status (a string, or an object with
// status) only when the agent class, the phrase rules and the sender domain agree; otherwise it is a proposal with no
// status. scripts/inbox.mjs main(argv, deps) with --classify-outcomes classifies outcome mail through deps.classify
// (the injected agent classifier), applies a status through set-status via deps.runner and logs the prior status in its
// output or the set-status note; anything else stays a line under '## Proposed status changes'. Fake mail only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OUTCOMES, decideOutcome, domainMatches } from '../../lib/outcome-rules.mjs';
import { main } from '../../scripts/inbox.mjs';

const TODAY = '2026-10-27';
const FRESH = '2026-10-26T15:00:00.000Z';
const COMPANY = 'Northwind Robotics';
const APPS = [
  '# Applications',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-10-10 | Northwind Robotics | Data Intern | 4.2/5 | Applied | no | none | |',
  '| 2 | 2026-10-11 | Contoso Analytics | Analyst Intern | 4.0/5 | Applied | no | none | |',
  '',
].join('\n');
const REJECT_TEXT = 'Thank you for your time. We have decided to move forward with other candidates for this role.';
const msg = (id, from, subject, snippet) => ({ id, from, subject, snippet, date: FRESH });
const OWN = 'Northwind Robotics Recruiting <recruiting@northwindrobotics.example.com>';
const OTHER = 'Northwind Robotics Careers <careers@hiring-partner.example.com>';
const statusOf = (res) => (typeof res === 'string' ? res : (res?.status ?? null));

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'inbox-outcome-'));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\npresets: []\n');
  writeFileSync(join(root, 'data', 'applications.md'), APPS);
  return { root, data: join(root, 'data'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function run(s, messages, classes) {
  const input = join(s.root, 'msgs.json');
  writeFileSync(input, JSON.stringify(messages));
  const calls = [];
  const lines = [];
  const runner = async (argv, opts) => (calls.push({ argv, cwd: opts.cwd }), { code: 0, stdout: '' });
  const classify = async (mail) => classes[mail.id] ?? 'unclear';
  const argv = ['--backend', 'connector', '--input', input, '--root', s.root, '--data-dir', s.data, '--today', TODAY, '--classify-outcomes'];
  const code = await main(argv, { runner, classify, assessmentDomains: ['assess.example.com'], out: (l) => lines.push(String(l)) });
  return { code, lines, statusCalls: calls.filter((c) => c.argv[0] === 'set-status.mjs') };
}

function proposed(lines) {
  const i = lines.findIndex((l) => /^##\s/.test(l) && /proposed status changes/i.test(l));
  if (i < 0) return [];
  const out = [];
  for (const l of lines.slice(i + 1)) {
    if (l.trim() === '') break;
    out.push(l);
  }
  return out;
}

// M-005-S4-osdr
test('M-005-S4-osdr a rejection mail from the tracked company domain sets Rejected with the prior status logged', async () => {
  const s = setup();
  try {
    const res = await run(s, [msg('o-401', OWN, 'Update on your application', REJECT_TEXT)], { 'o-401': 'rejection' });
    assert.equal(res.code, 0);
    assert.equal(res.statusCalls.length, 1, 'one set-status call');
    const argv = res.statusCalls[0].argv;
    assert.ok(argv.includes('Rejected'), argv.join(' '));
    assert.equal(res.statusCalls[0].cwd, s.root);
    assert.match([...res.lines, ...argv].join('\n'), /\bApplied\b/, 'the prior status Applied is logged');
    assert.ok(!proposed(res.lines).some((l) => l.includes('o-401')), 'an applied outcome is not also a proposal');
  } finally {
    s.cleanup();
  }
});

// M-005-S10-osdr
test('M-005-S10-osdr an outcome mail from a non-matching domain stays a proposal and changes no row', async () => {
  assert.equal(domainMatches(OWN, COMPANY), true);
  assert.equal(domainMatches(OTHER, COMPANY), false);
  const mail = msg('o-501', OTHER, 'Northwind Robotics: update on your application', REJECT_TEXT);
  const decided = await decideOutcome(mail, COMPANY, { t7On: false, classify: async () => 'rejection' });
  assert.ok(decided, 'a proposal is returned');
  assert.equal(Object.values(OUTCOMES).includes(statusOf(decided)), false, `no status: ${JSON.stringify(decided)}`);
  const s = setup();
  try {
    const res = await run(s, [mail], { 'o-501': 'rejection' });
    assert.equal(res.code, 0);
    assert.equal(res.statusCalls.length, 0, 'no row changes');
    assert.ok(proposed(res.lines).some((l) => l.includes('o-501')), `a proposal line names the mail:\n${res.lines.join('\n')}`);
  } finally {
    s.cleanup();
  }
});

// M-005-S13-osdr
test('M-005-S13-osdr with T7 off every outcome-candidate mail goes to the fake agent classifier and a row changes only when the agent class and the phrase rules and the sender domain agree', async () => {
  const mails = {
    agree: msg('o-1', OWN, 'Update on your application', REJECT_TEXT),
    agentDiffers: msg('o-2', OWN, 'Update on your application', REJECT_TEXT),
    phraseDiffers: msg('o-3', OWN, 'Update on your application', 'Thanks for applying. We received your application and the team will review it soon.'),
    domainDiffers: msg('o-4', OTHER, 'Northwind Robotics: update on your application', REJECT_TEXT),
  };
  const classes = { 'o-1': 'rejection', 'o-2': 'interview', 'o-3': 'rejection', 'o-4': 'rejection' };
  const seen = [];
  const classify = async (mail) => (seen.push(mail.id), classes[mail.id]);
  const results = {};
  for (const [name, mail] of Object.entries(mails)) results[name] = statusOf(await decideOutcome(mail, COMPANY, { t7On: false, classify }));
  assert.deepEqual([...seen].sort(), ['o-1', 'o-2', 'o-3', 'o-4'], 'every outcome-candidate mail reached the agent classifier');
  assert.equal(results.agree, 'Rejected');
  for (const name of ['agentDiffers', 'phraseDiffers', 'domainDiffers']) assert.equal(Object.values(OUTCOMES).includes(results[name]), false, `${name} changes no row: ${results[name]}`);
});
