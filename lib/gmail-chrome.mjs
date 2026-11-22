// Gmail in the automation Chrome: the one read and send path for both agents, with zero model calls. Sending composes one
// email only after budget.mjs check gmail.send passes for an approved batch item (and apply.followup for the same item
// when the email is an application follow-up); a refusal from either check sends nothing and never opens the browser.
// The recipient, subject and text come from the approved batch item itself, so an approval covers exactly the email the
// student saw. Every sent email and every reply read for a contact is kept in that contact's thread file
// (lib/thread-archive.mjs), and each reply read is logged as linkedin.reply so the hygiene rules see the contact answered.
import { join } from 'node:path';
import { readBatch } from './batch-file.mjs';
import { click, evaluate, navigate, openPage, readAxTree, withBrowser } from './cdp.mjs';
import { resolvePaths } from './paths.mjs';
import { runResult } from './run.mjs';
import { archiveMessage } from './thread-archive.mjs';
import { append as appendLedger, zeroRow } from './usage-ledger.mjs';

export const GMAIL = 'https://mail.google.com/mail/u/0/';
export const searchUrl = (query) => `${GMAIL}#search/${encodeURIComponent(query)}`;
export const composeUrl = ({ to, subject, body }) => `${GMAIL}?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

const closeTab = (client, targetId) => Promise.resolve(client.send('Target.closeTarget', { targetId })).catch(() => {});

// Message list rows as text, one per conversation.
export async function listMessages(client, query) {
  const { sessionId, targetId } = await openPage(client, searchUrl(query));
  try {
    return (await readAxTree(client, sessionId)).filter((n) => n.role === 'row' && n.name).map((n) => n.name);
  } finally {
    await closeTab(client, targetId);
  }
}

// The open message's body (Gmail's message body element, or the main region, or the page body) as text, plus every link
// target in it, read as text and never opened.
const READ_SCRIPT = `(() => {
  const el = document.querySelector('div.a3s') || document.querySelector('[role="main"]') || document.body;
  const text = el ? String(el.innerText || el.textContent || '') : '';
  const links = el ? Array.from(el.querySelectorAll('a[href]')).map((a) => a.href || a.getAttribute('href')).filter(Boolean) : [];
  return { text, hrefs: links };
})()`;

// One message: its body text and link targets.
export async function readMessage(client, url) {
  const { sessionId, targetId } = await openPage(client, url);
  try {
    const res = (await evaluate(client, sessionId, READ_SCRIPT)) ?? {};
    return { text: String(res.text ?? '').trim(), hrefs: [...new Set(res.hrefs ?? [])] };
  } finally {
    await closeTab(client, targetId);
  }
}

function budget(paths, verb, action, { batchId, item, target, company }, runner, extra = []) {
  const args = [join(paths.packRoot, 'scripts', 'budget.mjs'), verb, action, '--batch-id', String(batchId ?? ''), '--item', String(item ?? ''), '--target', String(target ?? ''), ...(company ? ['--company', company] : []), ...extra, '--root', paths.root, '--data-dir', paths.dataDir];
  return runner(process.execPath, args, { cwd: paths.packRoot });
}

const SEND_BUTTON = '[role="button"][data-tooltip^="Send"], div[aria-label^="Send"]';
// Gmail confirmed the send: the "Message sent" notice shows, or the compose window and its Send button are gone.
const SENT_SCRIPT = `(() => {
  const text = document.body ? String(document.body.innerText || '') : '';
  return /message sent/i.test(text) || !document.querySelector(${JSON.stringify(SEND_BUTTON)});
})()`;
const CONFIRM_TRIES = 20;
const CONFIRM_WAIT_MS = 500;

// Clicks Send in a compose tab for the email and waits for Gmail to confirm it; the tab is closed either way.
// Resolves 'sent', 'no-button' (nothing was clicked) or 'unconfirmed' (clicked, but Gmail never showed it sent).
async function composeAndSend(client, email) {
  const { sessionId, targetId } = await openPage(client, 'about:blank');
  try {
    await navigate(client, sessionId, composeUrl(email));
    if (!(await click(client, sessionId, SEND_BUTTON))) return 'no-button';
    for (let i = 0; i < CONFIRM_TRIES; i++) {
      await new Promise((r) => setTimeout(r, CONFIRM_WAIT_MS));
      if (await evaluate(client, sessionId, SENT_SCRIPT)) return 'sent';
    }
    return 'unconfirmed';
  } finally {
    await closeTab(client, targetId);
  }
}

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

// The approved batch item the email spends, or a refusal when the item does not match what the caller is sending: the
// item must exist, be an email, name the same target and carry a recipient; a caller's address or text that differs
// from the item is refused, not sent.
function approvedEmail(paths, email, who) {
  const refuse = (reason) => ({ refusal: { code: 3, sent: false, reason: `item ${email.item} of batch ${email.batchId}: ${reason}; nothing was sent` } });
  const listed = readBatch(paths.dataDir, String(email.batchId ?? ''))?.items?.[Number(email.item) - 1];
  if (!listed) return refuse('no such batch item');
  if (listed.channel !== 'email') return refuse('the approved item is not an email');
  if (!same(listed.target, who.target)) return refuse(`approved for ${listed.target}, not ${who.target}`);
  if (!listed.to) return refuse('the approved item has no recipient address');
  if (email.to && !same(email.to, listed.to)) return refuse(`approved for ${listed.to}, not ${email.to}`);
  if (email.body && String(email.body).trim() !== String(listed.message ?? '').trim()) return refuse('the text differs from the approved draft');
  return { to: listed.to, subject: listed.subject ?? email.subject ?? '', body: listed.message ?? '' };
}

/**
 * Sends one approved email. email = { batchId, item, target, company, nudge?, followup?, to?, subject?, body? }. The
 * recipient, subject and text are taken from the batch item (data/batches/<batchId>.json); to and body, when given, must
 * match it. target is the contact's name: gmail.send is checked and logged with it (the address goes in --email), so the
 * outreach hygiene rules see the same person on LinkedIn and by email; nudge marks the contact's one follow-up.
 * followup = { target, company } is the application (its apply.submit target and company) when the email is that
 * application's one follow-up: gmail.send then takes the application as its target with --followup and apply.followup is
 * checked with the same item. Before the click a gmail.pending row spends the item under the action-log lock; after
 * Gmail confirms the send, gmail.send (and apply.followup) are logged.
 * Returns { code, sent, reason }: 3 when a check or the item refused, 5 when nothing was clicked or Gmail never confirmed
 * the send, 1 when the email went out but a log failed (stop and log it by hand), 0 when sent and logged.
 */
export async function sendEmail({ paths, port, email, date, runner = runResult, browser = withBrowser }) {
  const app = email.followup ?? null;
  const who = app ? { target: app.target, company: app.company } : { target: email.target, company: email.company };
  const approved = approvedEmail(paths, email, who);
  if (approved.refusal) return approved.refusal;
  const sendExtra = ['--email', approved.to, ...(app ? ['--followup'] : email.nudge ? ['--nudge'] : [])];
  const checks = [['gmail.send', sendExtra], ...(app ? [['apply.followup', []]] : [])];
  for (const [action, extra] of checks) {
    const res = budget(paths, 'check', action, { ...email, ...who }, runner, extra);
    if (res.code !== 0) return { code: res.code, sent: false, reason: `${action} refused: ${(res.stdout || res.stderr).trim() || `exit ${res.code}`}` };
  }
  const pending = budget(paths, 'log', 'gmail.pending', { ...email, ...who }, runner, sendExtra);
  if (pending.code !== 0) return { code: pending.code, sent: false, reason: `gmail.pending refused: ${(pending.stdout || pending.stderr).trim() || `exit ${pending.code}`}` };
  const outcome = await browser(port, (client) => composeAndSend(client, approved));
  if (outcome === 'no-button') return { code: 5, sent: false, reason: 'the Send button was not found; nothing was sent' };
  if (outcome !== 'sent') return { code: 5, sent: false, reason: 'Send was clicked but Gmail did not confirm it; check the Sent folder before anything else' };
  const failed = [];
  for (const [action, extra] of checks) {
    const res = budget(paths, 'log', action, { ...email, ...who }, runner, extra);
    if (res.code !== 0) failed.push(`${action}: ${(res.stdout || res.stderr).trim() || `exit ${res.code}`}`);
  }
  if (email.target && email.company) archiveMessage(paths.dataDir, { name: email.target, company: email.company, direction: 'sent', channel: 'email', text: `Subject: ${approved.subject}\n\n${approved.body}` });
  await appendLedger(paths.dataDir, zeroRow({ date, step: 'gmail-send', feature: app ? 'G6' : 'M7', rows: 1, source: 'session' }));
  if (failed.length) return { code: 1, sent: true, reason: `sent but not logged: ${failed.join('; ')}` };
  return { code: 0, sent: true, reason: '' };
}

// Lists messages matching query through the automation Chrome and appends a zero-token gmail-read ledger row.
export async function readInbox({ dataDir, port, query, date, browser = withBrowser }) {
  const rows = await browser(port, (client) => listMessages(client, query));
  await appendLedger(dataDir, zeroRow({ date, step: 'gmail-read', feature: 'M13', rows: rows.length }));
  return rows;
}

// Reads one reply from a contact, keeps it in that contact's thread file and logs it as linkedin.reply (the one reply
// event for both channels); returns the message with logged: true when the reply row was written.
export async function readReply({ dataDir, paths = resolvePaths({ dataDir }), port, url, contact, date, runner = runResult, browser = withBrowser }) {
  const msg = await browser(port, (client) => readMessage(client, url));
  archiveMessage(dataDir, { name: contact.name, company: contact.company, direction: 'received', channel: 'email', text: msg.text });
  const args = [join(paths.packRoot, 'scripts', 'budget.mjs'), 'log', 'linkedin.reply', '--target', contact.name, '--company', contact.company, '--root', paths.root, '--data-dir', dataDir];
  const logged = runner(process.execPath, args, { cwd: paths.packRoot });
  await appendLedger(dataDir, zeroRow({ date, step: 'gmail-read', feature: 'M7', rows: 1 }));
  return { ...msg, logged: logged.code === 0 };
}
