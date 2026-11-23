// SYNTHETIC FIXTURE: placeholder companies, example.com addresses and fake mail only.
// M-005 review fixes: M-1 the autopilot fills and submits approved items through chrome.mjs, whose budget.mjs check runs
// for real here (real budget.mjs and chrome.mjs children; no Chrome is running, so nothing is clicked) and never submits a
// link twice; M-2 outcome mail read in Chrome reaches inbox.mjs with its sender, --classify-outcomes when T7 is off, and
// inbox.mjs's counts in the digest; M-3 sender domains match on the registrable domain only; M-4 ambiguous outcome mail
// stays a proposal; M-5 missedSlots takes both call forms; the empty digest carries the estimate line; S-3 guided footers;
// S-4 rows and contacts already waiting are not prepared again; N-2, N-4, N-5, N-6, N-9.
// No browser, model, network, Gmail or launchctl is reached: every Chrome and model step is a fake or refuses first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { listBatches, readBatch, updateBatch, writeBatches } from '../../lib/batch-file.mjs';
import { summaryLines } from '../../lib/digest.mjs';
import { domainMatches } from '../../lib/outcome-rules.mjs';
import { cleanLessons } from '../../lib/outreach-lessons.mjs';
import { resolvePaths } from '../../lib/paths.mjs';
import { lastSuccess, missedSlots, readRuns, recordRun } from '../../lib/run-ledger.mjs';
import { requirementPhrases } from '../../lib/skill-gap.mjs';
import { appendTsv, readTsv } from '../../lib/tsv.mjs';
import { autopilot } from '../../scripts/autopilot.mjs';
import { agentClassifier, main as inboxMain } from '../../scripts/inbox.mjs';
import { pauseCommand } from '../../scripts/schedule.mjs';
import { MISSED_FILE, scheduledRun } from '../../scripts/scheduled.mjs';
import { LOG_HEADER, row, shiftDate } from '../helpers/budget-harness.mjs';
import { makeRoot, PACK_ROOT, TODAY, jobUrl, line, pipelineText } from '../helpers/script-harness.mjs';

const YESTERDAY = '2026-10-26';
const BASE = 'daily_target: 5\nscore_floor: 3.0\n';
const OWN = 'Northwind Robotics Recruiting <recruiting@northwindrobotics.example.com>';
const scriptOf = (args) => basename(String(args?.[0] ?? ''));
const digestOf = (r) => (r.exists(`data/digest/student-${TODAY}.md`) ? r.read(`data/digest/student-${TODAY}.md`) : '');
const logRows = async (r) => (existsSync(join(r.data, 'action-log.tsv')) ? (await readTsv(join(r.data, 'action-log.tsv'))).rows : []);

// An apply batch from yesterday whose items carry fill plans with one read form field each; every item approved.
async function approvedWithPlans(r, links, { date = YESTERDAY } = {}) {
  const items = links.map((link, i) => ({ company: `Fake Co ${i + 1}`, role: `Analyst ${i + 1}`, score: 4.5, preview: 'Fake letter preview.', link }));
  const [id] = writeBatches(r.data, { date, kind: 'apply', items });
  updateBatch(r.data, id, (b) => ({
    ...b,
    items: b.items.map((it, k) => {
      const file = join(r.data, 'fill-plans', id, `${k + 1}.json`);
      mkdirSync(join(r.data, 'fill-plans', id), { recursive: true });
      writeFileSync(file, `${JSON.stringify({ company: it.company, role: it.role, url: it.link, link: it.link, score: 4.5, batchId: id, item: k + 1, fields: [{ selector: '#first_name', key: 'first_name', label: 'First name', type: 'text', value: 'Test' }], unknown: [], uploads: [] })}\n`);
      return { ...it, plan: file };
    }),
  }));
  await appendTsv(join(r.data, 'action-log.tsv'), LOG_HEADER, [row({ ts: `${date}T20:00:00.000Z`, action: 'batch.approve', approval: 'approve all', detail: `batch=${id};items=${links.map((_, i) => i + 1).join(',')}` })]);
  return id;
}

