#!/usr/bin/env node
// The daily autopilot, run by scheduled.mjs after the daily steps: ranks today's rows, prepares fill plans and cover
// letters (fill-plan.mjs), outreach drafts and due follow-ups (outreach-drafts.mjs) as one-page batches, and nothing goes
// out until the student approves a batch. When the schedule reaches Chrome (chrome_in_schedule yes and the automation
// Chrome is up) it also submits approved, unsent items of apply batches, each only after `budget.mjs check` passes for its
// --batch-id and --item and then through `chrome.mjs submit`, which checks again, and reads outcome mail through the Gmail
// path. Without Chrome those steps wait and the digest names them. On the weekly lessons day it runs the outreach lessons
// step (lib/outreach-lessons.mjs). A failing step becomes one digest line; the run never fails and always exits 0.
// Usage: autopilot.mjs [--root R] [--data-dir D] [--today YYYY-MM-DD] [--log-file F]
import { join } from 'node:path';
import { isMain, parseArgs, runCli } from '../lib/args.mjs';
import { readActionLog } from '../lib/action-log.mjs';
import { listBatches, readBatch, writeBatches } from '../lib/batch-file.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { readInbox } from '../lib/gmail-chrome.mjs';
import { weeklyLessons } from '../lib/outreach-lessons.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { runText } from '../lib/run.mjs';
import { stepErrorText } from '../lib/text.mjs';
import { appendDigestLines } from '../lib/triage-budget.mjs';
import { readTsv, writeAtomic } from '../lib/tsv.mjs';
import { append as appendLedger, zeroRow } from '../lib/usage-ledger.mjs';
import { approvedItem, effectiveLimits } from './budget.mjs';
import { SUBMIT_KINDS, liveState } from './chrome.mjs';

export const OUTCOME_QUERY = 'newer_than:2d (application OR interview OR offer OR unfortunately OR "next steps")';
const CHILD_TIMEOUT_MS = 60 * 60 * 1000;
const FILL_REPORT = /^fill-plan: \d+ of \d+ ready/m;

// Approved apply items not yet submitted, in batch order: the same rule budget.mjs checks (a logged batch.approve lists
// the item and no send or pending row spent it yet). kind is apply or easy-apply.
export async function approvedUnsent(dataDir) {
  const rows = await readActionLog(join(dataDir, 'action-log.tsv'));
  const out = [];
  for (const id of listBatches(dataDir)) {
    const b = readBatch(dataDir, id);
    if (b?.kind !== 'apply') continue;
    b.items.forEach((it, i) => {
      if (approvedItem(rows, id, i + 1)) out.push({ batchId: id, item: i + 1, company: it.company, kind: it.kind === 'easy-apply' ? 'easy-apply' : 'apply' });
    });
  }
  return out;
}

const lastLine = (text) => String(text ?? '').trim().split('\n').filter(Boolean).pop() ?? '';

// One pack script as a child process: runner(process.execPath, [script, ...args], opts) returns stdout or throws.
function childRunner({ paths, today, runner }) {
  return (script, extra = []) => String(runner(process.execPath, [join(paths.packRoot, 'scripts', script), ...extra, '--root', paths.root, '--data-dir', paths.dataDir, '--today', today], { cwd: paths.root, timeout: CHILD_TIMEOUT_MS }) ?? '');
}

// fill-plan writes today's apply batches. When it printed no ready count (a fill-plan that could not report, so nothing
// says which rows it prepared), the ranked rows go into one review batch with no fill plans: the student still sees the
// day's picks, and chrome.mjs submit refuses any item without a fill plan, so nothing can be submitted from it.
function prepareApplications({ paths, today, child, rows }) {
  if (!rows.length) return ['no ranked rows today; no apply batch'];
  const file = join(paths.dataDir, `.autopilot-rows-${today}.json`);
  writeAtomic(file, `${JSON.stringify(rows)}\n`);
  const before = new Set(listBatches(paths.dataDir));
  let text;
  try {
    text = child('fill-plan.mjs', ['--rows', file]);
  } catch (err) {
    return [`fill-plan.mjs failed (${stepErrorText(err)})`];
  }
  const made = listBatches(paths.dataDir).filter((id) => !before.has(id) && readBatch(paths.dataDir, id)?.kind === 'apply');
  if (made.length || FILL_REPORT.test(text)) return [lastLine(text) || `apply batches: ${made.join(', ')}`];
  const items = rows.map((r) => ({ company: r.company, role: r.title, score: r.score, preview: 'fill plan not ready yet; open the link to apply yourself, or ask me to prepare it', link: r.url }));
  const ids = writeBatches(paths.dataDir, { date: today, kind: 'apply', items });
  return [`review batch ${ids.join(', ')} with ${items.length} ranked row(s) and no fill plans yet`];
}

// Each approved, unsent item: budget.mjs check first, then chrome.mjs submit, which checks the approval again.
async function submitApproved({ paths, child }) {
  const items = await approvedUnsent(paths.dataDir);
  let submitted = 0;
  const notes = [];
  for (const it of items) {
    const ids = ['--batch-id', it.batchId, '--item', String(it.item)];
    try {
      child('budget.mjs', ['check', SUBMIT_KINDS[it.kind], '--company', it.company ?? '', ...ids]);
    } catch (err) {
      notes.push(`item ${it.item} of ${it.batchId} refused by budget.mjs (${stepErrorText(err)})`);
      continue;
    }
    try {
      child('chrome.mjs', ['submit', ...ids, '--kind', it.kind]);
      submitted++;
    } catch (err) {
      notes.push(`item ${it.item} of ${it.batchId} not submitted (${stepErrorText(err)})`);
    }
  }
  return [`submitted ${submitted} of ${items.length} approved item(s)`, ...notes];
}

