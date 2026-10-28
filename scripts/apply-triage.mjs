#!/usr/bin/env node
// Applies triage verdicts to data/pipeline.md.
// Input lines: TRIAGE: PASS|MARGINAL|FAIL|SKIP|EXPIRED|BROWSER | url | X.X[/5] | reason   (extra columns tolerated)
// PASS and MARGINAL stay in Pending with triage= and reason=. FAIL, SKIP and EXPIRED go to Skipped. BROWSER moves
// the row to Flagged because the JD must be read in the browser. EXPIRED and BROWSER also act on Flagged rows;
// dead is dead wherever the row sits.
// Usage: apply-triage.mjs <results.txt> [--data-dir D] [--dry-run]    prints JSON counts
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, runCli } from '../lib/args.mjs';
import { LockTimeoutError, withLock } from '../lib/dir-lock.mjs';
import { appendLines, ensureSections, formatRow, getSection, parsePipeline, parseRow, serializePipeline } from '../lib/pipeline-md.mjs';
import { resolvePaths } from '../lib/paths.mjs';

const VERDICT_RE = /^TRIAGE:\s*(PASS|MARGINAL|FAIL|SKIP|EXPIRED|BROWSER)\s*\|\s*(\S+)\s*\|\s*([\d.]+)(?:\/5)?\s*\|\s*([^|]*)/;
const clean = (s) => s.replace(/[|;\n]/g, ',').trim();

export function parseResults(text) {
  const verdicts = new Map();
  for (const line of text.split('\n')) {
    const m = VERDICT_RE.exec(line);
    if (m) verdicts.set(m[2], { verdict: m[1], score: Number(m[3]).toFixed(1), reason: clean(m[4]) });
  }
  return verdicts;
}

export function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

const moved = (row, notes) => {
  const next = { ...row, checkbox: null, notes: new Map([...row.notes, ...notes]) };
  return formatRow(next);
};

// Mutates doc; returns counts. A row only moves once, and notes keep their order so diffs stay small.
export function applyVerdicts(doc, verdicts) {
  ensureSections(doc);
  const counts = { PASS: 0, MARGINAL: 0, FAIL: 0, SKIP: 0, EXPIRED: 0, BROWSER: 0, notFound: 0 };
  const found = new Set();
  const toFlagged = [];
  const toSkipped = [];
  for (const name of ['Pending', 'Flagged']) {
    const sec = getSection(doc, name);
    sec.lines = sec.lines.flatMap((line) => {
      const row = parseRow(line);
      const v = row && verdicts.get(row.url);
      if (!v) return [line];
      let { verdict } = v;
      const inFlagged = name === 'Flagged';
      if (inFlagged && verdict !== 'EXPIRED' && verdict !== 'BROWSER') return [line];
      // A JD that addresses the AI is never auto-queued: a person reads it first.
      if (verdict === 'PASS' && /^ANOMALY/i.test(v.reason)) verdict = 'ANOMALY';
      found.add(row.url);
      counts[verdict === 'ANOMALY' ? 'MARGINAL' : verdict]++;
      if (verdict === 'EXPIRED') {
        toSkipped.push(moved(row, [['triage', v.score], ['expired', v.reason]]));
        return [];
      }
      if (verdict === 'BROWSER') {
        if (Number(v.score) > 0) row.notes.set('triage', v.score);
        row.notes.set('reason', v.reason);
        if (inFlagged) {
          row.notes.set('flag', 'browser-jd');
          return [formatRow(row)];
        }
        toFlagged.push(moved(row, [['flag', 'browser-jd']]));
        return [];
      }
      row.notes.delete('triage');
      if (verdict === 'PASS' || verdict === 'MARGINAL') {
        row.notes.set('triage', v.score);
        row.notes.set('reason', v.reason);
        for (const c of v.reason.matchAll(/check=([a-z-]+)/g)) if (!row.notes.has('check')) row.notes.set('check', c[1]);
        return [formatRow(row)];
      }
      if (verdict === 'ANOMALY') toFlagged.push(moved(row, [['flag', 'review'], ['triage', v.score], ['reason', v.reason]]));
      else toSkipped.push(moved(row, [['triage', v.score], ['reason', v.reason]]));
      return [];
    });
  }
  appendLines(doc, 'Flagged', toFlagged);
  appendLines(doc, 'Skipped', toSkipped);
  counts.notFound = [...verdicts.keys()].filter((u) => !found.has(u)).length;
  return counts;
}

export async function applyTriageFile({ pipelineFile, verdicts, dryRun = false, lockOptions }) {
  return withLock(
    pipelineFile,
    () => {
      const doc = parsePipeline(readFileSync(pipelineFile, 'utf8'));
      const counts = applyVerdicts(doc, verdicts);
      if (!dryRun) writeAtomic(pipelineFile, serializePipeline(doc));
      return counts;
    },
    lockOptions,
  );
}

async function main() {
  const { command, positionals: rest, flags } = parseArgs(process.argv.slice(2), { flags: {} });
  const positionals = command === null ? rest : [command, ...rest];
  if (positionals.length !== 1) throw new UsageError('usage: apply-triage.mjs <results.txt>');
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const verdicts = parseResults(readFileSync(positionals[0], 'utf8'));
  try {
    const counts = await applyTriageFile({ pipelineFile: join(paths.dataDir, 'pipeline.md'), verdicts, dryRun: flags.dryRun });
    console.log(JSON.stringify(counts));
    return 0;
  } catch (err) {
    if (err instanceof LockTimeoutError) {
      console.error(`apply-triage: ${err.lockDir} is held by another process; pipeline.md left unchanged`);
      return 1;
    }
    throw err;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(main);
