// Gmail in the automation Chrome: the one read and send path for both agents, with zero model calls. Sending composes one
// email only after budget.mjs check gmail.send passes for an approved batch item (and apply.followup for the same item
// when the email is an application follow-up); a refusal from either check sends nothing and never opens the browser.
// Every sent email and every reply read for a contact is kept in that contact's thread file (lib/thread-archive.mjs).
import { join } from 'node:path';
import { click, evaluate, navigate, openPage, readAxTree, withBrowser } from './cdp.mjs';
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

/**
 * Sends one approved email. email = { batchId, item, target, company, to, subject, body, nudge?, followup? }. target is the
 * contact's name: gmail.send is checked and logged with it (the address goes in --email), so the outreach hygiene rules
 * see the same person on LinkedIn and by email; nudge marks the contact's one follow-up. followup = { target, company } is
 * the application (its apply.submit target and company) when the email is that application's one follow-up: gmail.send
 * then takes the application as its target with --followup and apply.followup is checked with the same item.
 * Returns { code, sent, reason }: code 3 when a check refused, 0 when sent.
 */
export async function sendEmail({ paths, port, email, date, runner = runResult, browser = withBrowser }) {
  const app = email.followup ?? null;
  const who = app ? { target: app.target, company: app.company } : { target: email.target, company: email.company };
  const sendExtra = ['--email', email.to, ...(app ? ['--followup'] : email.nudge ? ['--nudge'] : [])];
  const checks = [['gmail.send', sendExtra], ...(app ? [['apply.followup', []]] : [])];
  for (const [action, extra] of checks) {
    const res = budget(paths, 'check', action, { ...email, ...who }, runner, extra);
    if (res.code !== 0) return { code: res.code, sent: false, reason: `${action} refused: ${(res.stdout || res.stderr).trim() || `exit ${res.code}`}` };
  }
  const clicked = await browser(port, async (client) => {
    const { sessionId } = await openPage(client, 'about:blank');
    await navigate(client, sessionId, composeUrl(email));
    return click(client, sessionId, '[role="button"][data-tooltip^="Send"], div[aria-label^="Send"]');
  });
  if (!clicked) return { code: 5, sent: false, reason: 'the Send button was not found; nothing was sent' };
  for (const [action, extra] of checks) budget(paths, 'log', action, { ...email, ...who }, runner, [...extra, '--approval', 'send all']);
  if (email.target && email.company) archiveMessage(paths.dataDir, { name: email.target, company: email.company, direction: 'sent', channel: 'email', text: `Subject: ${email.subject}\n\n${email.body}` });
  await appendLedger(paths.dataDir, zeroRow({ date, step: 'gmail-send', feature: app ? 'G6' : 'M7', rows: 1, source: 'session' }));
  return { code: 0, sent: true, reason: '' };
}

// Lists messages matching query through the automation Chrome and appends a zero-token gmail-read ledger row.
export async function readInbox({ dataDir, port, query, date, browser = withBrowser }) {
  const rows = await browser(port, (client) => listMessages(client, query));
  await appendLedger(dataDir, zeroRow({ date, step: 'gmail-read', feature: 'M13', rows: rows.length }));
  return rows;
}

// Reads one reply from a contact and keeps it in that contact's thread file; returns the message.
export async function readReply({ dataDir, port, url, contact, date, browser = withBrowser }) {
  const msg = await browser(port, (client) => readMessage(client, url));
  archiveMessage(dataDir, { name: contact.name, company: contact.company, direction: 'received', channel: 'email', text: msg.text });
  await appendLedger(dataDir, zeroRow({ date, step: 'gmail-read', feature: 'M7', rows: 1 }));
  return msg;
}
