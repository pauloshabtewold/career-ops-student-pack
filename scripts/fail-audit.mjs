#!/usr/bin/env node
// Weekly second look at judgment-based FAILs: a stronger pass re-checks recent Skipped rows whose reason was a
// judgment call (graduation window, term, experience, level, start date, clearance, contract, pay, location).
// pick [--n 20]      JSON of the newest unaudited judgment FAIL rows
// apply <results>    consumes 'AUDIT: KEEP|WRONG | url | X.X/5 | reason'; WRONG rows return to Pending
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, runCli } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { LockTimeoutError, withLock } from '../lib/dir-lock.mjs';
import { appendLines, ensureSections, formatRow, getSection, parsePipeline, parseRow, serializePipeline } from '../lib/pipeline-md.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { appendTsv } from '../lib/tsv.mjs';
import { writeAtomic } from '../lib/tsv.mjs';

export const DEFAULT_JUDGMENT_KEYWORDS = ['grad', 'graduation', 'term', 'experience', 'level', 'start', 'clearance', 'contract', 'pay', 'location'];
const AUDIT_HEADER = ['date', 'url', 'verdict', 'score', 'reason'];
const AUDIT_RE = /^AUDIT:\s*(KEEP|WRONG)\s*\|\s*(\S+)\s*\|\s*([\d.]+)(?:\/5)?\s*\|\s*(.*)$/;

export function judgmentPattern(keywords) {
  throw new Error('judgmentPattern not implemented');
}

export function pickRows(doc, { n = 20, keywords = DEFAULT_JUDGMENT_KEYWORDS }) {
  const sec = getSection(doc, 'Skipped');
  const re = new RegExp(`\\b(${keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');
  const rows = [];
  (sec?.lines ?? []).forEach((line) => {
    const row = parseRow(line);
    if (!row || row.notes.has('audited')) return;
    const reason = row.notes.get('reason') ?? '';
    // Mechanical title filters are not judgment calls and need no second opinion.
    if (!reason || /^Title pre-filter/i.test(reason) || !re.test(reason)) return;
    const date = row.notes.get('triaged') ?? row.notes.get('imported') ?? '';
    rows.push({ date, url: row.url, company: row.company, title: row.title, reason });
  });
  // Newest first by the triaged= (else imported=) date. Ties break on url so repeated picks are stable.
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.url.localeCompare(b.url)).slice(0, n).map(({ date, ...r }) => r);
}

export function applyAudit(doc, verdicts, today) {
  ensureSections(doc);
  const sec = getSection(doc, 'Skipped');
  const back = [];
  const auditRows = [];
  sec.lines = sec.lines.flatMap((line) => {
    const row = parseRow(line);
    const v = row && verdicts.get(row.url);
    if (!v) return [line];
    auditRows.push({ date: today, url: row.url, verdict: v.verdict, score: v.score, reason: v.reason });
    row.notes.set('audited', today);
    if (v.verdict === 'KEEP') return [formatRow(row)];
    row.checkbox = ' ';
    for (const k of ['reason', 'triage']) row.notes.delete(k);
    row.notes.set('triage', v.score);
    back.push(formatRow(row));
    return [];
  });
  appendLines(doc, 'Pending', back);
  return { auditRows, returned: back.length };
}

async function main() {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2), { commands: ['pick', 'apply'], flags: { n: 'int' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const config = await loadStudentConfig({ root: paths.root });
  const pipelineFile = join(paths.dataDir, 'pipeline.md');
  const today = createClock({ today: flags.today, timezone: config?.timezone }).today();
  if (command === 'pick') {
    const keywords = config?.judgment_keywords?.length ? config.judgment_keywords : DEFAULT_JUDGMENT_KEYWORDS;
    console.log(JSON.stringify(pickRows(parsePipeline(readFileSync(pipelineFile, 'utf8')), { n: flags.n ?? 20, keywords }), null, 2));
    return 0;
  }
  if (positionals.length !== 1) throw new UsageError('usage: fail-audit.mjs apply <results.txt>');
  const verdicts = new Map();
  for (const line of readFileSync(positionals[0], 'utf8').split('\n')) {
    const m = AUDIT_RE.exec(line);
    if (m) verdicts.set(m[2], { verdict: m[1], score: Number(m[3]).toFixed(1), reason: m[4].replace(/[|;\n]/g, ',').trim() });
  }
  let result;
  try {
    result = await withLock(pipelineFile, () => {
      const doc = parsePipeline(readFileSync(pipelineFile, 'utf8'));
      const res = applyAudit(doc, verdicts, today);
      if (!flags.dryRun) writeAtomic(pipelineFile, serializePipeline(doc));
      return res;
    });
  } catch (err) {
    if (!(err instanceof LockTimeoutError)) throw err;
    console.error(`fail-audit: ${err.lockDir} is held by another process; pipeline.md left unchanged`);
    return 1;
  }
  if (!flags.dryRun && result.auditRows.length) {
    await appendTsv(join(paths.dataDir, 'triage-audit.tsv'), AUDIT_HEADER, result.auditRows);
  }
  console.log(JSON.stringify({ audited: result.auditRows.length, returned: result.returned }));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(main);
