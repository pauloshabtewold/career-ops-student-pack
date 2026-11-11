// Board errors from one scan, for the daily digest. scan.mjs records the error count in data/scan-runs.tsv and the board
// name plus reason in data/portal-health.tsv (timestamp, company, status), and keeps no other error text. Callers count
// both files' lines before the scan and pass them back, so only this scan's rows are read.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const OK_STATUS = new Set(['reachable', 'empty']);

const rowsOf = (file) => {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  return lines.slice(1).map((l) => l.split('\t'));
};

export const scanFileCounts = (dataDir) => ({
  runs: rowsOf(join(dataDir, 'scan-runs.tsv')).length,
  health: rowsOf(join(dataDir, 'portal-health.tsv')).length,
});

// null when the scan recorded no errors.
export function scanErrorLine(dataDir, before) {
  const runFile = join(dataDir, 'scan-runs.tsv');
  const header = existsSync(runFile) ? readFileSync(runFile, 'utf8').split('\n')[0].split('\t') : [];
  const col = header.indexOf('errors');
  const errors = col < 0 ? 0 : rowsOf(runFile).slice(before.runs).reduce((n, r) => n + (Number(r[col]) || 0), 0);
  if (!errors) return null;
  const failed = new Map();
  for (const [, company, status] of rowsOf(join(dataDir, 'portal-health.tsv')).slice(before.health)) {
    if (company && status && !OK_STATUS.has(status)) failed.set(company, status);
  }
  if (!failed.size) return `scan: ${errors} board error(s); the board names were not recorded`;
  const list = [...failed].map(([name, status]) => `${name} (${status})`).join(', ');
  return `scan: ${failed.size} board${failed.size === 1 ? '' : 's'} failed: ${list}`;
}