// A fake chrome.mjs fill: records a filled text field in the plan's tab like the real fill, and prints its count.
function fakeFill(args, n = 1) {
  const file = args[args.indexOf('--plan') + 1];
  const plan = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, `${JSON.stringify({ ...plan, tab: { targetId: 't1', url: plan.url, sentinel: { selector: '#first_name', value: 'Test' } } })}\n`);
  return `chrome: filled ${n} field(s) on example.com`;
}

async function runPilot(r, runner, deps = {}) {
  const out = [];
  const res = await autopilot({ paths: resolvePaths({ root: r.root, dataDir: r.data }), today: TODAY, deps: { runner, chromeOpen: () => true, chromeState: async () => null, out: (l) => out.push(String(l)), ...deps } });
  return { res, out, digest: digestOf(r) };
}

test('M-1 approved items are filled, then submitted through chrome.mjs, whose real budget.mjs check passes the plan score', async () => {
  const r = makeRoot({ config: `${BASE}chrome_in_schedule: yes\n` });
  try {
    const id = await approvedWithPlans(r, [jobUrl(1), jobUrl(2)]);
    const calls = [];
    const runner = (cmd, args, opts) => {
      const s = scriptOf(args);
      calls.push(`${s} ${args[1]}`);
      if (s === 'chrome.mjs' && args[1] === 'fill') return fakeFill(args, 3);
      // chrome.mjs submit runs for real: it reads the plan, runs the real budget.mjs check, then finds no Chrome running.
      if (s === 'chrome.mjs' || s === 'budget.mjs') return execFileSync(cmd, args, { ...opts, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (s === 'rank-queue.mjs') return '[]';
      return '';
    };
    const { res } = await runPilot(r, runner);
    assert.deepEqual(calls.filter((c) => c.startsWith('chrome.mjs')), ['chrome.mjs fill', 'chrome.mjs submit', 'chrome.mjs fill', 'chrome.mjs submit'], 'fill then submit for each approved item');
    assert.ok(!calls.some((c) => c.startsWith('budget.mjs')), 'no budget pre-check of its own: chrome.mjs submit runs the scored check');
    const notes = res.lines.filter((l) => /^submit approved: item/.test(l));
    assert.equal(notes.length, 2, res.lines.join('\n'));
    for (const n of notes) assert.match(n, /automation Chrome is not running/, 'the budget check passed and only the missing Chrome stopped the click');
    assert.ok(notes.every((n) => n.includes(id)));
    const refusals = (await logRows(r)).filter((x) => x.action === 'budget.refusal');
    assert.deepEqual(refusals, [], 'budget.mjs logged no refusal');
  } finally {
    r.cleanup();
  }
});

test('M-1 a link already submitted from another approved page is not submitted again', async () => {
  const r = makeRoot({ config: `${BASE}chrome_in_schedule: yes\n` });
  try {
    const first = await approvedWithPlans(r, [jobUrl(1)]);
    await appendTsv(join(r.data, 'action-log.tsv'), LOG_HEADER, [row({ ts: `${YESTERDAY}T21:00:00.000Z`, action: 'apply.submit', target: jobUrl(1), company: 'Fake Co 1', detail: `batch=${first};item=1` })]);
    const second = await approvedWithPlans(r, [`${jobUrl(1)}/`, jobUrl(2), jobUrl(2)]);
    const calls = [];
    const runner = (cmd, args) => {
      calls.push(args);
      if (scriptOf(args) === 'chrome.mjs' && args[1] === 'fill') return fakeFill(args);
      return scriptOf(args) === 'rank-queue.mjs' ? '[]' : '';
    };
    const { res } = await runPilot(r, runner);
    const submits = calls.filter((a) => scriptOf(a) === 'chrome.mjs' && a[1] === 'submit').map((a) => `${a[a.indexOf('--batch-id') + 1]}#${a[a.indexOf('--item') + 1]}`);
    assert.deepEqual(submits, [`${second}#2`], 'the same posting goes out once');
    assert.equal(res.lines.filter((l) => /was already submitted/.test(l)).length, 2, res.lines.join('\n'));
  } finally {
    r.cleanup();
  }
});

test('M-2 outcome mail read in Chrome reaches inbox.mjs with its sender and --classify-outcomes with T7 off and on', async () => {
  for (const t7On of [false, true]) {
    const r = makeRoot({ config: `${BASE}chrome_in_schedule: yes\n` });
    try {
      const inboxCalls = [];
      const runner = (cmd, args) => {
        const s = scriptOf(args);
        if (s === 'inbox.mjs') {
          inboxCalls.push(args);
          return '## Status updates applied\n- id-abc Northwind Robotics: Rejected (was Applied)\n\ninbox: 2 read, 1 proposal(s), 1 set\n';
        }
        return s === 'rank-queue.mjs' ? '[]' : '';
      };
      const mails = [
        { id: 'id-abc', from: 'recruiting@northwindrobotics.example.com', subject: 'Northwind Robotics, Update on your application', snippet: 'We regret to inform you that we decided to move forward with other candidates.' },
        { id: 'h-0123456789abcdef', from: '', subject: 'Contoso Analytics, interview invitation', snippet: 'Contoso Analytics, interview invitation' },
      ];
      const { res } = await runPilot(r, runner, { chromeState: async () => ({ port: 9 }), readOutcomeMail: async () => ({ mails }), t7On });
      assert.equal(inboxCalls.length, 1);
      assert.ok(inboxCalls[0].includes('--classify-outcomes'), `T7 ${t7On ? 'on' : 'off'}: decideOutcome orders rules and agent by T7`);
      const input = JSON.parse(readFileSync(inboxCalls[0][inboxCalls[0].indexOf('--input') + 1], 'utf8'));
      assert.deepEqual(input.map((m) => [m.id, m.from]), mails.map((m) => [m.id, m.from]), 'real ids and senders reach inbox.mjs');
      assert.ok(res.lines.includes('outcome mail: 2 read, 1 proposal(s), 1 set'), res.lines.join('\n'));
    } finally {
      r.cleanup();
    }
  }
});

// A tracker and one inbox.mjs run with injected runner and classifier; returns the set-status calls and printed lines.
async function inboxRun(apps, msgs, { classes = null, extra = [] } = {}) {
  const r = makeRoot({ config: 'presets: []\n' });
  try {
    r.write('data/applications.md', ['# Applications', '', '| # | Date | Company | Role | Score | Status | PDF | Report | Notes |', '|---|---|---|---|---|---|---|---|---|', ...apps, ''].join('\n'));
    r.write('data/m.json', JSON.stringify(msgs));
    const calls = [];
    const lines = [];
    await inboxMain(['--backend', 'connector', '--input', r.file('data/m.json'), '--root', r.root, '--data-dir', r.data, '--today', TODAY, ...extra], {
      runner: async (a) => (calls.push(a.join(' ')), { code: 0, stdout: '' }),
      t7On: false,
      ...(classes ? { classify: async (m) => classes[m.id] } : {}),
      out: (l) => lines.push(String(l)),
    });
    return { setStatus: calls.filter((c) => c.startsWith('set-status')), lines };
  } finally {
    r.cleanup();
  }
}

const D2 = '2026-10-26T15:00:00.000Z';
const D3 = '2026-10-27T05:00:00.000Z';
const REGRET = 'We regret to inform you that we decided to move forward with other candidates.';

test('M-2 a Chrome-read rejection from the tracked domain reaches set-status; a row with no sender is a proposal, never silence', async () => {
  const apps = ['| 1 | 2026-10-10 | Northwind Robotics | Data Intern | 4.2/5 | Applied | no | none | |'];
  const own = await inboxRun(apps, [{ id: 'id-1', from: OWN, subject: 'Update on your application', snippet: REGRET, date: D2 }], { classes: { 'id-1': 'rejection' } });
  assert.deepEqual(own.setStatus, ['set-status.mjs 1 Rejected --note prior status Applied; from mail id-1']);
  assert.ok(own.lines.includes('inbox: 1 read, 0 proposal(s), 1 set'), own.lines.join('\n'));
  const text = `Northwind Robotics Recruiting, Update on your application - ${REGRET}`;
  const bare = await inboxRun(apps, [{ id: 'h-1', from: '', subject: text, snippet: text, date: D2 }]);
  assert.deepEqual(bare.setStatus, []);
  assert.ok(bare.lines.some((l) => /^- h-1 Northwind Robotics: /.test(l)), `a proposal line:\n${bare.lines.join('\n')}`);
});

test('M-4 more than one open row with no single role named stays a proposal; a named role picks its row', async () => {
  const apps = ['| 1 | 2026-10-01 | Northwind Robotics | Data Intern | 4.2/5 | Applied | no | none | |', '| 2 | 2026-10-10 | Northwind Robotics | ML Intern | 4.0/5 | Applied | no | none | |'];
  const vague = await inboxRun(apps, [{ id: 'm1', from: OWN, subject: 'Your application', snippet: REGRET, date: D2 }], { classes: { m1: 'rejection' } });
  assert.deepEqual(vague.setStatus, []);
  assert.ok(vague.lines.some((l) => /m1 Northwind Robotics: more than one open application/.test(l)), vague.lines.join('\n'));
  const named = await inboxRun(apps, [{ id: 'm2', from: OWN, subject: 'Your Data Intern application', snippet: REGRET, date: D2 }], { classes: { m2: 'rejection' } });
  assert.deepEqual(named.setStatus, ['set-status.mjs 1 Rejected --note prior status Applied; from mail m2']);
});

test('M-4 same-company same-day conflicting outcome mail stays a proposal; a row past the target is held', async () => {
  const apps = ['| 1 | 2026-10-10 | Northwind Robotics | Data Intern | 4.2/5 | Applied | no | none | |'];
  const msgs = [
    { id: 'a1', from: OWN, subject: 'Interview invitation', snippet: 'We would like to invite you to an interview next week.', date: D2 },
    { id: 'a2', from: OWN, subject: 'Application update', snippet: 'We regret to inform you that the position has been filled.', date: D2 },
  ];
  const conflict = await inboxRun(apps, msgs, { classes: { a1: 'interview', a2: 'rejection' } });
  assert.deepEqual(conflict.setStatus, [], 'neither mail is applied');
  assert.equal(conflict.lines.filter((l) => /conflicting outcome mail/.test(l)).length, 2, conflict.lines.join('\n'));
  const offer = ['| 1 | 2026-10-10 | Northwind Robotics | Data Intern | 4.2/5 | Offer | no | none | |'];
  const held = await inboxRun(offer, [{ id: 'b1', from: OWN, subject: 'Application update', snippet: REGRET, date: D2 }], { classes: { b1: 'rejection' } });
  assert.deepEqual(held.setStatus, [], 'an Offer row is never moved back to Rejected');
  assert.ok(held.lines.some((l) => /b1 Northwind Robotics: status is already past this step/.test(l)), held.lines.join('\n'));
});

test('M-4 the prior status is read again after each applied change', async () => {
  const apps = ['| 1 | 2026-10-10 | Northwind Robotics | Data Intern | 4.2/5 | Applied | no | none | |'];
  const msgs = [
    { id: 'c1', from: OWN, subject: 'Interview invitation', snippet: 'We would like to invite you to an interview next week.', date: D2 },
    { id: 'c2', from: OWN, subject: 'Application update', snippet: REGRET, date: D3 },
  ];
  const out = await inboxRun(apps, msgs, { classes: { c1: 'interview', c2: 'rejection' } });
  assert.deepEqual(out.setStatus, ['set-status.mjs 1 Interview --note prior status Applied; from mail c1', 'set-status.mjs 1 Rejected --note prior status Interview; from mail c2']);
});

// Sender shapes on relay and lookalike hosts are joined at run time: they are synthetic header shapes, no person's
// address, and the reserved example domains cannot show an ATS relay or a two-part public suffix.
const addr = (local, host) => [local, host].join('@');

test('M-3 domainMatches takes the registrable domain only and refuses relays, lookalikes and malformed senders', () => {
  const refused = [addr('hr', 'northwind.evil.example.com'), addr('hr', 'northwind.com.evil.example.net'), addr('hr', 'northwind.greenhouse.io'), `${addr('hr', 'evil.example.com')} <northwind.com>`, 'Northwind <northwind.com>', 'northwind.com'];
  for (const from of refused) assert.equal(domainMatches(from, 'Northwind'), false, from);
  assert.equal(domainMatches(addr('hr', 'met.example.org'), 'Met'), false, 'names under 4 characters never match on a label');
  assert.equal(domainMatches('recruiting@northwindrobotics.example.com', 'Northwind Robotics'), true);
  assert.equal(domainMatches(OWN, 'Northwind Robotics'), true);
  assert.equal(domainMatches(addr('hr', 'northwind.com'), 'Northwind'), true);
  assert.equal(domainMatches(addr('hr', 'careers.northwind.co.uk'), 'Northwind'), true, 'two-part suffix');
  assert.equal(domainMatches(addr('hr', 'mail.ibm.com'), { name: 'IBM', domains: ['ibm.com'] }), true, 'a subdomain of a listed domain');
  assert.equal(domainMatches(addr('hr', 'ibm.com'), 'IBM'), false, 'a short name needs a listed domain');
  assert.equal(domainMatches(addr('hr', 'northwind.greenhouse.io'), { name: 'Northwind', domains: ['greenhouse.io'] }), false, 'a relay never matches');
});

test('M-5 missedSlots takes the object and the positional form, string inputs and a local YYYY-MM-DD last success', () => {
  const tz = 'America/Chicago';
  const obj = missedSlots({ lastSuccess: '2026-02-26T18:00:00.000Z', now: new Date('2026-03-02T18:00:00.000Z'), tz });
  assert.deepEqual(obj, { dates: ['2026-02-27', '2026-02-28', '2026-03-01'], count: 0 });
  assert.deepEqual(missedSlots('2026-02-26T18:00:00.000Z', '2026-03-02T18:00:00.000Z', tz), obj, 'positional form with an ISO string now');
  assert.deepEqual(missedSlots('2026-02-26', '2026-03-02T18:00:00.000Z', tz), obj, 'a date-only last success is that local date');
  assert.deepEqual(missedSlots('2028-02-27', new Date('2028-03-01T18:00:00.000Z'), tz).dates, ['2028-02-28', '2028-02-29'], 'leap year');
  const forty = missedSlots('2026-09-01', '2026-10-11T18:00:00.000Z', tz);
  assert.equal(forty.dates.length, 7);
  assert.equal(forty.count, 39 - 7, 'count stays the dates beyond the 7 listed');
  assert.deepEqual(missedSlots(null, new Date(), tz), { dates: [], count: 0 });
  assert.deepEqual(missedSlots({ lastSuccess: '2026-10-24', now: '2026-10-27T20:00:00.000Z', tz, skip: ['2026-10-25'] }).dates, ['2026-10-26'], 'paused days are skipped');
});

test('the empty digest template carries one estimated-tokens line labelled as an estimate', () => {
  const lines = summaryLines({}).filter((l) => /estimate/i.test(l) && /\d[\d,.]*\s*k?\s*tokens/i.test(l));
  assert.equal(lines.length, 1, summaryLines({}).join('\n'));
  assert.equal(summaryLines({ estimate: { tokens: 12345, agent: 'claude' } }).filter((l) => /an estimate/.test(l)).length, 1);
});

function pilotRoot(config) {
  const r = makeRoot({ config: `${BASE}${config}` });
  const names = ['Northwind Robotics', 'Contoso Analytics', 'Fabrikam Labs', 'Tailspin Data'];
  r.write('data/pipeline.md', pipelineText({ pending: names.map((c, i) => line(jobUrl(i + 1), c, `Data Analyst Intern ${i + 1}`, 'Remote', `triage=${(4.8 - i * 0.1).toFixed(1)}`)) }));
  return r;
}

function rankingRunner() {
  const calls = [];
  const runner = (cmd, args = [], opts = {}) => {
    calls.push([...args]);
    if (scriptOf(args) === 'rank-queue.mjs') return execFileSync(process.execPath, args, { cwd: opts.cwd ?? PACK_ROOT, encoding: 'utf8' });
    return '';
  };
  return { runner, calls };
}

test('S-3 with chrome_in_schedule no the autopilot section ends with Next, Type and Why offering to submit in a session', async () => {
  const r = pilotRoot('chrome_in_schedule: no\n');
  try {
    await approvedWithPlans(r, [jobUrl(7), jobUrl(8)]);
    const { runner } = rankingRunner();
    const { digest, res } = await runPilot(r, runner, { chromeOpen: () => false });
    const tail = digest.trimEnd().split('\n').slice(-5);
    assert.match(tail[0], /^Next: submit the 2 approved application\(s\) in a session$/);
    assert.equal(tail[1], 'Type: submit all');
    assert.match(tail[2], /^Why: .*I can submit them in a session, approve\?$/);
    assert.deepEqual(res.footer.slice(0, 3), tail.slice(0, 3));
    const closed = pilotRoot('chrome_in_schedule: yes\n');
    try {
      await approvedWithPlans(closed, [jobUrl(7)]);
      const out = await runPilot(closed, rankingRunner().runner, { chromeOpen: () => false });
      assert.ok(out.digest.includes('Next: open the automation Chrome'), out.digest);
    } finally {
      closed.cleanup();
    }
  } finally {
    r.cleanup();
  }
});

test('S-3 pause and resume print Next, Type and Why; resume with nothing installed says so and points to install', () => {
  const r = makeRoot();
  try {
    const said = [];
    pauseCommand('pause', r.data, { say: (l) => said.push(l) });
    assert.deepEqual(said.slice(1, 4).map((l) => l.split(':')[0]), ['Next', 'Type', 'Why']);
    assert.equal(said[2], 'Type: resume my schedule');
    said.length = 0;
    pauseCommand('resume', r.data, { installed: () => false, say: (l) => said.push(l) });
    assert.match(said[0], /no schedule is installed/);
    assert.ok(said.some((l) => /schedule\.mjs install/.test(l)), said.join('\n'));
    said.length = 0;
    pauseCommand('resume', r.data, { installed: () => true, say: (l) => said.push(l) });
    assert.match(said[0], /schedule resumed/);
    assert.deepEqual(said.slice(1, 4).map((l) => l.split(':')[0]), ['Next', 'Type', 'Why']);
  } finally {
    r.cleanup();
  }
});

test('S-4 ranked rows already on a waiting apply page are skipped and named; fill-plan gets --fields-dir; drafts skip waiting items', async () => {
  const r = pilotRoot('chrome_in_schedule: no\n');
  try {
    writeBatches(r.data, { date: YESTERDAY, kind: 'apply', items: [{ company: 'Northwind Robotics', role: 'Data Analyst Intern 1', score: 4.8, preview: 'p', link: jobUrl(1) }] });
    const { runner, calls } = rankingRunner();
    const { res } = await runPilot(r, runner, { chromeOpen: () => false });
    const fill = calls.find((a) => scriptOf(a) === 'fill-plan.mjs');
    assert.ok(fill.includes('--fields-dir') && fill[fill.indexOf('--fields-dir') + 1] === join(r.data, 'form-fields'), fill.join(' '));
    const ranked = JSON.parse(readFileSync(fill[fill.indexOf('--rows') + 1], 'utf8'));
    assert.ok(!ranked.some((x) => x.url === jobUrl(1)), 'the waiting row is not prepared again');
    assert.ok(ranked.length >= 1);
    assert.ok(res.lines.some((l) => /^rank: .*1 already waiting for your approval/.test(l)), res.lines.join('\n'));
    const drafts = calls.find((a) => scriptOf(a) === 'outreach-drafts.mjs');
    assert.ok(drafts.includes('--skip-waiting'));
    assert.equal(drafts[drafts.indexOf('--source') + 1], 'scheduled', 'N-7 scheduled drafts write scheduled ledger rows');
  } finally {
    r.cleanup();
  }
});

test('N-2 and N-9 the missed-runs file is gone after the daily step, paused days are not missed, a fully failed run is not a success', async () => {
  const r = makeRoot({ config: 'automation: scheduled-discovery\n' });
  try {
    const fail = () => {
      throw Object.assign(new Error('child failed'), { status: 1, stderr: 'fake failure' });
    };
    await scheduledRun({ root: r.root, packRoot: PACK_ROOT, passThrough: [], dataDir: r.data, today: TODAY, runner: fail, out: () => {} });
    const runs = await readRuns(r.data);
    assert.equal(runs.at(-1).status, 'failed');
    assert.equal(lastSuccess(runs, 'daily'), null, 'a run whose every step failed is not a success');
    // scheduledRun reads the real clock, so the ledger dates are set from today's local date.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const [okDay, pausedDay, missedDay] = [-4, -3, -2].map((n) => shiftDate(today, n));
    await recordRun(r.data, { start: `${okDay}T18:00:00.000Z`, end: `${okDay}T18:05:00.000Z`, kind: 'daily', status: 'ok' });
    await recordRun(r.data, { start: `${pausedDay}T18:00:00.000Z`, end: `${pausedDay}T18:00:00.000Z`, kind: 'daily', status: 'paused' });
    let seen = null;
    const runner = (cmd, args) => {
      if (scriptOf(args) === 'daily.mjs') seen = existsSync(join(r.data, MISSED_FILE)) ? readFileSync(join(r.data, MISSED_FILE), 'utf8') : '';
      return '';
    };
    await scheduledRun({ root: r.root, packRoot: PACK_ROOT, passThrough: [], dataDir: r.data, today: TODAY, runner, out: () => {} });
    assert.ok(seen.includes(missedDay), seen);
    assert.ok(!seen.includes(pausedDay), `a paused day is not a missed run: ${seen}`);
    assert.equal(existsSync(join(r.data, MISSED_FILE)), false, 'removed once the daily step has read it');
    await pauseCommand('pause', r.data, { say: () => {} });
    await scheduledRun({ root: r.root, packRoot: PACK_ROOT, passThrough: [], dataDir: r.data, today: TODAY, runner, out: () => {} });
    assert.equal((await readRuns(r.data)).at(-1).status, 'paused', 'a paused start is recorded as paused');
  } finally {
    r.cleanup();
  }
});

test('N-4 R and Epic count only in a skill context', () => {
  assert.deepEqual(requirementPhrases('Join our R&D team for an epic summer.').filter((p) => p === 'r' || p === 'epic'), []);
  assert.ok(requirementPhrases('Skills: Python, R, SQL.').includes('r'));
  assert.ok(requirementPhrases('Experience with R programming preferred.').includes('r'));
  assert.ok(requirementPhrases('Training on Epic Systems is provided.').includes('epic'));
});

test('N-5 a lesson line with a digit, an address, a link or a contact name or company is dropped', () => {
  const text = ['- Open with one question about their work.', '- Mention 3 projects.', '- Write to jo@example.com first.', '- See https://example.com for tone.', '- Alice Alpha liked short notes.', '- Acme Example replies on Mondays.', '- Keep the note short.'].join('\n');
  assert.deepEqual(cleanLessons(text, { names: ['Alice Alpha', 'Acme Example'] }), ['- Open with one question about their work.', '- Keep the note short.']);
});

const classifierReply = (text) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 300, output_tokens: 2 } });

