#!/usr/bin/env node
// First run, right after the interview: brings in the first postings and lists the rows still waiting for a
// verdict, so the student's session can triage them and show a real top 10. It uses the same ingest steps as the
// daily run, makes no model call and opens no browser; the verdicts come from the session that runs it. It lists only
// the rows left in the student's first-run triage budget (lib/triage-budget.mjs).
// --list-only skips the ingest steps and only prints the counts and the rows, for a further batch after the first run.
// --queue runs the same ingest steps and then prints the raw queue (counts, the newest rows, upcoming sources) with no
// scores and no triage list, which is what the interview shows before any grading.
// Usage: first-run.mjs [--root R] [--data-dir D] [--today YYYY-MM-DD] [--n 20] [--dry-run] [--list-only] [--queue]
// Exit 0 after the report (a failed step is a line in it), 1 when the interview has not written config/student.yml.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { ingestStepNames, ingestSteps, presetFeedPlugins } from '../lib/ingest.mjs';
import { parsePipeline, sectionRows } from '../lib/pipeline-md.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { PresetError, loadMerged } from '../lib/presets.mjs';
import { ALL, CHUNK_ROWS, DEFAULT_FIRST_RUN, readTriageUsage, resolveTriageBudget, rowsLeft } from '../lib/triage-budget.mjs';
import { oneLine, stepErrorText } from '../lib/text.mjs';
import { defaultRunner } from '../lib/upstream.mjs';

const DEFAULT_SHOWN = 20;
const TOP_LIST_SIZE = 10;
// Alert sites alert-plan.mjs turns into numbered setup steps; every other preset alert is a tip to follow by hand.
const PLANNED_ALERT_SITES = ['linkedin', 'handshake', 'simplify', 'indeed', 'usajobs'];

// Pending rows grouped by their src= note, and the ones that have no triage= note yet.
export function summarizePending(pipelineText) {
  const pending = sectionRows(parsePipeline(pipelineText || '# Pipeline\n'), 'Pending');
  const bySource = new Map();
  for (const { row } of pending) {
    const src = row.notes.get('src') || 'none';
    bySource.set(src, (bySource.get(src) ?? 0) + 1);
  }
  return {
    total: pending.length,
    sources: [...bySource].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    untriaged: pending.map(({ row }) => row).filter((row) => !row.notes.has('triage')),
  };
}

// Counts first, the first-run triage budget, then up to `shown` untriaged rows as url | company | title for the session
// to judge. With the budget used up no rows are listed: the daily triage scores the rest.
export function formatFirstRunReport(summary, shown, { budget = DEFAULT_FIRST_RUN, used = 0 } = {}) {
  const lines = [`Pending rows: ${summary.total}`, ...summary.sources.map(([src, n]) => `  src=${src}: ${n}`), `Untriaged Pending rows: ${summary.untriaged.length}`];
  if (summary.total < TOP_LIST_SIZE) lines.push(`Fewer than ${TOP_LIST_SIZE} postings fit your setup today (${summary.total}), so the top list will be shorter than ${TOP_LIST_SIZE}. The daily run adds new postings as they appear.`);
  lines.push(budget === ALL ? `First-run triage budget: all (batches of ${CHUNK_ROWS} until no untriaged rows remain)` : `First-run triage budget: ${budget} rows (${used} scored so far, batches of ${CHUNK_ROWS})`);
  if (rowsLeft(budget, used) === 0) return [...lines, `first-run triage budget used (${used} of ${budget}); the daily triage scores the rest`];
  if (!summary.untriaged.length) return [...lines, 'no untriaged Pending rows'];
  lines.push(...summary.untriaged.slice(0, shown).map((r) => `${r.url} | ${r.company} | ${r.title}`));
  if (summary.untriaged.length > shown) lines.push(`... and ${summary.untriaged.length - shown} more untriaged Pending rows`);
  return lines;
}

