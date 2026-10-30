#!/usr/bin/env node
// First run, right after the interview: brings in the first postings and lists the rows still waiting for a
// verdict, so the student's session can triage them and show a real top 10. It uses the same ingest steps as the
// daily run, makes no model call and opens no browser; the verdicts come from the session that runs it.
// Usage: first-run.mjs [--root R] [--data-dir D] [--today YYYY-MM-DD] [--n 20] [--dry-run]
// Exit 0 after the report (a failed step is a line in it), 1 when the interview has not written config/student.yml.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, runCli } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { ingestStepNames, ingestSteps } from '../lib/ingest.mjs';
import { parsePipeline, sectionRows } from '../lib/pipeline-md.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { oneLine } from '../lib/text.mjs';
import { defaultRunner } from '../lib/upstream.mjs';

const DEFAULT_SHOWN = 20;
const TOP_LIST_SIZE = 10;

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

// Counts first, then up to `shown` untriaged rows as url | company | title for the session to judge.
export function formatReport(summary, shown) {
  const lines = [`Pending rows: ${summary.total}`, ...summary.sources.map(([src, n]) => `  src=${src}: ${n}`), `Untriaged Pending rows: ${summary.untriaged.length}`];
  if (summary.total < TOP_LIST_SIZE) lines.push(`Fewer than ${TOP_LIST_SIZE} postings fit your setup today (${summary.total}), so the top list will be shorter than ${TOP_LIST_SIZE}. The daily run adds new postings as they appear.`);
  if (!summary.untriaged.length) return [...lines, 'no untriaged Pending rows'];
  lines.push(...summary.untriaged.slice(0, shown).map((r) => `${r.url} | ${r.company} | ${r.title}`));
  if (summary.untriaged.length > shown) lines.push(`... and ${summary.untriaged.length - shown} more untriaged Pending rows`);
  return lines;
}

// Returns 1 only when config/student.yml is missing. A failed ingest step is a report line and the run goes on, so the
// student always gets a list of rows to triage.
export async function firstRun({ root, dataDir, packRoot, today, shown = DEFAULT_SHOWN, runner = defaultRunner, out = (s) => console.log(s) }) {
  const config = await loadStudentConfig({ root });
  if (!config) {
    out('INTERVIEW: run student/interview/interview.md before anything else');
    return 1;
  }
  mkdirSync(dataDir, { recursive: true });
  // One line per step; a failed step is reported and the rest still run, as in the daily run.
  const step = (name, fn) => {
    try {
      const detail = oneLine(fn());
      out(`first-run: ${name} ok${detail ? ` (${detail})` : ''}`);
    } catch (err) {
      out(`first-run: ${name} FAILED (${oneLine(err.stderr || err.stdout || err.message) || 'failed'})`);
    }
  };
  ingestSteps({ root, dataDir, packRoot, today, runner, step });
  const file = join(dataDir, 'pipeline.md');
  for (const line of formatReport(summarizePending(existsSync(file) ? readFileSync(file, 'utf8') : ''), shown)) out(line);
  return 0;
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { n: 'int' } });
  if (flags.n !== undefined && flags.n < 1) throw new UsageError('--n expects a whole number of 1 or more');
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  if (flags.dryRun) {
    console.log(`first-run dry run: ${ingestStepNames().length} step(s) would run: ${ingestStepNames().join(', ')}`);
    return 0;
  }
  const config = await loadStudentConfig({ root: paths.root });
  const today = createClock({ today: flags.today, timezone: config?.timezone }).today();
  return firstRun({ root: paths.root, dataDir: paths.dataDir, packRoot: paths.packRoot, today, shown: flags.n ?? DEFAULT_SHOWN });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(main);
