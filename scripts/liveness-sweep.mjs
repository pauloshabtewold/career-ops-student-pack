#!/usr/bin/env node
// Weekly liveness sweep of Pending rows, API-only: check-liveness runs with --no-fallback so no browser opens.
// Only EXPIRED results change the pipeline (moved to Skipped); 'uncertain' is never treated as closed.
// Usage: liveness-sweep.mjs [--root R] [--data-dir D] [--limit N] [--dry-run]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, runCli, isMain } from '../lib/args.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { parsePipeline, sectionRows } from '../lib/pipeline-md.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { applyTriageFile } from './apply-triage.mjs';
import { CEILINGS, effectiveLimits } from './budget.mjs';

const RESULT_RE = /\b(active|expired|uncertain)\b.*?(https?:\/\/[^\s|)\]>]+)/i;

// argv is everything after node; check-liveness may exit non-zero after printing results, so stdout is kept.
export const defaultRunner = async (argv, { cwd }) => {
  try {
    return { code: 0, stdout: execFileSync(process.execPath, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd }) };
  } catch (err) {
    return { code: err.status ?? 1, stdout: err.stdout?.toString() ?? '' };
  }
};

export function selectRows(doc, floor) {
  return sectionRows(doc, 'Pending')
    .map(({ row }) => row)
    .filter((row) => Number(row.notes.get('triage')) >= floor)
    .filter((row) => /^https?:\/\//i.test(row.url) && !/(^|\.)linkedin\.com$/i.test(new URL(row.url).hostname));
}

export function parseLiveness(stdout) {
  const out = [];
  for (const line of stdout.split('\n')) {
    const m = RESULT_RE.exec(line);
    if (m) out.push({ status: m[1].toLowerCase(), url: m[2] });
  }
  return out;
}

export async function sweep({ root, dataDir, config, limit, dryRun, runner = defaultRunner }) {
  const { values } = effectiveLimits(config);
  const floor = Math.max(CEILINGS.score_floor.value, values.score_floor);
  const batchSize = values.liveness_batch;
  const pipelineFile = join(dataDir, 'pipeline.md');
  let rows = selectRows(parsePipeline(readFileSync(pipelineFile, 'utf8')), floor);
  if (limit) rows = rows.slice(0, limit);
  const expired = [];
  let uncertain = 0;
  const tmp = mkdtempSync(join(tmpdir(), 'liveness-'));
  try {
    for (let i = 0; i < rows.length; i += batchSize) {
      const file = join(tmp, `batch-${i}.txt`);
      writeFileSync(file, `${rows.slice(i, i + batchSize).map((r) => r.url).join('\n')}\n`);
      const res = await runner(['check-liveness.mjs', '--no-fallback', '--no-record', '--file', file], { cwd: root });
      for (const r of parseLiveness(res.stdout)) {
        if (r.status === 'expired') expired.push(r.url);
        else if (r.status === 'uncertain') uncertain++;
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const verdicts = new Map(expired.map((url) => [url, { verdict: 'EXPIRED', score: '0.0', reason: 'liveness sweep: posting closed' }]));
  const counts = expired.length ? await applyTriageFile({ pipelineFile, verdicts, dryRun }) : null;
  return { checked: rows.length, expired: expired.length, uncertain, counts };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { limit: 'int' } });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const config = await loadStudentConfig({ root: paths.root });
  if (!config) throw new Error('config/student.yml is missing: start the personalization interview first');
  const res = await sweep({ root: paths.root, dataDir: paths.dataDir, config, limit: flags.limit, dryRun: flags.dryRun });
  console.log(JSON.stringify(res));
  return 0;
}

if (isMain(import.meta.url)) await runCli(main);