test('N-6 the classifier takes only a one-word answer and starts no call past the deadline', async () => {
  const r = makeRoot();
  try {
    let calls = 0;
    const make = (answer, deadline = Infinity) => agentClassifier({ agentPath: '/fake/claude', dataDir: r.data, today: TODAY, deadline, runner: () => (calls++, classifierReply(answer)) });
    const mail = { subject: 'Update', from: OWN, snippet: REGRET };
    assert.equal(await make('rejection')(mail), 'rejection');
    assert.equal(await make('Offer.')(mail), 'offer');
    assert.equal(await make('not an offer; rejection')(mail), 'unclear');
    const before = calls;
    assert.equal(await make('rejection', Date.now() - 1)(mail), null, 'past the deadline the mail stays a proposal');
    assert.equal(calls, before, 'no call starts past the deadline');
  } finally {
    r.cleanup();
  }
});

test('the autopilot never approves and writes no batch for rows it skipped', async () => {
  const r = pilotRoot('chrome_in_schedule: no\n');
  try {
    const { runner } = rankingRunner();
    await runPilot(r, runner, { chromeOpen: () => false });
    assert.deepEqual((await logRows(r)).filter((x) => x.action === 'batch.approve'), []);
    for (const id of listBatches(r.data)) assert.equal(readBatch(r.data, id).approved, null);
  } finally {
    r.cleanup();
  }
});
