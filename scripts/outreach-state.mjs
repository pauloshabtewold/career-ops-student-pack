#!/usr/bin/env node
// Prints where outreach stands with no model call: the stage-driven next action per contact (due), the contacts whose
// reply waits for an answer (replies), and the weekly sent count (weekly). archive appends one message to the contact's
// thread file in data/threads/ (a LinkedIn message after it is sent and logged, or a reply read in the automation Chrome).
// Usage: outreach-state.mjs due|replies|weekly [--json] [--root R] [--data-dir D] [--today YYYY-MM-DD]
//        outreach-state.mjs archive --target NAME --company C --direction sent|received [--channel linkedin|email] --text-file F
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isMain, parseArgs, runCli, UsageError } from '../lib/args.mjs';
import { readActionLog } from '../lib/action-log.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { detailValue } from '../lib/action-log.mjs';
import { contactRecords, followupsDue, isAppFollowup, isMessage, lower, nextAction, oneActivePerCompany, weeklySentBy } from '../lib/outreach-state.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { parsePipeline, sectionRows } from '../lib/pipeline-md.mjs';
import { archiveMessage } from '../lib/thread-archive.mjs';
import { parseTsv } from '../lib/tsv.mjs';

const readIf = (f) => (existsSync(f) ? readFileSync(f, 'utf8') : '');

// The channel of a contact's last message (email when it was a gmail.send, with its logged address), so their one
// follow-up goes out the same way.
function lastChannel(actions, name, company) {
  const mine = actions.filter((r) => isMessage(r) && !isAppFollowup(r) && lower(r.target) === lower(name) && lower(r.company) === lower(company));
  const last = mine.reduce((a, r) => (!a || r.ms >= a.ms ? r : a), null);
  return last?.action === 'gmail.send' ? { channel: 'email', email: detailValue(last.detail, 'email') ?? '' } : { channel: 'linkedin' };
}

// Builds contact records from contacts.tsv joined with action-log.tsv (both through contactRecords, the helper budget.mjs
// uses, so a contact known only from a logged linkedin.connect holds its company too) and returns the due actions (at
// most one opener per company, none while another contact there is active), the application follow-ups due and the
// weekly sent counts. A contact follow-up carries the channel (and address) of the contact's last message.
export async function outreachState(dataDir, now) {
  // A Date or epoch milliseconds.
  const nowMs = Number(now);
  const actions = await readActionLog(join(dataDir, 'action-log.tsv'));
  const contacts = contactRecords(parseTsv(readIf(join(dataDir, 'contacts.tsv'))).rows, actions);
  const openPostings = new Set(sectionRows(parsePipeline(readIf(join(dataDir, 'pipeline.md')) || '# Pipeline\n'), 'Pending').map(({ row }) => String(row.company).toLowerCase()));
  const all = contacts
    .map((c) => ({ name: c.name, company: c.company, ...nextAction(c, { nowMs, openPostings }) }))
    .filter((d) => !['stop', 'wait'].includes(d.action))
    .map((d) => (d.action === 'follow-up' ? { ...d, ...lastChannel(actions, d.name, d.company) } : d));
  return { due: oneActivePerCompany(all, contacts, nowMs), followups: followupsDue(actions, nowMs), weekly: weeklySentBy(actions, nowMs) };
}

function archive(paths, flags) {
  if (!flags.target || !flags.company || !flags.direction || !flags.textFile) throw new UsageError('archive needs --target, --company, --direction sent|received and --text-file');
  if (!existsSync(flags.textFile)) throw new UsageError(`--text-file ${flags.textFile} does not exist`);
  const file = archiveMessage(paths.dataDir, { name: flags.target, company: flags.company, direction: flags.direction, channel: flags.channel ?? 'linkedin', text: readFileSync(flags.textFile, 'utf8') });
  console.log(`archived to ${file}`);
  return 0;
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2), {
    commands: ['due', 'replies', 'weekly', 'archive'],
    flags: { target: 'string', company: 'string', direction: 'string', channel: 'string', 'text-file': 'string' },
  });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  if (command === 'archive') return archive(paths, flags);
  const config = await loadStudentConfig({ root: paths.root }).catch(() => null);
  const nowMs = createClock({ today: flags.today, timezone: config?.timezone }).now().getTime();
  const st = await outreachState(paths.dataDir, nowMs);
  if (command === 'weekly') {
    const w = st.weekly;
    console.log(flags.json ? JSON.stringify(w) : `outreach this week: ${w.total} sent (connects ${w.connects}, messages ${w.messages}, emails ${w.emails})`);
    return 0;
  }
  const rows = command === 'replies'
    ? st.due.filter((d) => d.action === 'reply' || d.action === 'referral-ask')
    : [...st.due, ...st.followups.map((f) => ({ name: f.target, company: f.company, stage: 'applied', action: 'application-follow-up (email)' }))];
  if (flags.json) console.log(JSON.stringify(rows));
  else if (!rows.length) console.log('outreach: nothing due');
  else for (const d of rows) console.log(`${d.action}\t${d.name}\t${d.company}\t${d.stage}`);
  return 0;
}

if (isMain(import.meta.url)) await runCli(main);
