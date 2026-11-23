#!/usr/bin/env node
// The daily autopilot, run by scheduled.mjs after the daily steps: ranks today's rows, prepares fill plans and cover
// letters (fill-plan.mjs), outreach drafts and due follow-ups (outreach-drafts.mjs) as one-page batches, and nothing goes
// out until the student approves a batch. Rows and contacts already in a batch that waits for approval are not prepared
// again. When the schedule reaches Chrome (chrome_in_schedule yes and the automation Chrome is up) it also fills and
// submits approved, unsent items of apply batches through `chrome.mjs fill --plan` and `chrome.mjs submit`, whose
// budget.mjs check (with the plan's score) refuses any item not approved or already used, and never submits a link that
// was already submitted. Before the fill plans are built it reads each ranked posting's form with `chrome.mjs read-form`
// into data/form-fields. Only a plan that carries the form's fields is filled and submitted; any other approved item
// waits for a fill in a session. It also reads outcome mail through the
// Gmail path into inbox.mjs. Without Chrome those steps wait and the digest names them. On the weekly lessons day it runs the outreach lessons step (lib/outreach-lessons.mjs).
// A failing step becomes one digest line; the section ends with the guided footer; the run always exits 0.
// Usage: autopilot.mjs [--root R] [--data-dir D] [--today YYYY-MM-DD] [--log-file F]
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, parseArgs, runCli } from '../lib/args.mjs';
import { detailValue, readActionLog } from '../lib/action-log.mjs';
import { EMPTY_READ_TRIES, FIELDS_DIR, formFieldsFile, formGaveUp } from '../lib/ats-fields.mjs';
import { listBatches, readBatch, writeBatches } from '../lib/batch-file.mjs';
import { evaluate, openPage, withBrowser } from '../lib/cdp.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { footerLines, waitingCounts } from '../lib/digest.mjs';
import { replyKey, searchUrl } from '../lib/gmail-chrome.mjs';
import { weeklyLessons } from '../lib/outreach-lessons.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { runText } from '../lib/run.mjs';
import { stepErrorText } from '../lib/text.mjs';
import { urlKey } from '../lib/url-key.mjs';
import { appendDigestLines } from '../lib/triage-budget.mjs';
import { readTsv, writeAtomic } from '../lib/tsv.mjs';
import { append as appendLedger, zeroRow } from '../lib/usage-ledger.mjs';
import { approvedItem, effectiveLimits } from './budget.mjs';
import { liveState } from './chrome.mjs';
import { fitScore } from './fill-plan.mjs';

// Positive terms only: a negated phrase once hid real rejection mail. regret, candidates, selected, invitation, invited and
// call reach outcome mails that name no application, interview or offer (tests/fixtures/quality/outcome-mails.json).
export const OUTCOME_QUERY = 'newer_than:2d (application OR interview OR offer OR unfortunately OR "next steps" OR regret OR candidates OR selected OR invitation OR invited OR call)';
const CHILD_TIMEOUT_MS = 60 * 60 * 1000;
const FILL_REPORT = /^fill-plan: \d+ of \d+ ready/m;
const DRAFTS_REPORT = /^outreach-drafts: .*(draft\(s\) in|already waiting|outreach is)/;
const INBOX_REPORT = /^inbox: (\d+) read, (\d+) proposal\(s\), (\d+) set$/m;
// At most this many outcome conversations are opened per run; the list read is bounded by LIST_MAX rows.
const MAIL_CAP = 10;
const LIST_MAX = 100;
// Conversations already handed to inbox.mjs, one `<thread id>|<row hash>` per line next to the inbox seen file. The row
// hash changes when a new message arrives in the conversation, so a reply in a handled thread is still read.
export const THREADS_SEEN_FILE = '.outcome-threads-seen';
// Problem lines chrome.mjs fill prints for a field it could not fill or one only the student fills.
const FILL_PROBLEM = /^chrome: (?:could not fill (.+)|blocked-on-user: (.+?) is a )/;
// A Gmail search list renders this many rows per page, so a full page may hide more matches.
const GMAIL_PAGE = 50;
// Gmail's standard page sizes: a list exactly this long may be one page of more, so its count is a lower bound.
const GMAIL_PAGE_SIZES = [25, 50, 100];
// Form fields per posting (chrome.mjs read-form writes them), read by fill-plan --fields-dir; plans without a file there
// carry no fields.
export { FIELDS_DIR };
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

