// Assumed (M-005): scripts/autopilot.mjs exports autopilot({ paths, today, deps }) and approvedUnsent(dataDir).
//   paths = resolvePaths({ root, dataDir }); config/student.yml is read from paths.root.
//   deps.runner(cmd, args, opts) runs every pack script child (rank-queue, fill-plan, cover, outreach-drafts, budget,
//     chrome) as runner(process.execPath, [script, ...args], opts); it returns stdout or throws { status, stderr }.
//   deps.chromeOpen() -> true when the automation Chrome is running; deps.out(line) receives progress lines.
//   Submits go only through `chrome.mjs submit --batch-id <id> --item <n>`. Batches are written with lib/batch-file.mjs
//   under data/batches. autopilot appends its digest lines to data/digest/student-<today>.md, one line per failed step,
//   and never rejects. Approvals live in data/action-log.tsv as batch.approve rows (detail batch=<id>;items=1,2) and a
//   spent item as an apply.submit row (detail batch=<id>;item=<n>).
// The fake runner runs the read-only rank-queue.mjs for real and answers every other child itself: budget.mjs check
// passes only for approved, unspent items, like the real one. No browser, model or network is reached. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { existsSync } from 'node:fs';
import { PAGE_MAX, listBatches, readBatch, writeBatches } from '../../lib/batch-file.mjs';
import { resolvePaths } from '../../lib/paths.mjs';
import { appendTsv, readTsv } from '../../lib/tsv.mjs';
import { approvedUnsent, autopilot } from '../../scripts/autopilot.mjs';
import { scheduledRun } from '../../scripts/scheduled.mjs';
import { LOG_HEADER, row } from '../helpers/budget-harness.mjs';
import { makeRoot, PACK_ROOT, TODAY, jobUrl, line, pipelineText } from '../helpers/script-harness.mjs';

const YESTERDAY = '2026-10-26';
const BASE = 'daily_target: 5\nscore_floor: 3.0\n';
const COMPANIES = ['Northwind Robotics', 'Contoso Analytics', 'Fabrikam Labs', 'Tailspin Data', 'Woodgrove Systems', 'Litware Health', 'Adatum Energy', 'Proseware Media', 'Lucerne Mapping', 'Wingtip Partners', 'Alpine Ski Tech', 'Blue Yonder Freight'];
const digestFile = `data/digest/student-${TODAY}.md`;
const scriptOf = (args) => basename(String(args?.[0] ?? ''));
const flag = (args, f) => (args.includes(f) ? String(args[args.indexOf(f) + 1]) : null);

function makePilotRoot(config) {
  const r = makeRoot({ config: `${BASE}${config}` });
  const pending = COMPANIES.map((c, i) => line(jobUrl(i + 1), c, `Data Analyst Intern ${i + 1}`, 'Remote', `triage=${(4.8 - i * 0.1).toFixed(1)}`));
  r.write('data/pipeline.md', pipelineText({ pending }));
  return r;
}

// An apply batch from yesterday with two items, both approved; spent lists the items already submitted.
async function approvedBatch(r, { spent = [] } = {}) {
  const items = [1, 2].map((n) => ({ company: COMPANIES[n - 1], role: `Data Analyst Intern ${n}`, score: 4.5, preview: 'Fake letter preview.', link: jobUrl(n) }));
  const [id] = writeBatches(r.data, { date: YESTERDAY, kind: 'apply', items });
  const rows = [row({ ts: `${YESTERDAY}T20:00:00.000Z`, action: 'batch.approve', approval: 'approve all', detail: `batch=${id};items=1,2` })];
  for (const n of spent) rows.push(row({ ts: `${YESTERDAY}T21:00:00.000Z`, action: 'apply.submit', target: `ex-${n}`, company: COMPANIES[n - 1], detail: `batch=${id};item=${n}` }));
  await appendTsv(join(r.data, 'action-log.tsv'), LOG_HEADER, rows);
  return { id, approved: new Set([1, 2].map((n) => `${id}#${n}`)), used: new Set(spent.map((n) => `${id}#${n}`)) };
}

function fakeRunner({ approved = new Set(), used = new Set(), fail = () => false } = {}) {
  const calls = [];
  const runner = (cmd, args = [], opts = {}) => {
    calls.push({ cmd, args: [...args], opts });
    const script = scriptOf(args);
    if (fail(script, args)) throw Object.assign(new Error(`${script} failed`), { status: 1, stderr: 'fake failure' });
    if (script === 'budget.mjs' && args.includes('check')) {
      const key = `${flag(args, '--batch-id')}#${flag(args, '--item')}`;
      if (!approved.has(key) || used.has(key)) throw Object.assign(new Error('refused'), { status: 3, stderr: 'no unused logged approval' });
      return '';
    }
    if (script === 'rank-queue.mjs') return execFileSync(process.execPath, args, { cwd: opts.cwd ?? PACK_ROOT, encoding: 'utf8' });
    return '';
  };
  return { runner, calls };
}

