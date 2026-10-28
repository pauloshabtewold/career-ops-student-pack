// Shared fixtures for the budget tests: scratch packs with a config and an action log, a CLI runner
// that pins the clock through --today (local noon), and row builders matching the action-log columns.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTsv, appendTsv } from '../../lib/tsv.mjs';
import { zonedInstant } from '../../lib/clock.mjs';

export const PACK_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const BUDGET_CLI = join(PACK_ROOT, 'scripts', 'budget.mjs');
export const LOG_HEADER = ['ts', 'date', 'session', 'action', 'target', 'company', 'approval', 'detail'];
export const TZ = 'America/Chicago';
export const DAY = '2026-03-10';

const pad = (n) => String(n).padStart(2, '0');

export function shiftDate(dateText, days) {
  const [y, m, d] = dateText.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

// Instant at hh:mm local (America/Chicago) on a date.
export function at(dateText, hour = 12, minute = 0, second = 0) {
  return new Date(zonedInstant(dateText, TZ, hour, minute).getTime() + second * 1000);
}

// Action-log row as read back from data/action-log.tsv (all cells are strings).
export function row({ ts, action, target = '', company = '', session = 's1', approval = '', detail = '' }) {
  const when = ts instanceof Date ? ts : new Date(ts);
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(when);
  return { ts: when.toISOString(), date: local, session, action, target, company, approval, detail };
}

// LinkedIn-style row with the gap already elapsed: next_allowed is 60 seconds after the row.
export function liRow(o) {
  const when = o.ts instanceof Date ? o.ts : new Date(o.ts);
  return row({ ...o, ts: when, detail: o.detail ?? `next_allowed=${new Date(when.getTime() + 60000).toISOString()}` });
}

export function many(n, make) {
  return Array.from({ length: n }, (_, i) => make(i));
}

export function baseConfig(over = {}) {
  return {
    timezone: TZ,
    switches: { outreach: 'on', handshake: 'on', submission: 'agent', ...(over.switches ?? {}) },
    linkedin_tier: 'free',
    score_floor: 3.5,
    limits: {},
    employer_policies: [],
    ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'switches')),
  };
}

export function ceilingEntry(ceilings, name) {
  if (name in ceilings) return ceilings[name];
  const key = Object.keys(ceilings).find((k) => k.endsWith(`.${name}`));
  return key ? ceilings[key] : undefined;
}

export async function makePack({ config = '', rows = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pack-budget-'));
  mkdirSync(join(root, 'config'));
  mkdirSync(join(root, 'data'));
  writeFileSync(join(root, 'config', 'student.yml'), `timezone: ${TZ}\n${config}`);
  const pack = {
    root,
    dataDir: join(root, 'data'),
    logFile: join(root, 'data', 'action-log.tsv'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
  if (rows.length) await appendTsv(pack.logFile, LOG_HEADER, rows);
  return pack;
}

export async function readLog(pack) {
  return existsSync(pack.logFile) ? (await readTsv(pack.logFile)).rows : [];
}

export function run(pack, argv, { today = DAY } = {}) {
  const r = spawnSync(process.execPath, [BUDGET_CLI, ...argv, '--root', pack.root, '--data-dir', pack.dataDir, '--today', today], {
    cwd: PACK_ROOT,
    encoding: 'utf8',
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