// The raw queue: how many postings wait, from which sources, the newest rows with no score, and the sources that are
// upcoming or checked by hand. The newest are ordered by the imported= note, then by their place in the file.
export function queueView(pipelineText, merged) {
  const pending = sectionRows(parsePipeline(pipelineText || '# Pipeline\n'), 'Pending');
  const summary = summarizePending(pipelineText);
  const newest = pending
    .map(({ row }, i) => ({ row, i }))
    .sort((a, b) => (b.row.notes.get('imported') ?? '').localeCompare(a.row.notes.get('imported') ?? '') || b.i - a.i)
    .slice(0, TOP_LIST_SIZE);
  const lines = [`queue: ${summary.total} postings waiting`, ...summary.sources.map(([src, n]) => `source ${src}: ${n}`)];
  if (newest.length) lines.push('newest:', ...newest.map(({ row }) => `${row.company} | ${row.title} | ${row.location}`));
  const watchOnly = (merged?.seed_employers ?? []).filter((e) => e.watch_only).map((e) => `- ${e.name} ${e.careers_url} (upcoming)`);
  const tips = (merged?.sources.alerts ?? []).filter((a) => !PLANNED_ALERT_SITES.includes(a.site)).map((a) => `- ${a.name} (upcoming): ${a.how}`);
  if (watchOnly.length || tips.length) lines.push('Upcoming and check by hand:', ...watchOnly, ...tips);
  return lines;
}

// Returns 1 only when config/student.yml is missing. A failed ingest step is a report line and the run goes on, so the
// student always gets a list of rows to triage.
export async function firstRun({ root, dataDir, packRoot, today, shown = DEFAULT_SHOWN, listOnly = false, queue = false, runner = defaultRunner, out = (s) => console.log(s) }) {
  const config = await loadStudentConfig({ root });
  if (!config) {
    out('INTERVIEW: run student/interview/interview.md before anything else');
    return 1;
  }
  mkdirSync(dataDir, { recursive: true });
  if (!listOnly) runIngest({ root, dataDir, packRoot, today, runner, out, config });
  const file = join(dataDir, 'pipeline.md');
  if (queue) {
    let merged = null;
    try {
      merged = loadMerged(config.presets ?? [], { root });
    } catch (err) {
      if (!(err instanceof PresetError || err?.code === 'ENOENT' || err?.name === 'YAMLException')) throw err;
      out(`upcoming section left out: ${oneLine(err.message)}`);
    }
    for (const line of queueView(existsSync(file) ? readFileSync(file, 'utf8') : '', merged)) out(line);
    return 0;
  }
  const budget = resolveTriageBudget(config).firstRun;
  const used = readTriageUsage(dataDir, today).firstRun;
  const report = formatFirstRunReport(summarizePending(existsSync(file) ? readFileSync(file, 'utf8') : ''), Math.min(shown, rowsLeft(budget, used)), { budget, used });
  for (const line of report) out(line);
  return 0;
}

function runIngest({ root, dataDir, packRoot, today, runner, out, config }) {
  // One line per step; a failed step is reported and the rest still run, as in the daily run.
  const step = (name, fn) => {
    try {
      const detail = oneLine(fn());
      out(`first-run: ${name} ok${detail ? ` (${detail})` : ''}`);
    } catch (err) {
      out(`first-run: ${name} FAILED (${stepErrorText(err)})`);
    }
  };
  let feeds = [];
  try {
    feeds = presetFeedPlugins({ root, presets: config.presets ?? [] });
  } catch {
    // A preset that cannot be read leaves the extra feeds out.
  }
  ingestSteps({ root, dataDir, packRoot, today, runner, step, feeds });
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { n: 'int', 'list-only': 'boolean', queue: 'boolean' } });
  if (flags.queue && flags.listOnly) throw new UsageError('use --queue or --list-only, not both');
  if (flags.n !== undefined && flags.n < 1) throw new UsageError('--n expects a whole number of 1 or more');
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  if (flags.dryRun) {
    const names = ingestStepNames();
    console.log(`first-run dry run: ${names.length} step(s) would run: ${names.join(', ')}`);
    return 0;
  }
  const config = await loadStudentConfig({ root: paths.root });
  const today = createClock({ today: flags.today, timezone: config?.timezone }).today();
  return firstRun({ root: paths.root, dataDir: paths.dataDir, packRoot: paths.packRoot, today, shown: flags.n ?? DEFAULT_SHOWN, listOnly: flags.listOnly, queue: flags.queue });
}

if (isMain(import.meta.url)) await runCli(main);