// Outcome mail rows read in Chrome go through inbox.mjs, which applies lib/outcome-rules.mjs; a row seen only as list
// text has no sender address, so it can only become a proposal there.
async function readOutcomes({ paths, today, child, deps }) {
  const state = await (deps.chromeState ?? (() => liveState(paths.dataDir)))();
  if (!state?.port) return ['the automation Chrome has no recorded port; outcome mail is read on the next run'];
  const rows = await (deps.readInbox ?? readInbox)({ dataDir: paths.dataDir, port: state.port, query: OUTCOME_QUERY, date: today });
  if (!rows.length) return ['none new'];
  const file = join(paths.dataDir, `.autopilot-mail-${today}.json`);
  const date = new Date().toISOString();
  writeAtomic(file, `${JSON.stringify(rows.map((text, i) => ({ id: `chrome-${today}-${i + 1}`, from: '', subject: String(text).slice(0, 200), snippet: String(text).slice(0, 300), date })))}\n`);
  child('inbox.mjs', ['--backend', 'connector', '--input', file]);
  return [`${rows.length} message(s) read`];
}

async function lessonsStep({ paths, today, config, deps }) {
  const actionRows = await readActionLog(join(paths.dataDir, 'action-log.tsv'));
  const { rows: contactRows } = await readTsv(join(paths.dataDir, 'contacts.tsv'));
  const res = await weeklyLessons({ dataDir: paths.dataDir, root: paths.root, today, agent: config.agent ?? 'claude', actionRows, contactRows, ...(deps.headless ? { headless: deps.headless } : {}) });
  return res.line ? [res.line.replace(/^outreach lessons: /, '')] : [];
}

const defaultChromeOpen = (dataDir) => async () => Boolean(await liveState(dataDir));

/**
 * deps: runner(cmd, args, opts) for every pack-script child, chromeOpen() -> true when the automation Chrome is up,
 * out(line) for progress, and optional readInbox, chromeState and headless. Returns { lines, waiting } and never rejects.
 */
export async function autopilot({ paths, today, deps = {} }) {
  const runner = deps.runner ?? runText;
  const out = deps.out ?? ((l) => console.log(l));
  const child = childRunner({ paths, today, runner });
  const config = (await loadStudentConfig({ root: paths.root }).catch(() => null)) ?? {};
  const lines = [];
  const step = async (name, fn) => {
    try {
      for (const l of await fn()) lines.push(`${name}: ${l}`);
    } catch (err) {
      lines.push(`${name}: failed (${stepErrorText(err)})`);
    }
    out(`autopilot: ${lines.at(-1) ?? name}`);
  };
  let rows = [];
  await step('rank', async () => {
    const cap = effectiveLimits(config).values.submit_per_day;
    rows = JSON.parse(child('rank-queue.mjs', ['--json', '--n', String(cap)]) || '[]');
    return [`${rows.length} row(s) ranked for today`];
  });
  await step('prepare applications', () => prepareApplications({ paths, today, child, rows }));
  await step('outreach drafts', async () => [lastLine(child('outreach-drafts.mjs')) || 'done']);
  await step('outreach lessons', () => lessonsStep({ paths, today, config, deps }));
  let live = false;
  if (config.chrome_in_schedule === 'yes') {
    try {
      live = Boolean(await (deps.chromeOpen ?? defaultChromeOpen(paths.dataDir))());
    } catch {
      live = false;
    }
  }
  const waiting = [];
  if (live) {
    await step('submit approved', () => submitApproved({ paths, child }));
    await step('outcome mail', () => readOutcomes({ paths, today, child, deps }));
  } else {
    waiting.push('submitting approved applications', 'reading outcome mail');
    lines.push(`waiting for Chrome: ${waiting.join(', ')}${config.chrome_in_schedule === 'yes' ? ' (the automation Chrome was not open)' : ' (chrome_in_schedule is no)'}`);
  }
  try {
    appendDigestLines({ dataDir: paths.dataDir, today, heading: 'Autopilot', lines });
    await appendLedger(paths.dataDir, [zeroRow({ date: today, step: 'autopilot', feature: 'M3', rows: 1 }), zeroRow({ date: today, step: 'outcome-mail', feature: 'G3', rows: live ? 1 : 0 })]);
  } catch (err) {
    out(`autopilot: digest or ledger not written (${stepErrorText(err)})`);
  }
  return { lines, waiting };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { 'log-file': 'string' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const config = await loadStudentConfig({ root: paths.root }).catch(() => null);
  const today = createClock({ today: flags.today, timezone: config?.timezone }).today();
  try {
    const res = await autopilot({ paths, today });
    console.log(`autopilot: ${res.lines.length} line(s) in the digest`);
  } catch (err) {
    console.log(`autopilot: stopped (${stepErrorText(err)})`);
  }
  return 0;
}

if (isMain(import.meta.url)) await runCli(main);
