#!/usr/bin/env node
// The daily autopilot, run by scheduled.mjs after the daily steps: ranks today's rows, prepares fill plans and cover
// letters (fill-plan.mjs), outreach drafts and due follow-ups (outreach-drafts.mjs) as one-page batches, and nothing goes
// out until the student approves a batch. Rows and contacts already in a batch that waits for approval are not prepared
// again. When the schedule reaches Chrome (chrome_in_schedule yes and the automation Chrome is up) it also fills and
// submits approved, unsent items of apply batches through `chrome.mjs fill --plan` and `chrome.mjs submit`, whose
// budget.mjs check (with the plan's score) refuses any item not approved or already used, and never submits a link that
// was already submitted; and it reads outcome mail through the Gmail path into inbox.mjs. Without Chrome those steps wait
// and the digest names them. On the weekly lessons day it runs the outreach lessons step (lib/outreach-lessons.mjs).
// A failing step becomes one digest line; the section ends with the guided footer; the run always exits 0.
// Usage: autopilot.mjs [--root R] [--data-dir D] [--today YYYY-MM-DD] [--log-file F]
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, parseArgs, runCli } from '../lib/args.mjs';
import { detailValue, readActionLog } from '../lib/action-log.mjs';
import { listBatches, readBatch, writeBatches } from '../lib/batch-file.mjs';
import { evaluate, openPage, withBrowser } from '../lib/cdp.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { footerLines } from '../lib/digest.mjs';
import { readMessage, replyKey, searchUrl } from '../lib/gmail-chrome.mjs';
import { isOn, readOverrides } from '../lib/levers.mjs';
import { weeklyLessons } from '../lib/outreach-lessons.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { runText } from '../lib/run.mjs';
import { stepErrorText } from '../lib/text.mjs';
import { appendDigestLines } from '../lib/triage-budget.mjs';
import { readTsv, writeAtomic } from '../lib/tsv.mjs';
import { append as appendLedger, zeroRow } from '../lib/usage-ledger.mjs';
import { approvedItem, effectiveLimits } from './budget.mjs';
import { liveState } from './chrome.mjs';

export const OUTCOME_QUERY = 'newer_than:2d (application OR interview OR offer OR unfortunately OR "next steps")';
const CHILD_TIMEOUT_MS = 60 * 60 * 1000;
const FILL_REPORT = /^fill-plan: \d+ of \d+ ready/m;
const DRAFTS_REPORT = /^outreach-drafts: .*(draft\(s\) in|already waiting|outreach is)/;
const INBOX_REPORT = /^inbox: (\d+) read, (\d+) proposal\(s\), (\d+) set$/m;
// At most this many outcome conversations are opened per run.
const MAIL_CAP = 10;
// Form fields per posting, read by fill-plan --fields-dir (<url key>.json); plans without a file there carry no fields.
export const FIELDS_DIR = 'form-fields';
const SPENT_ACTIONS = new Set(['apply.submit', 'apply.easy_apply', 'apply.pending']);

// Approved apply items not yet submitted, in batch order: the same rule budget.mjs checks (a logged batch.approve lists
// the item and no send or pending row spent it yet). kind is apply or easy-apply; plan is the item's fill plan file.
export async function approvedUnsent(dataDir) {
  const rows = await readActionLog(join(dataDir, 'action-log.tsv'));
  const out = [];
  for (const id of listBatches(dataDir)) {
    const b = readBatch(dataDir, id);
    if (b?.kind !== 'apply') continue;
    b.items.forEach((it, i) => {
      if (approvedItem(rows, id, i + 1)) out.push({ batchId: id, item: i + 1, company: it.company, link: it.link ?? '', plan: it.plan ?? '', kind: it.kind === 'easy-apply' ? 'easy-apply' : 'apply' });
    });
  }
  return out;
}

const linkKey = (url) => String(url ?? '').trim().replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();

// Links already submitted or mid-submit: the target of every submit or pending row, and the link of every batch item such
// a row spent. A posting on two approved pages is submitted once.
export function submittedLinks(dataDir, rows) {
  const done = new Set();
  const spent = rows.filter((r) => SPENT_ACTIONS.has(r.action));
  for (const r of spent) if (r.target) done.add(linkKey(r.target));
  for (const r of spent) {
    const b = readBatch(dataDir, detailValue(r.detail, 'batch') ?? '');
    const link = b?.items?.[Number(detailValue(r.detail, 'item')) - 1]?.link;
    if (link) done.add(linkKey(link));
  }
  done.delete('');
  return done;
}

