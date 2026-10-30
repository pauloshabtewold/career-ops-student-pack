#!/usr/bin/env node
// Pilot report: one line per ISO week of counts only. It reads data/action-log.tsv, data/applications.md and,
// when present, data/student-cost.tsv. Company names, URLs and message text are never printed, and nothing is sent.
// Usage: pilot-report.mjs [--root R] [--data-dir D] [--today YYYY-MM-DD]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, runCli, isMain } from '../lib/args.mjs';
import { readActionLog } from '../lib/action-log.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { readTsv } from '../lib/tsv.mjs';

const LOG_METRICS = {
  'linkedin.connect': 'requests',
  'linkedin.accept': 'accepts',
  'linkedin.message': 'messages',
  'linkedin.warning': 'warnings',
  'handshake.warning': 'warnings',
  'apply.submit': 'submits',
};
const RESPONDED = /^(respond|assess|interview|offer|reject)/i;
const COUNT_KEYS = ['requests', 'accepts', 'messages', 'warnings', 'submits', 'responses', 'assessments', 'interviews', 'offers'];

export function isoWeek(dateText) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateText ?? '');
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function trackerRows(text) {
  let dateAt = 1;
  let statusAt = 5;
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (/^#$/.test(cells[0])) {
      const lower = cells.map((c) => c.toLowerCase());
      dateAt = lower.indexOf('date') === -1 ? 1 : lower.indexOf('date');
      statusAt = lower.indexOf('status') === -1 ? 5 : lower.indexOf('status');
      continue;
    }
    if (/^\d+$/.test(cells[0])) out.push({ date: cells[dateAt] ?? '', status: cells[statusAt] ?? '' });
  }
  return out;
}

function bucket(weeks, week) {
  if (!weeks.has(week)) weeks.set(week, Object.fromEntries(COUNT_KEYS.map((k) => [k, 0])));
  return weeks.get(week);
}

function tallyTracker(text, weeks) {
  for (const { date, status } of trackerRows(text)) {
    const week = isoWeek(date);
    if (!week) continue;
    const b = bucket(weeks, week);
    if (RESPONDED.test(status)) b.responses++;
    if (/^assess/i.test(status)) b.assessments++;
    else if (/^interview/i.test(status)) b.interviews++;
    else if (/^offer/i.test(status)) b.offers++;
  }
}

function addCosts(rows, col, weeks, cost) {
  for (const r of rows) {
    const week = isoWeek(r.date);
    const n = Number(r[col]);
    if (!week || !Number.isFinite(n)) continue;
    cost.set(week, (cost.get(week) ?? 0) + n);
    bucket(weeks, week);
  }
}

async function tallyCost(costFile, weeks) {
  const cost = new Map();
  if (!existsSync(costFile)) return cost;
  const { header, rows } = await readTsv(costFile);
  const col = ['cost_usd', 'cost', 'usd'].find((c) => header.includes(c));
  if (col) addCosts(rows, col, weeks, cost);
  return cost;
}

export async function pilotReport({ dataDir }) {
  const weeks = new Map();
  for (const row of await readActionLog(join(dataDir, 'action-log.tsv'))) {
    const key = LOG_METRICS[row.action];
    const week = isoWeek(row.date || row.ts);
    if (key && week) bucket(weeks, week)[key]++;
  }
  const appsFile = join(dataDir, 'applications.md');
  if (existsSync(appsFile)) tallyTracker(readFileSync(appsFile, 'utf8'), weeks);
  const cost = await tallyCost(join(dataDir, 'student-cost.tsv'), weeks);
  return [...weeks.keys()].sort().map((week) => {
    const b = weeks.get(week);
    const rate = b.requests ? `${((b.accepts / b.requests) * 100).toFixed(1)}%` : 'n/a';
    const parts = [week, `requests=${b.requests}`, `accepts=${b.accepts}`, `accept_rate=${rate}`];
    for (const k of COUNT_KEYS.slice(2)) parts.push(`${k}=${b[k]}`);
    if (cost.size) parts.push(`model_cost_usd=${(cost.get(week) ?? 0).toFixed(2)}`);
    return parts.join(' ');
  });
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: {} });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const lines = await pilotReport({ dataDir: paths.dataDir });
  console.log(lines.length ? lines.join('\n') : 'no activity recorded yet');
  return 0;
}

if (isMain(import.meta.url)) await runCli(main);
