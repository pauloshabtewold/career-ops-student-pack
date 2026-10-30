// Assumed interface of scripts/inbox.mjs (all synthetic data):
//   normalize(backend, payload) -> [{ id, from, subject, snippet, date }]
//     connector: payload is the parsed JSON array of { id, from, subject, snippet, date } (date ISO 8601)
//     paste: payload is text; messages are separated by a line holding only '---'; header lines 'Id:', 'From:',
//            'Subject:', 'Date:' (RFC 2822), a blank line, then the body, which becomes the snippet
//     date is normalized to a UTC ISO string with milliseconds
//   main(argv, deps) -> exit code. argv: --backend connector --input F | paste --file F | gmail-plugin,
//     plus --root R --data-dir D --today T [--dry-run] [--propose-only].
//     deps = { runner, assessmentDomains, out }
//       runner(argvAfterNode, { cwd }) -> { code, stdout }  (set-status.mjs and plugins.mjs calls go through it)
//       assessmentDomains: overrides the preset list; a sender on, or under, one of them is an assessment sender
//       out(line): receives every output line; defaults to console.log
//   Output lines are markdown: a '## Proposed status changes' section and a '## Suspicious' section, each holding
//   one '- <message id> ...' bullet per message and ended by a blank line; notices are lines starting 'notice: '.
//   Tracker companies come from data/applications.md; a sender belongs to a company when the sender domain,
//   or a parent of it, has a label equal to the company name (lowercase, letters and digits only).
//   Lookback 2 days from --today; ids already in data/.student-inbox-seen are skipped; classified ids are appended.
//   Alert mail (linkedin.com or joinhandshake.com sender): subject '<title> at <company>', the job id is the last
//   path segment of the job link in the snippet; the row goes to data/pipeline.staging.md as
//   '- [ ] needs-url | <company> | <title> | ...' and no linkedin.com text is stored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, normalize } from '../../scripts/inbox.mjs';
import { classifyMail } from '../../lib/mail-classify.mjs';

const TODAY = '2026-10-27';
const FRESH = '2026-10-26T15:00:00.000Z';
const OLD = '2026-10-22T15:00:00.000Z';
const APPS = [
  '# Applications',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |',
  '|---|---|---|---|---|---|---|---|---|',
  '| 1 | 2026-10-10 | Northwind Robotics | Data Intern | 4.2/5 | Applied | no | none | |',
  '| 2 | 2026-10-11 | Contoso Analytics | Analyst Intern | 4.0/5 | Applied | no | none | |',
  '| 3 | 2026-10-12 | Fabrikam Labs | Software Intern | 4.1/5 | Applied | no | none | |',
  '',
].join('\n');
const ASSESS = ['assess.example.com'];

