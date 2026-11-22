#!/usr/bin/env node
// The student's one-page batches: list them, show one, record the approval in their own words, and see what went out.
// approve parses the reply ("approve all", "all except 3, 7", "submit 1,3", "send all") and logs it through
// budget.mjs log batch.approve, which every send kind checks before it acts.
// Usage: batch.mjs list | show <id> | approve <id> "<words>" | status [<id>]   [--root R] [--data-dir D] [--today D]
// status without an id shows every batch.
// Exit codes follow the pack convention: 0 ok, 2 usage (including no such batch), 3 refused, 4 wait and 5 needs the user
// (a reply the grammar cannot read, so the student is asked again); budget.mjs 3, 4 and 5 pass through unchanged.
import { join } from 'node:path';
import { UsageError, isMain, parseArgs, runCli } from '../lib/args.mjs';
import { parse } from '../lib/approval-grammar.mjs';
import { listBatches, readBatch, renderBatch, updateBatch } from '../lib/batch-file.mjs';
import { createClock } from '../lib/clock.mjs';
import { readActionLog, detailValue } from '../lib/action-log.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { runResult } from '../lib/run.mjs';
import { append, zeroRow } from '../lib/usage-ledger.mjs';

const SEND_ACTIONS = new Set(['apply.submit', 'apply.easy_apply', 'linkedin.connect', 'linkedin.message', 'linkedin.nudge', 'gmail.send', 'apply.followup']);

const NEEDS_USER = 5;
const PASS_THROUGH = new Set([3, 4, 5]);

// An unknown batch id is a usage error: the id came from the student or the agent, not from a refusal.
function mustRead(dataDir, id) {
  const batch = id ? readBatch(dataDir, id) : null;
  if (!batch) throw new UsageError(`no batch ${id ?? '(none given)'}`);
  return batch;
}

// Records batch.approve for the approved items through budget.mjs log.
export function logApproval({ paths, id, items, words, runner = runResult }) {
  const args = [join(paths.packRoot, 'scripts', 'budget.mjs'), 'log', 'batch.approve', '--batch-id', id, '--items', items.join(','), '--approval', words, '--root', paths.root, '--data-dir', paths.dataDir];
  return runner(process.execPath, args, { cwd: paths.root });
}

async function cmdApprove({ paths, positionals, say, today, runner }) {
  const [id, words] = positionals;
  if (!id || !words) throw new UsageError('usage: batch.mjs approve <id> "<your words>"');
  const batch = mustRead(paths.dataDir, id);
  const res = parse(words, batch.items.length);
  if (res.error) {
    say(`batch: ${res.error}`);
    return NEEDS_USER;
  }
  const logged = logApproval({ paths, id, items: res.items, words, runner });
  if (logged.code !== 0) {
    say(`batch: budget.mjs refused the approval: ${(logged.stdout || logged.stderr).trim()}`);
    return PASS_THROUGH.has(logged.code) ? logged.code : 1;
  }
  // A later approval adds items: every logged approval stays spendable in budget.mjs, so the page keeps them all.
  updateBatch(paths.dataDir, id, (b) => ({ ...b, approved: { items: [...new Set([...(b.approved?.items ?? []), ...res.items])].sort((x, y) => x - y), words } }));
  await append(paths.dataDir, zeroRow({ date: today, step: 'batch-approve', feature: 'H3', rows: res.items.length, source: 'session' }));
  say(`batch: approved items ${res.items.join(', ')} of ${id}`);
  return 0;
}

// One batch's items with their send state (submitted for applications, sent for outreach), then its finish-these-yourself
// jobs with their direct links and reasons. An apply.pending or gmail.pending row with no send row is a click the page
// never confirmed: the application or email may or may not have gone out.
function sayBatchStatus(batch, id, rows, say) {
  const itemsWith = (pred) => new Set(rows.filter((r) => pred(r) && detailValue(r.detail, 'batch') === id).map((r) => Number(detailValue(r.detail, 'item'))));
  const sent = itemsWith((r) => SEND_ACTIONS.has(r.action));
  const pending = itemsWith((r) => r.action === 'apply.pending' || r.action === 'gmail.pending');
  const done = batch.kind === 'apply' ? 'submitted' : 'sent';
  const approved = new Set(batch.approved?.items ?? []);
  const finishReason = new Map((batch.finishYourself ?? []).map((f) => [f.link, f.reason]));
  batch.items.forEach((it, i) => {
    const n = i + 1;
    const finish = finishReason.has(it.link) ? `on finish these yourself${finishReason.get(it.link) ? `: ${finishReason.get(it.link)}` : ''}` : null;
    const state = sent.has(n) ? done : pending.has(n) ? `clicked, not confirmed: check ${it.link || 'the Sent folder'}` : finish ?? (approved.has(n) ? 'approved, waiting' : batch.approved ? 'not approved' : 'waiting for approval');
    say(`${n}. ${it.company} | ${it.role} | ${state}`);
  });
  const finish = batch.finishYourself ?? [];
  if (finish.length) {
    say('Finish these yourself:');
    for (const f of finish) say(`  ${f.company} | ${f.role} | ${f.link}${f.reason ? ` (${f.reason})` : ''}`);
  }
}

async function cmdStatus({ paths, positionals, say }) {
  const rows = await readActionLog(join(paths.dataDir, 'action-log.tsv'));
  const id = positionals[0];
  if (id) {
    sayBatchStatus(mustRead(paths.dataDir, id), id, rows, say);
    return 0;
  }
  const ids = listBatches(paths.dataDir);
  if (!ids.length) say('batch: no batches yet');
  for (const each of ids) {
    say(`${each}:`);
    sayBatchStatus(readBatch(paths.dataDir, each), each, rows, say);
  }
  return 0;
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const { command, positionals, flags } = parseArgs(argv, { commands: ['list', 'show', 'approve', 'status'] });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const say = deps.say ?? ((l) => console.log(l));
  const today = createClock({ today: flags.today }).today();
  const env = { paths, positionals, say, today, runner: deps.runner };
  if (command === 'list') {
    const ids = listBatches(paths.dataDir);
    for (const id of ids) {
      const b = readBatch(paths.dataDir, id);
      say(`${id}: ${b.items.length} item(s), ${b.approved ? `approved ${b.approved.items.join(',')}` : 'waiting for approval'}`);
    }
    if (!ids.length) say('batch: no batches yet');
    return 0;
  }
  if (command === 'show') {
    say(renderBatch(mustRead(paths.dataDir, positionals[0])));
    return 0;
  }
  return command === 'approve' ? cmdApprove(env) : cmdStatus(env);
}

if (isMain(import.meta.url)) await runCli(() => main());