// The posting key from lib/url-key.mjs (query ids such as gh_jid kept, tracking parameters dropped); a link it cannot
// parse is compared as its trimmed, lowercased text.
export const linkKey = (url) => urlKey(url) ?? String(url ?? '').trim().replace(/\/+$/, '').toLowerCase();

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

// While the automation Chrome is up, each ranked posting with no saved form yet gets its form read by `chrome.mjs
// read-form` (read-only: it never types or clicks), so fill-plan maps real fields with selectors, writes a cover letter
// for a form with a cover slot and plans the resume upload. A row whose form cannot be read keeps a plan without fields,
// which waits for a fill in a session.
// A page with no application form saves no file and is read again on the next run; after EMPTY_READ_TRIES such reads
// the posting is listed under finish these yourself and not read again.
function readForms({ paths, child, rows }) {
  const dir = join(paths.dataDir, FIELDS_DIR);
  const unread = rows.filter((r) => /^https?:\/\//i.test(String(r.url ?? '')) && !existsSync(formFieldsFile(dir, r.url)));
  const todo = unread.filter((r) => !formGaveUp(dir, r.url));
  const notes = unread.filter((r) => formGaveUp(dir, r.url)).map((r) => `finish these yourself: ${r.company} (${r.url}): no application form found in ${EMPTY_READ_TRIES} reads; apply on the page yourself`);
  let read = 0;
  for (const r of todo) {
    try {
      child('chrome.mjs', ['read-form', '--url', r.url]);
      read++;
    } catch (err) {
      notes.push(`${r.company}: form not read (${stepErrorText(err)}); its plan waits for a fill in a session`);
    }
  }
  return [`read ${read} of ${todo.length} form(s)${rows.length > todo.length ? `; ${rows.length - todo.length} already read or with no link` : ''}`, ...notes];
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
  const items = rows.map((r) => ({ company: r.company, role: r.title, score: fitScore(r), preview: 'fill plan not ready yet; open the link to apply yourself, or ask me to prepare it', link: r.url }));
  const ids = writeBatches(paths.dataDir, { date: today, kind: 'apply', items });
  return [`review batch ${ids.join(', ')} with ${items.length} ranked row(s) and no fill plans yet`];
}

const readPlan = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

// Why a plan cannot be filled and submitted by the autopilot, as the waiting line's tail, or null when it can: it must
// carry the form's fields, no field only the student fills (plan.blocked, named by label, never by value), no unknown
// question, and every resume or cover letter upload it names on disk. fill-plan writes fields only from a form that was
// read (data/form-fields, written by chrome.mjs read-form), so a plan without fields means no form was read for it.
export function planWait(plan) {
  if (!Array.isArray(plan?.fields) || !plan.fields.length) return 'waits for a fill in a session (no form was read for it)';
  if (plan.blocked?.length) return `waits for you: fields only you fill (${plan.blocked.map((b) => String(b).replace(/\s+/g, ' ').trim().slice(0, 60)).join(', ')})`;
  if (plan.unknown?.length) return `waits for a fill in a session (it has ${plan.unknown.length} question(s) to answer)`;
  const files = [...(plan.uploads ?? []).map((u) => u?.path), ...(plan.cover ? [plan.cover] : [])];
  if (!files.every((f) => f && existsSync(f))) return 'waits for a fill in a session (an upload file is missing)';
  return null;
}

export const planReady = (plan) => planWait(plan) === null;

// Why a finished fill must not be submitted, or null: chrome.mjs printed a field it could not fill or one only the
// student fills, or it typed no text field (the plan's tab has no sentinel; an upload alone does not count).
function fillHold(text, plan) {
  const labels = String(text).split('\n').map((l) => FILL_PROBLEM.exec(l.trim())).filter(Boolean).map((m) => String(m[1] ?? m[2]).replace(/\s+/g, ' ').trim());
  if (labels.length) return `waits for a fill in a session (the fill could not fill ${labels.join(', ')})`;
  if (!plan?.tab?.sentinel) return 'waits for a fill in a session (no text field was filled, so nothing was submitted)';
  return null;
}

// An approved plan built while its form was not read has no fields (the batch line said "form not read yet"): its form is
// read now (unless a saved read exists) and `fill-plan.mjs --replan` rebuilds that item's plan in place, with the cover
// letter when the form has a slot, before any fill. Returns why the item waits, or null when the plan has fields.
function replanUnread({ paths, child, it }) {
  if (readPlan(it.plan)?.fields?.length) return null;
  try {
    if (!existsSync(formFieldsFile(join(paths.dataDir, FIELDS_DIR), it.link))) child('chrome.mjs', ['read-form', '--url', it.link]);
    child('fill-plan.mjs', ['--replan', '--batch-id', it.batchId, '--item', String(it.item)]);
  } catch (err) {
    return `not submitted: its form could not be read and the plan rebuilt (${stepErrorText(err)}); it waits for a session`;
  }
  return readPlan(it.plan)?.fields?.length ? null : 'not submitted: the rebuilt plan still has no form fields; it waits for a session';
}

// Each approved, unsent item whose plan is ready: chrome.mjs fill --plan, then chrome.mjs submit, whose budget.mjs check
// passes the plan's score and refuses an item not approved or already used. The batch approval covers both. Submit runs
// only after a clean fill that typed a text field (fillHold); an item whose plan is not ready (planWait), whose fill
// needs the student or failed, or whose fill is held waits with its reason and is counted in tally.fillWaiting. An item with no plan file still goes to chrome.mjs submit, which refuses it before any click. A link
// already submitted, or submitted earlier in this run, is skipped, so a posting approved on two pages goes out once.
async function submitApproved({ paths, child, tally }) {
  const items = await approvedUnsent(paths.dataDir);
  const done = submittedLinks(paths.dataDir, await readActionLog(join(paths.dataDir, 'action-log.tsv')));
  let submitted = 0;
  const notes = [];
  const wait = (line) => {
    tally.fillWaiting++;
    notes.push(line);
  };
  for (const it of items) {
    const name = `item ${it.item} of ${it.batchId}`;
    const key = linkKey(it.link);
    if (key && done.has(key)) {
      notes.push(`${name} not submitted: ${it.link} was already submitted`);
      continue;
    }
    if (it.plan && existsSync(it.plan)) {
      const unread = replanUnread({ paths, child, it });
      if (unread) {
        wait(`${name} ${unread}`);
        continue;
      }
      const why = planWait(readPlan(it.plan));
      if (why) {
        wait(`${name} ${why}`);
        continue;
      }
      let text;
      try {
        text = String(child('chrome.mjs', ['fill', '--plan', it.plan]));
      } catch (err) {
        wait(`${name} not filled (${stepErrorText(err)}); it waits for a fill in a session`);
        continue;
      }
      const held = fillHold(text, readPlan(it.plan));
      if (held) {
        wait(`${name} ${held}`);
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
const LIST_SCRIPT = `(() => Array.from(document.querySelectorAll('[role="row"]')).slice(0, ${LIST_MAX}).map((r) => {
  const legacy = r.querySelector('[data-legacy-thread-id]');
  const thread = r.querySelector('[data-thread-id]');
  return { id: (legacy && legacy.getAttribute('data-legacy-thread-id')) || ((thread && thread.getAttribute('data-thread-id')) || '').replace(/^#?thread-f:/, ''), text: String(r.innerText || r.textContent || '').replace(/\\s+/g, ' ').trim() };
}).filter((r) => r.text))()`;

// The newest message of an open conversation: the last message element's id, the last sender address, the last body
// and the last date title, plus the message count. An earlier message (a receipt, the student's own mail) never lends
// its id or sender to the new reply.
export const THREAD_SCRIPT = `(() => {
  const all = (sel) => Array.from(document.querySelectorAll(sel));
  const last = (sel) => all(sel).pop() || null;
  const attr = (n, name) => (n && typeof n.getAttribute === 'function' ? n.getAttribute(name) || '' : '');
  const legacy = all('[data-legacy-message-id]');
  const msgs = legacy.length ? legacy : all('[data-message-id]');
  const lastMsg = msgs.length ? msgs[msgs.length - 1] : null;
  const body = last('div.a3s');
  return {
    id: attr(lastMsg, 'data-legacy-message-id') || attr(lastMsg, 'data-message-id'),
    from: attr(last('span.gD[email]'), 'email'),
    text: body ? String(body.innerText || body.textContent || '') : '',
    date: attr(last('span.g3[title]'), 'title'),
    count: msgs.length,
  };
})()`;

const hexId = (id) => (/^\d{15,}$/.test(id) ? BigInt(id).toString(16) : id);

// List-row text without Gmail's relative time ("9:14 AM", "Nov 21", "11/21/26"), so the same row reads the same on
// every day.
const TIME_TOKENS = [/\b\d{1,2}:\d{2}\s?(?:[ap]\.?m\.?)?/gi, /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}(?:, \d{4})?\b/gi, /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g];
export const stableRowText = (text) => TIME_TOKENS.reduce((t, re) => t.replace(re, ' '), String(text ?? '')).replace(/\s+/g, ' ').trim();
const rowSeenKey = (row) => `${row.id || '-'}|${createHash('sha256').update(stableRowText(row.text).toLowerCase()).digest('hex').slice(0, 16)}`;

const readSeenThreads = (dataDir) => {
  const file = join(dataDir, THREADS_SEEN_FILE);
  return new Set(existsSync(file) ? readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean) : []);
};

async function readThread(client, url) {
  const { sessionId, targetId } = await openPage(client, url);
  try {
    return (await evaluate(client, sessionId, THREAD_SCRIPT)) ?? {};
  } finally {
    await Promise.resolve(client.send('Target.closeTarget', { targetId })).catch(() => {});
  }
}

const isoDate = (title) => {
  const t = Date.parse(String(title ?? ''));
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

// Outcome mail through the automation Chrome: the search list, then each conversation not handled before (at most
// MAIL_CAP) opened for its newest message's sender, Gmail message id and date. A row that cannot be opened keeps no
// sender, so inbox.mjs can only make it a proposal. The id is the Gmail message id, else `t-<thread id>-<message count>`,
// else a hash of the row text without its relative time, so the same mail has the same id on every run. Returns
// { mails, keys, more, fullPage }: keys mark the conversations read (written to THREADS_SEEN_FILE once inbox.mjs took
// them), more counts the unhandled conversations left for a later run, and fullPage says the list filled a Gmail page,
// so more is a lower bound.
export async function readOutcomeMail({ dataDir, port, query, date, browser = withBrowser }) {
  const seen = readSeenThreads(dataDir);
  const res = await browser(port, async (client) => {
    const { sessionId, targetId } = await openPage(client, searchUrl(query));
    let rows;
    try {
      rows = (await evaluate(client, sessionId, LIST_SCRIPT)) ?? [];
    } finally {
      await Promise.resolve(client.send('Target.closeTarget', { targetId })).catch(() => {});
    }
    const fresh = rows.map((r) => ({ ...r, id: hexId(String(r.id ?? '')) })).filter((r) => !seen.has(rowSeenKey(r)));
    const mails = [];
    for (const row of fresh.slice(0, MAIL_CAP)) {
      const url = row.id ? `${searchUrl(query)}/${row.id}` : '';
      const msg = url ? await readThread(client, url).catch(() => null) : null;
      const from = String(msg?.from ?? '');
      const id = msg?.id ? replyKey({ id: msg.id }) : row.id && msg?.count ? `t-${row.id}-${msg.count}` : replyKey({ text: stableRowText(row.text), from });
      const when = isoDate(msg?.date);
      mails.push({ id, from, subject: String(row.text).slice(0, 200), snippet: String(msg?.text || row.text).slice(0, 2000), ...(when ? { date: when } : {}) });
    }
    return { mails, keys: fresh.slice(0, MAIL_CAP).map(rowSeenKey), more: Math.max(0, fresh.length - MAIL_CAP), fullPage: rows.length >= GMAIL_PAGE || GMAIL_PAGE_SIZES.includes(rows.length) };
  });
  await appendLedger(dataDir, zeroRow({ date, step: 'gmail-read', feature: 'G3', rows: res.mails.length }));
  return res;
}

// Outcome mail read in Chrome goes through inbox.mjs, which applies lib/outcome-rules.mjs. --classify-outcomes is always
// passed: decideOutcome orders rules and the agent classifier by lever T7. The digest line carries inbox.mjs's own counts
// and names the matching conversations left unread. A mail keeps the date Gmail showed for it, else the run time.
async function readOutcomes({ paths, today, child, deps }) {
  const state = await (deps.chromeState ?? (() => liveState(paths.dataDir)))();
  if (!state?.port) return ['the automation Chrome has no recorded port; outcome mail is read on the next run'];
  const got = await (deps.readOutcomeMail ?? readOutcomeMail)({ dataDir: paths.dataDir, port: state.port, query: OUTCOME_QUERY, date: today });
  const { mails, keys = [], more = 0, fullPage = false } = got;
  const moreLine = more ? [`${fullPage ? 'at least ' : ''}${more} more matching conversation(s) not read yet; the next scheduled run reads them`] : [];
  if (!mails.length) return ['none new', ...moreLine];
  const file = join(paths.dataDir, `.autopilot-mail-${today}.json`);
  const date = new Date().toISOString();
  writeAtomic(file, `${JSON.stringify(mails.map((m) => ({ date, ...m })))}\n`);
  const text = child('inbox.mjs', ['--backend', 'connector', '--input', file, '--classify-outcomes']);
  if (keys.length) appendFileSync(join(paths.dataDir, THREADS_SEEN_FILE), `${keys.join('\n')}\n`);
  const m = INBOX_REPORT.exec(text);
  return [m ? `${m[1]} read, ${m[2]} proposal(s), ${m[3]} set` : `${mails.length} message(s) read; inbox.mjs printed no counts`, ...moreLine];
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
 * out(line) for progress, and optional readOutcomeMail, chromeState and headless. Returns { lines, waiting, footer }
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
  let live = false;
  if (config.chrome_in_schedule === 'yes') {
    try {
      live = Boolean(await (deps.chromeOpen ?? defaultChromeOpen(paths.dataDir))());
    } catch {
      live = false;
    }
  }
  if (live && rows.length) await step('read forms', () => readForms({ paths, child, rows }));
  await step('prepare applications', () => prepareApplications({ paths, today, child, rows }));
  await step('outreach drafts', async () => {
    const text = child('outreach-drafts.mjs', ['--source', 'scheduled', '--skip-waiting']);
    const report = String(text).split('\n').filter((l) => DRAFTS_REPORT.test(l)).map((l) => l.replace(/^outreach-drafts: /, ''));
    return report.length ? report : [lastLine(text) || 'done'];
  });
  await step('outreach lessons', () => lessonsStep({ paths, today, config, deps }));
  const waiting = [];
  const tally = { fillWaiting: 0 };
  if (live) {
    await step('submit approved', () => submitApproved({ paths, child, tally }));
    await step('outcome mail', () => readOutcomes({ paths, today, child, deps }));
  } else {
    waiting.push('submitting approved applications', 'reading outcome mail');
    lines.push(`waiting for Chrome: ${waiting.join(', ')}${config.chrome_in_schedule === 'yes' ? ' (the automation Chrome was not open)' : ' (chrome_in_schedule is no)'}`);
  }
  let footer = [];
  try {
    footer = await sectionFooter({ paths, config, waiting, fillWaiting: tally.fillWaiting });
    appendDigestLines({ dataDir: paths.dataDir, today, heading: 'Autopilot', lines });
    appendFileSync(join(paths.dataDir, 'digest', `student-${today}.md`), `\n${footer.join('\n')}\n`);
    await appendLedger(paths.dataDir, [zeroRow({ date: today, step: 'autopilot', feature: 'M3', rows: 1 }), zeroRow({ date: today, step: 'outcome-mail', feature: 'G3', rows: live ? 1 : 0 })]);
  } catch (err) {
    out(`autopilot: digest or ledger not written (${stepErrorText(err)})`);
  }
  return { lines, waiting, footer };
}

// The guided footer that ends the autopilot section, from the same state the digest summary takes (lib/digest.mjs).
async function sectionFooter({ paths, config, waiting, fillWaiting }) {
  const counts = waitingCounts(listBatches(paths.dataDir).map((id) => readBatch(paths.dataDir, id)));
  const approvedWaiting = waiting.length ? (await approvedUnsent(paths.dataDir)).length : 0;
  // An unset chrome_in_schedule counts as no (scheduled.mjs runsAutopilot).
  return footerLines({ waitingChrome: waiting, chromeInSchedule: config.chrome_in_schedule === 'yes' ? 'yes' : 'no', approvedWaiting, fillWaiting, ...counts });
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