async function runPilot(r, runnerOpts = {}, { chromeOpen = true } = {}) {
  const { runner, calls } = fakeRunner(runnerOpts);
  const lines = [];
  await autopilot({ paths: resolvePaths({ root: r.root, dataDir: r.data }), today: TODAY, deps: { runner, chromeOpen: () => chromeOpen, out: (l) => lines.push(String(l)) } });
  const digest = r.exists(digestFile) ? r.read(digestFile) : '';
  return { calls, lines, digest };
}

const submits = (calls) => calls.filter((c) => c.args.some((a) => /chrome\.mjs$/.test(String(a))) && c.args.includes('submit'));
const logRows = async (r) => (existsSync(join(r.data, 'action-log.tsv')) ? (await readTsv(join(r.data, 'action-log.tsv'))).rows : []);

// M-005-S3-osdr
test('M-005-S3-osdr autopilot writes one-page apply and outreach batches with zero submits before approval', async () => {
  const r = makePilotRoot('chrome_in_schedule: yes\n');
  try {
    const { calls } = await runPilot(r);
    const batches = listBatches(r.data).map((id) => readBatch(r.data, id));
    const apply = batches.filter((b) => b.kind === 'apply' && b.date === TODAY);
    assert.ok(apply.length >= 1, `an apply batch for today: ${listBatches(r.data).join(', ')}`);
    for (const b of batches) assert.ok(b.items.length <= PAGE_MAX, `${b.id} fits one page`);
    const outreachRan = batches.some((b) => b.kind === 'outreach') || calls.some((c) => scriptOf(c.args) === 'outreach-drafts.mjs');
    assert.ok(outreachRan, 'the outreach batch step ran');
    for (const b of apply) assert.equal(b.approved, null, `${b.id} waits for the student's approval`);
    assert.deepEqual(submits(calls), [], 'nothing is submitted before a logged approval');
    assert.deepEqual((await logRows(r)).filter((x) => x.action === 'batch.approve'), [], 'the autopilot never approves for the student');
  } finally {
    r.cleanup();
  }
});

// M-005-S9-osdr
test('M-005-S9-osdr with chrome_in_schedule no the digest names the steps waiting for Chrome', async () => {
  const r = makePilotRoot('chrome_in_schedule: no\n');
  try {
    const batch = await approvedBatch(r);
    const { calls, digest } = await runPilot(r, batch);
    assert.deepEqual(calls.filter((c) => c.args.some((a) => /chrome\.mjs$/.test(String(a)))), [], 'no Chrome step runs');
    const waiting = digest.split('\n').filter((l) => /waiting for Chrome/i.test(l));
    assert.ok(waiting.length >= 1, `the digest has a waiting-for-Chrome line:\n${digest}`);
    assert.ok(waiting.some((l) => /submit/i.test(l)), `the submit step is named: ${waiting.join(' / ')}`);
  } finally {
    r.cleanup();
  }
});

// M-005-S11-osdr
test('M-005-S11-osdr a failing autopilot step becomes a digest line and scheduled.mjs still exits 0', async () => {
  const r = makePilotRoot('chrome_in_schedule: no\n');
  try {
    const { digest } = await runPilot(r, { fail: (script) => script === 'fill-plan.mjs' });
    const failed = digest.split('\n').filter((l) => /fill[- ]?plan/i.test(l) && /(fail|stopp|error|threw)/i.test(l));
    assert.equal(failed.length, 1, `one digest line names the failed fill-plan step:\n${digest}`);
  } finally {
    r.cleanup();
  }
  const s = makePilotRoot('automation: scheduled-discovery\nchrome_in_schedule: no\n');
  try {
    const runner = () => {
      throw Object.assign(new Error('child failed'), { status: 1, stderr: 'fake failure' });
    };
    const code = await scheduledRun({ root: s.root, packRoot: PACK_ROOT, passThrough: [], dataDir: s.data, today: TODAY, runner, out: () => {} });
    assert.equal(code, 0, 'scheduledRun resolves 0 when every step throws');
  } finally {
    s.cleanup();
  }
});

// M-005-S15-osdr
test('M-005-S15-osdr autopilot submits only items whose budget check apply.submit with --batch-id and --item exits 0 and an approved item already submitted is not submitted again', async () => {
  const r = makePilotRoot('chrome_in_schedule: yes\n');
  try {
    const batch = await approvedBatch(r, { spent: [1] });
    const unsent = await approvedUnsent(r.data);
    assert.equal(unsent.length, 1, `only item 2 is approved and unsent: ${JSON.stringify(unsent)}`);
    const { calls } = await runPilot(r, batch);
    const sent = submits(calls).map((c) => [flag(c.args, '--batch-id'), flag(c.args, '--item')]);
    assert.deepEqual(sent, [[batch.id, '2']], 'item 2 is submitted once and the spent item 1 is not submitted again');
  } finally {
    r.cleanup();
  }
});