function setup({ apps = APPS, seen = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'inbox-'));
  mkdirSync(join(root, 'data'));
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\npresets: []\n');
  writeFileSync(join(root, 'data', 'applications.md'), apps);
  if (seen.length) writeFileSync(join(root, 'data', '.student-inbox-seen'), `${seen.join('\n')}\n`);
  return { root, data: join(root, 'data'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const at = (user, domain) => `${user}@${domain}`;
const msg = (id, from, subject, snippet, date = FRESH) => ({ id, from, subject, snippet, date });

async function run(s, messages, { extra = [], backend = 'connector' } = {}) {
  const input = join(s.root, 'msgs.json');
  writeFileSync(input, JSON.stringify(messages));
  const calls = [];
  const lines = [];
  const runner = async (argv, opts) => {
    calls.push({ argv, cwd: opts.cwd });
    return { code: 0, stdout: '' };
  };
  const argv = ['--backend', backend, '--input', input, '--root', s.root, '--data-dir', s.data, '--today', TODAY, ...extra];
  const code = await main(argv, { runner, assessmentDomains: ASSESS, out: (l) => lines.push(String(l)) });
  const statusCalls = calls.filter((c) => c.argv[0] === 'set-status.mjs');
  return { code, calls, statusCalls, lines, text: lines.join('\n') };
}

// Lines of a '## <heading>' section, up to the next blank line.
function section(lines, re) {
  const i = lines.findIndex((l) => /^##\s/.test(l) && re.test(l));
  if (i < 0) return [];
  const out = [];
  for (const l of lines.slice(i + 1)) {
    if (l.trim() === '') break;
    out.push(l);
  }
  return out;
}

const REJECT = (id, from) => msg(id, from, 'Update on your application', 'Thank you for your time. We have decided to move forward with other candidates for this role.');

// M-008-S6
test('M-008-S6 a preset assessment sender gets set-status Assessment with an OA note', async () => {
  const s = setup();
  try {
    const m = msg('m-101', 'Assessments <no-reply@mail.assess.example.com>', 'Northwind Robotics: your online assessment', 'Please complete the coding assessment by 2026-11-02.');
    const res = await run(s, [m]);
    assert.equal(res.code, 0);
    assert.equal(res.statusCalls.length, 1);
    const argv = res.statusCalls[0].argv;
    assert.ok(argv.includes('Assessment'));
    const note = argv[argv.indexOf('--note') + 1];
    assert.match(note, /^OA \S.*, due 2026-11-02$/);
    assert.equal(res.statusCalls[0].cwd, s.root);
  } finally {
    s.cleanup();
  }
});

// M-008-S6
test('M-008-S6 a plain reply from a tracker company that asks nothing gets set-status Responded', async () => {
  const s = setup();
  try {
    const m = msg('m-102', 'Contoso Analytics Recruiting <recruiting@contosoanalytics.example.com>', 'Re: question about the Analyst Intern role', 'Thanks for your note. The team sits in Austin and works hybrid, and the role is paid.');
    const res = await run(s, [m]);
    assert.equal(res.statusCalls.length, 1);
    assert.ok(res.statusCalls[0].argv.includes('Responded'));
    assert.ok(!res.statusCalls[0].argv.includes('Assessment'));
  } finally {
    s.cleanup();
  }
});

// M-008-S6
test('M-008-S6 an automated confirmation from a tracker company is ignored', async () => {
  const s = setup();
  try {
    const m = msg('m-103', 'no-reply@mail.fabrikamlabs.example.com', 'We received your application', 'Thank you for applying. This is an automated confirmation; please do not reply.');
    const res = await run(s, [m]);
    assert.equal(res.code, 0);
    assert.equal(res.statusCalls.length, 0);
    const proposed = section(res.lines, /proposed status changes/i);
    assert.ok(!proposed.some((l) => l.includes('m-103')));
  } finally {
    s.cleanup();
  }
});

// M-008-S7
test('M-008-S7 rejection, interview and scheduling mail is proposed and never applied', async () => {
  const s = setup();
  try {
    const msgs = [
      REJECT('m-201', 'recruiting@northwindrobotics.example.com'),
      msg('m-202', 'talent@contosoanalytics.example.com', 'Next steps', 'We would like to invite you to interview with the hiring manager.'),
      msg('m-203', 'jobs@fabrikamlabs.example.com', 'Your availability', 'Please reply with a few times next week that suit you for a call.'),
    ];
    const res = await run(s, msgs);
    assert.equal(res.code, 0);
    assert.equal(res.statusCalls.length, 0, 'set-status is never called for proposals');
    const proposed = section(res.lines, /proposed status changes/i);
    for (const id of ['m-201', 'm-202', 'm-203']) assert.ok(proposed.some((l) => l.includes(id)), `${id} is listed as proposed`);
  } finally {
    s.cleanup();
  }
});

// M-008-S8
test('M-008-S8 mail asking for SSN, bank details, a password or a verify link is suspicious with no status change', async () => {
  const s = setup();
  try {
    const msgs = [
      msg('m-301', 'hr@northwindrobotics.example.com', 'Onboarding forms', 'To finish your offer, reply with your SSN and date of birth.'),
      msg('m-302', 'payroll@contosoanalytics.example.com', 'Payroll setup', 'Send your bank routing number and account number today.'),
      msg('m-303', 'it@fabrikamlabs.example.com', 'Account notice', 'Confirm your password to keep your candidate profile active.'),
      msg('m-304', 'noreply@fabrikamlabs.example.com', 'Action needed', 'Click the verify link to confirm your identity: https://verify.example.net/x'),
    ];
    const res = await run(s, msgs);
    assert.equal(res.statusCalls.length, 0);
    const suspicious = section(res.lines, /suspicious/i);
    for (const id of ['m-301', 'm-302', 'm-303', 'm-304']) assert.ok(suspicious.some((l) => l.includes(id)), `${id} is suspicious`);
  } finally {
    s.cleanup();
  }
});

// M-008-S8
test('M-008-S8 messages older than 2 days or already in the seen file are skipped; new ids are recorded', async () => {
  const s = setup({ seen: ['m-401'] });
  try {
    const msgs = [
      REJECT('m-401', 'recruiting@northwindrobotics.example.com'),
      { ...REJECT('m-402', 'recruiting@contosoanalytics.example.com'), date: OLD },
      REJECT('m-403', 'recruiting@fabrikamlabs.example.com'),
    ];
    const res = await run(s, msgs);
    const proposed = section(res.lines, /proposed status changes/i);
    assert.equal(proposed.length, 1);
    assert.ok(proposed[0].includes('m-403'));
    assert.ok(!res.text.includes('m-401') && !res.text.includes('m-402'));
    const seen = readFileSync(join(s.data, '.student-inbox-seen'), 'utf8').split('\n').filter(Boolean);
    assert.ok(seen.includes('m-401') && seen.includes('m-403'));
  } finally {
    s.cleanup();
  }
});

// M-008-S8
test('M-008-S8 --dry-run classifies but records no seen ids and calls no set-status', async () => {
  const s = setup();
  try {
    const m = msg('m-410', 'Assessments <no-reply@assess.example.com>', 'Fabrikam Labs online assessment', 'Finish the assessment by 2026-11-03.');
    const res = await run(s, [m], { extra: ['--dry-run'] });
    assert.equal(res.code, 0);
    assert.equal(res.statusCalls.length, 0);
    assert.equal(existsSync(join(s.data, '.student-inbox-seen')), false);
  } finally {
    s.cleanup();
  }
});

// M-008-S9
test('M-008-S9 LinkedIn and Handshake alerts become needs-url staging rows with company, title and job id', async () => {
  const s = setup();
  try {
    const msgs = [
      msg('m-501', `LinkedIn Job Alerts <${at("jobalerts-noreply", "linkedin.com")}>`, 'Data Engineer Intern at Tailspin Systems', 'Tailspin Systems is hiring. View job: https://www.linkedin.com/comm/jobs/view/3900001234?trk=alert'),
      msg('m-502', `Handshake <${at("no-reply", "joinhandshake.com")}>`, 'Analyst Intern at Wingtip Partners', 'New job match. View job: https://app.joinhandshake.com/jobs/8800123'),
    ];
    const res = await run(s, msgs);
    assert.equal(res.statusCalls.length, 0);
    const staging = readFileSync(join(s.data, 'pipeline.staging.md'), 'utf8');
    const rows = staging.split('\n').filter((l) => l.startsWith('- [ ] needs-url'));
    assert.equal(rows.length, 2);
    const li = rows.find((l) => l.includes('Tailspin Systems'));
    const hs = rows.find((l) => l.includes('Wingtip Partners'));
    assert.ok(li && li.includes('Data Engineer Intern') && li.includes('3900001234'));
    assert.ok(hs && hs.includes('Analyst Intern') && hs.includes('8800123'));
    assert.ok(!/linkedin\.com/i.test(staging), 'no linkedin.com text is stored');
  } finally {
    s.cleanup();
  }
});

// M-008-S10
test('M-008-S10 more than 5 qualifying notices emit at most 5 notice lines with no email content or links', async () => {
  const names = ['Northwind Robotics', 'Contoso Analytics', 'Fabrikam Labs', 'Tailspin Systems', 'Wingtip Partners', 'Litware Group', 'Proseware Works', 'Adatum Cloud'];
  const rows = names.map((n, i) => `| ${i + 1} | 2026-10-10 | ${n} | Intern | 4.0/5 | Applied | no | none | |`);
  const apps = ['# Applications', '', '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |', '|---|---|---|---|---|---|---|---|---|', ...rows, ''].join('\n');
  const s = setup({ apps });
  try {
    const msgs = names.map((n, i) => REJECT(`m-6${i}`, `recruiting@${n.toLowerCase().replace(/[^a-z0-9]/g, '')}.example.com`));
    const res = await run(s, msgs);
    const notices = res.lines.filter((l) => l.startsWith('notice: '));
    assert.ok(notices.length >= 1 && notices.length <= 5, `got ${notices.length} notice lines`);
    for (const n of notices) {
      assert.ok(!/https?:/i.test(n));
      assert.ok(!/move forward with other candidates/i.test(n));
    }
  } finally {
    s.cleanup();
  }
});

// M-008-S11
test('M-008-S11 paste and connector inputs normalize to identical message objects', () => {
  const expected = [
    { id: 'm-701', from: 'Contoso Analytics Recruiting <recruiting@contosoanalytics.example.com>', subject: 'Re: question about the role', snippet: 'Thanks for your note. The team works hybrid.', date: '2026-10-26T15:00:00.000Z' },
    { id: 'm-702', from: 'jobs@fabrikamlabs.example.com', subject: 'Your availability', snippet: 'Please send a few times.', date: '2026-10-26T18:30:00.000Z' },
  ];
  const connector = normalize('connector', expected.map((m) => ({ ...m, date: m.date.replace('.000Z', 'Z') })));
  const pasteText = [
    'Id: m-701',
    `From: ${expected[0].from}`,
    `Subject: ${expected[0].subject}`,
    'Date: Mon, 26 Oct 2026 15:00:00 +0000',
    '',
    expected[0].snippet,
    '---',
    'Id: m-702',
    `From: ${expected[1].from}`,
    `Subject: ${expected[1].subject}`,
    'Date: Mon, 26 Oct 2026 18:30:00 +0000',
    '',
    expected[1].snippet,
    '',
  ].join('\n');
  const paste = normalize('paste', pasteText);
  assert.deepEqual(connector, expected);
  assert.deepEqual(paste, connector);
});

// M-008-S11
test('M-008-S11 classifyMail keeps assessment, plain reply and proposal categories apart', () => {
  const ctx = { assessmentDomains: ASSESS, companies: [{ name: 'Northwind Robotics', domains: ['northwindrobotics.example.com'] }] };
  const a = classifyMail(msg('c-1', 'x@assess.example.com', 'Northwind Robotics assessment', 'Complete it by 2026-11-02.'), ctx);
  const b = classifyMail(msg('c-2', 'hr@northwindrobotics.example.com', 'Re: hello', 'The office is in Austin.'), ctx);
  const c = classifyMail(REJECT('c-3', 'hr@northwindrobotics.example.com'), ctx);
  assert.equal(new Set([JSON.stringify(a), JSON.stringify(b), JSON.stringify(c)]).size, 3);
});

// M-008-S11
test('M-008-S11 the gmail-plugin backend runs plugins.mjs run gmail and says replies need connector or paste', async () => {
  const s = setup();
  try {
    const calls = [];
    const lines = [];
    const runner = async (argv, opts) => {
      calls.push({ argv, cwd: opts.cwd });
      return { code: 0, stdout: '' };
    };
    const code = await main(['--backend', 'gmail-plugin', '--root', s.root, '--data-dir', s.data, '--today', TODAY], { runner, assessmentDomains: ASSESS, out: (l) => lines.push(String(l)) });
    assert.equal(code, 0);
    assert.deepEqual(calls.map((c) => c.argv), [['plugins.mjs', 'run', 'gmail']]);
    assert.equal(calls[0].cwd, s.root);
    const text = lines.join('\n');
    assert.match(text, /connector/);
    assert.match(text, /paste/);
  } finally {
    s.cleanup();
  }
});

async function runWithStatusCode(s, messages, statusCode) {
  const input = join(s.root, 'msgs.json');
  writeFileSync(input, JSON.stringify(messages));
  const lines = [];
  const runner = async (argv) => ({ code: argv[0] === 'set-status.mjs' ? statusCode : 0, stdout: '' });
  const argv = ['--backend', 'connector', '--input', input, '--root', s.root, '--data-dir', s.data, '--today', TODAY];
  const code = await main(argv, { runner, assessmentDomains: ASSESS, out: (l) => lines.push(String(l)) });
  return { code, lines };
}

const ASSESS_MSG = () => msg('m-201', 'Assessments <no-reply@mail.assess.example.com>', 'Northwind Robotics: your online assessment', 'Please complete the coding assessment by 2026-11-02.');
const REPLY_MSG = () => msg('m-202', 'Contoso Analytics Recruiting <recruiting@contosoanalytics.example.com>', 'Re: question about the Analyst Intern role', 'Thanks for your note. The team sits in Austin and works hybrid, and the role is paid.');

// M-002-S1
test('M-002-S1 a failed set-status for an assessment prints no marked notice and lists the failure', async () => {
  const s = setup();
  try {
    const res = await runWithStatusCode(s, [ASSESS_MSG()], 1);
    const notices = res.lines.filter((l) => l.startsWith('notice: '));
    assert.ok(!notices.some((l) => l.includes('marked')), notices.join('\n'));
    assert.ok(!res.lines.some((l) => l.includes('marked')));
    assert.ok(section(res.lines, /status updates applied/i).some((l) => l.includes('set-status failed (exit 1)')));
  } finally {
    s.cleanup();
  }
});

// M-002-S1
test('M-002-S1 a failed set-status for a reply prints no marked notice and lists the failure', async () => {
  const s = setup();
  try {
    const res = await runWithStatusCode(s, [REPLY_MSG()], 1);
    assert.ok(!res.lines.some((l) => l.startsWith('notice: ') && l.includes('marked')));
    assert.ok(section(res.lines, /status updates applied/i).some((l) => l.includes('set-status failed (exit 1)')));
  } finally {
    s.cleanup();
  }
});

// M-002-S2
test('M-002-S2 a successful set-status prints the marked status notice', async () => {
  const s = setup();
  try {
    const res = await runWithStatusCode(s, [ASSESS_MSG(), REPLY_MSG()], 0);
    assert.ok(res.lines.includes('notice: Northwind Robotics: marked Assessment'), res.lines.join('\n'));
    assert.ok(res.lines.includes('notice: Contoso Analytics: marked Responded'), res.lines.join('\n'));
  } finally {
    s.cleanup();
  }
});

// M-004-S7
test('M-004-S7 classifyMail returns ignore for a plain mail from a domain that is neither a tracker company nor an assessment domain', () => {
  const ctx = { assessmentDomains: ASSESS, companies: [{ name: 'Northwind Robotics', domains: ['northwindrobotics.example.com'] }] };
  const res = classifyMail(msg('c-7', 'x@example.org', 'Hello', 'Just saying hello, nothing else to add here.'), ctx);
  assert.equal(res.kind, 'ignore');
});

// M-004-S10
test('M-004-S10 classifyMail returns rejection for the REJECT fixture from a tracker company domain', () => {
  const ctx = { assessmentDomains: ASSESS, companies: [{ name: 'Northwind Robotics', domains: ['northwindrobotics.example.com'] }] };
  assert.equal(classifyMail(REJECT('r-1', 'hr@northwindrobotics.example.com'), ctx).kind, 'rejection');
});
