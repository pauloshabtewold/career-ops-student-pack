#!/usr/bin/env node
// Gmail in the automation Chrome for a session: the one command that sends an approved outreach email or reads a reply,
// through lib/gmail-chrome.mjs with zero model calls. send takes the recipient, subject and text from the approved batch
// item itself, runs the budget.mjs checks (gmail.send, and apply.followup for an application follow-up) with that item's
// ids, logs gmail.pending before the Send click and logs the send only after Gmail confirms it. reply reads one message,
// keeps it in the contact's thread file and logs it as linkedin.reply once per distinct reply.
// Usage: gmail.mjs send --batch-id ID --item N | reply --url URL --target NAME --company C   [--root R] [--data-dir D]
// Exit codes: send 0 sent and logged, 1 sent but a log failed (log it by hand with the same ids), 3 refused before any
// click (not approved, already used, a daily or hygiene limit, or the item is not an email), 4 wait, 5 nothing was
// clicked or Gmail never confirmed the send (check the Sent folder first); reply 0 read and logged, 1 read but the log
// failed; both 2 usage and 7 automation Chrome not running.
import { UsageError, isMain, parseArgs, runCli } from '../lib/args.mjs';
import { readBatch } from '../lib/batch-file.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { readReply, sendEmail } from '../lib/gmail-chrome.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { liveState } from './chrome.mjs';

const NOT_RUNNING = 7;

// The email object sendEmail spends: the item's own target and company; an application follow-up names its application,
// and a contact's one follow-up is a nudge.
export function emailOf(batchId, item, listed) {
  const base = { batchId, item, target: listed?.target ?? '', company: listed?.company ?? '' };
  if (listed?.action === 'application-follow-up') return { ...base, followup: { target: base.target, company: base.company } };
  return listed?.action === 'follow-up' ? { ...base, nudge: true } : base;
}

async function port(paths, deps, say) {
  const live = await (deps.chromeState ?? (() => liveState(paths.dataDir)))();
  if (!live?.port) say('gmail: automation Chrome is not running; run node student/scripts/chrome.mjs open');
  return live?.port ?? null;
}

async function cmdSend({ paths, flags, today, deps, say }) {
  if (!flags.batchId || !Number.isInteger(flags.item)) throw new UsageError('send needs --batch-id ID --item N');
  const listed = readBatch(paths.dataDir, flags.batchId)?.items?.[flags.item - 1] ?? null;
  const p = await port(paths, deps, say);
  if (!p) return NOT_RUNNING;
  const res = await sendEmail({ paths, port: p, email: emailOf(flags.batchId, flags.item, listed), date: today, ...(deps.runner ? { runner: deps.runner } : {}), ...(deps.browser ? { browser: deps.browser } : {}) });
  say(res.code === 0 ? `gmail: sent item ${flags.item} of ${flags.batchId} to ${listed?.to} and logged it` : `gmail: item ${flags.item} of ${flags.batchId}: ${res.reason || `exit ${res.code}`}`);
  return res.code;
}

async function cmdReply({ paths, flags, today, deps, say }) {
  if (!flags.url || !flags.target || !flags.company) throw new UsageError('reply needs --url URL --target NAME --company C');
  const p = await port(paths, deps, say);
  if (!p) return NOT_RUNNING;
  const msg = await readReply({ dataDir: paths.dataDir, paths, port: p, url: flags.url, contact: { name: flags.target, company: flags.company }, date: today, ...(deps.runner ? { runner: deps.runner } : {}), ...(deps.browser ? { browser: deps.browser } : {}) });
  say(`gmail: read the reply from ${flags.target} (${flags.company}) into the thread file; ${msg.logged ? 'logged as linkedin.reply' : 'NOT logged: log it with budget.mjs log linkedin.reply'}`);
  say(msg.text);
  return msg.logged ? 0 : 1;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const { command, flags } = parseArgs(argv, { commands: ['send', 'reply'], flags: { 'batch-id': 'string', item: 'int', url: 'string', target: 'string', company: 'string' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const config = await loadStudentConfig({ root: paths.root }).catch(() => null);
  const today = createClock({ today: flags.today, timezone: config?.timezone }).today();
  const say = deps.say ?? ((l) => console.log(l));
  return (command === 'send' ? cmdSend : cmdReply)({ paths, flags, today, deps, say });
}

if (isMain(import.meta.url)) await runCli(() => main());