// Links of apply batch items not spent yet (no submit or pending row), on any apply batch. A ranked row with one of these
// links is already on a page waiting for the student, so it is not prepared again.
export function waitingLinks(dataDir, rows) {
  const used = (id, n) => rows.some((r) => SPENT_ACTIONS.has(r.action) && detailValue(r.detail, 'batch') === id && Number(detailValue(r.detail, 'item')) === n);
  const out = new Set();
  for (const id of listBatches(dataDir)) {
    const b = readBatch(dataDir, id);
    if (b?.kind !== 'apply') continue;
    b.items.forEach((it, i) => {
      if (it.link && !used(id, i + 1)) out.add(linkKey(it.link));
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
    text = child('fill-plan.mjs', ['--rows', file, '--fields-dir', join(paths.dataDir, FIELDS_DIR)]);
  } catch (err) {
    return [`fill-plan.mjs failed (${stepErrorText(err)})`];
  }
  const made = listBatches(paths.dataDir).filter((id) => !before.has(id) && readBatch(paths.dataDir, id)?.kind === 'apply');
  if (made.length || FILL_REPORT.test(text)) return [lastLine(text) || `apply batches: ${made.join(', ')}`];
  const items = rows.map((r) => ({ company: r.company, role: r.title, score: r.score, preview: 'fill plan not ready yet; open the link to apply yourself, or ask me to prepare it', link: r.url }));
  const ids = writeBatches(paths.dataDir, { date: today, kind: 'apply', items });
  return [`review batch ${ids.join(', ')} with ${items.length} ranked row(s) and no fill plans yet`];
}

// Each approved, unsent item: chrome.mjs fill --plan, then chrome.mjs submit, whose budget.mjs check passes the plan's
// score and refuses an item not approved or already used. The batch approval covers both; a fill that needs the student
// (an unknown question, a blocked field) stops that item. A link already submitted, or submitted earlier in this run, is
// skipped, so a posting approved on two pages goes out once.
async function submitApproved({ paths, child }) {
  const items = await approvedUnsent(paths.dataDir);
  const done = submittedLinks(paths.dataDir, await readActionLog(join(paths.dataDir, 'action-log.tsv')));
  let submitted = 0;
  const notes = [];
  for (const it of items) {
    const name = `item ${it.item} of ${it.batchId}`;
    const key = linkKey(it.link);
    if (key && done.has(key)) {
      notes.push(`${name} not submitted: ${it.link} was already submitted`);
      continue;
    }
    if (it.plan && existsSync(it.plan)) {
      try {
        child('chrome.mjs', ['fill', '--plan', it.plan]);
      } catch (err) {
        notes.push(`${name} not filled (${stepErrorText(err)}); it waits for you in a session`);
        continue;
      }
    }
    try {
      child('chrome.mjs', ['submit', '--batch-id', it.batchId, '--item', String(it.item), '--kind', it.kind]);
      submitted++;
      if (key) done.add(key);
    } catch (err) {
      notes.push(`${name} not submitted (${stepErrorText(err)})`);
    }
  }
  return [`submitted ${submitted} of ${items.length} approved item(s)`, ...notes];
}

// Gmail list rows with their thread ids (the legacy hex id, or the decimal thread-f id turned into hex) and row text.
const LIST_SCRIPT = (cap) => `(() => Array.from(document.querySelectorAll('[role="row"]')).slice(0, ${cap}).map((r) => {
  const legacy = r.querySelector('[data-legacy-thread-id]');
  const thread = r.querySelector('[data-thread-id]');
  return { id: (legacy && legacy.getAttribute('data-legacy-thread-id')) || ((thread && thread.getAttribute('data-thread-id')) || '').replace(/^#?thread-f:/, ''), text: String(r.innerText || r.textContent || '').replace(/\\s+/g, ' ').trim() };
}).filter((r) => r.text))()`;

const hexId = (id) => (/^\d{15,}$/.test(id) ? BigInt(id).toString(16) : id);

// Outcome mail through the automation Chrome: the search list, then each conversation opened with gmail-chrome's
// readMessage, which gives the sender address and the Gmail message id. A row that cannot be opened keeps no sender, so
// inbox.mjs can only make it a proposal. Ids come from replyKey, so the same mail has the same id on every run.
export async function readOutcomeMail({ dataDir, port, query, date, browser = withBrowser }) {
  const mails = await browser(port, async (client) => {
    const { sessionId, targetId } = await openPage(client, searchUrl(query));
    let rows;
    try {
      rows = (await evaluate(client, sessionId, LIST_SCRIPT(MAIL_CAP))) ?? [];
    } finally {
      await Promise.resolve(client.send('Target.closeTarget', { targetId })).catch(() => {});
    }
    const out = [];
    for (const row of rows) {
      const id = hexId(String(row.id ?? ''));
      const url = id ? `${searchUrl(query)}/${id}` : '';
      const msg = url ? await readMessage(client, url).catch(() => null) : null;
      const text = msg?.text || row.text;
      out.push({ id: replyKey({ url, text, from: msg?.from ?? '', id: msg?.id ?? '' }), from: msg?.from ?? '', subject: String(row.text).slice(0, 200), snippet: String(text).slice(0, 2000) });
    }
    return out;
  });
  await appendLedger(dataDir, zeroRow({ date, step: 'gmail-read', feature: 'G3', rows: mails.length }));
  return mails;
}

// Outcome mail read in Chrome goes through inbox.mjs, which applies lib/outcome-rules.mjs; with lever T7 off it passes
// --classify-outcomes so the agent classifier takes part. The digest line carries inbox.mjs's own counts.
async function readOutcomes({ paths, today, child, deps }) {
  const state = await (deps.chromeState ?? (() => liveState(paths.dataDir)))();
  if (!state?.port) return ['the automation Chrome has no recorded port; outcome mail is read on the next run'];
  const mails = await (deps.readOutcomeMail ?? readOutcomeMail)({ dataDir: paths.dataDir, port: state.port, query: OUTCOME_QUERY, date: today });
  if (!mails.length) return ['none new'];
  const file = join(paths.dataDir, `.autopilot-mail-${today}.json`);
  const date = new Date().toISOString();
  writeAtomic(file, `${JSON.stringify(mails.map((m) => ({ date, ...m })))}\n`);
  const t7On = deps.t7On ?? isOn('T7', { overrides: readOverrides(paths.root) });
  const text = child('inbox.mjs', ['--backend', 'connector', '--input', file, ...(t7On ? [] : ['--classify-outcomes'])]);
  const m = INBOX_REPORT.exec(text);
  return [m ? `${m[1]} read, ${m[2]} proposal(s), ${m[3]} set` : `${mails.length} message(s) read; inbox.mjs printed no counts`];
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
 * out(line) for progress, and optional readOutcomeMail, chromeState, t7On and headless. Returns { lines, waiting, footer }
 * and never rejects.
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
    const waitingSet = waitingLinks(paths.dataDir, await readActionLog(join(paths.dataDir, 'action-log.tsv')));
    const ranked = JSON.parse(child('rank-queue.mjs', ['--json', '--n', String(cap + waitingSet.size)]) || '[]');
    const fresh = ranked.filter((r) => !waitingSet.has(linkKey(r.url)));
    rows = fresh.slice(0, cap);
    const already = ranked.length - fresh.length;
    return [`${rows.length} row(s) ranked for today${already ? `; ${already} already waiting for your approval` : ''}`];
  });
  await step('prepare applications', () => prepareApplications({ paths, today, child, rows }));
  await step('outreach drafts', async () => {
    const text = child('outreach-drafts.mjs', ['--source', 'scheduled', '--skip-waiting']);
    const report = String(text).split('\n').filter((l) => DRAFTS_REPORT.test(l)).map((l) => l.replace(/^outreach-drafts: /, ''));
    return report.length ? report : [lastLine(text) || 'done'];
  });
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
  let footer = [];
  try {
    footer = await sectionFooter({ paths, config, waiting });
    appendDigestLines({ dataDir: paths.dataDir, today, heading: 'Autopilot', lines });
    appendFileSync(join(paths.dataDir, 'digest', `student-${today}.md`), `\n${footer.join('\n')}\n`);
    await appendLedger(paths.dataDir, [zeroRow({ date: today, step: 'autopilot', feature: 'M3', rows: 1 }), zeroRow({ date: today, step: 'outcome-mail', feature: 'G3', rows: live ? 1 : 0 })]);
  } catch (err) {
    out(`autopilot: digest or ledger not written (${stepErrorText(err)})`);
  }
  return { lines, waiting, footer };
}

// The guided footer that ends the autopilot section, from the same state the digest summary takes (lib/digest.mjs).
async function sectionFooter({ paths, config, waiting }) {
  const batches = listBatches(paths.dataDir).map((id) => readBatch(paths.dataDir, id)).filter((b) => b && !b.approved && b.items.length);
  const approvedWaiting = waiting.length ? (await approvedUnsent(paths.dataDir)).length : 0;
  return footerLines({ waitingChrome: waiting, chromeInSchedule: config.chrome_in_schedule, approvedWaiting, batchesWaiting: batches.length });
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { 'log-file': 'string' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const config = await loadStudentConfig({ root: paths.root }).catch(() => null);
  const today = createClock({ today: flags.today, timezone: config?.timezone }).today();
  try {
    const res = await autopilot({ paths, today });
    console.log(`autopilot: ${res.lines.length} line(s) in the digest at data/digest/student-${today}.md`);
    for (const l of res.footer) console.log(l);
  } catch (err) {
    console.log(`autopilot: stopped (${stepErrorText(err)})`);
  }
  return 0;
}

if (isMain(import.meta.url)) await runCli(main);
