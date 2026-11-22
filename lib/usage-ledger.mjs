// data/usage-ledger.tsv: one row per pipeline step with the real tokens the agent reported. Steps that use no model
// write a zero-token row with model none, so every feature has rows and a token report can show "no AI cost" from data
// rather than from a claim. data/triage-usage.tsv keeps its own format; this ledger sits beside it.
import { join } from 'node:path';
import { appendTsv, readTsv } from './tsv.mjs';

export const LEDGER_FILE = 'usage-ledger.tsv';
export const LEDGER_HEADER = Object.freeze(['date', 'step', 'feature', 'agent', 'model', 'rows', 'input', 'cache_read', 'cache_write', 'output', 'source']);
export const UNMEASURED = 'unmeasured';
const TOKEN_COLUMNS = ['input', 'cache_read', 'cache_write', 'output'];

// usage null or undefined means the agent answered without usage, which is recorded as unmeasured, never as zero.
export function ledgerRow({ date, step, feature, agent = 'none', model = 'none', rows = 0, usage, source = 'scheduled' }) {
  const tokens = Object.fromEntries(TOKEN_COLUMNS.map((k) => [k, usage ? Number(usage[k] ?? 0) : UNMEASURED]));
  return { date, step, feature, agent, model, rows: String(rows), ...tokens, source };
}

export const zeroRow = ({ date, step, feature, rows = 0, source = 'scheduled' }) =>
  ledgerRow({ date, step, feature, rows, source, usage: { input: 0, cache_read: 0, cache_write: 0, output: 0 } });

// Appends one row or many; rows already in ledger shape pass through, others go through ledgerRow.
export async function append(dataDir, rowOrRows) {
  const rows = (Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]).map((r) => (r.step && 'input' in r ? r : ledgerRow(r)));
  await appendTsv(join(dataDir, LEDGER_FILE), [...LEDGER_HEADER], rows);
}

// Rows with date inside [from, to] (YYYY-MM-DD, either end optional).
export async function read(dataDir, { from, to } = {}) {
  const { rows } = await readTsv(join(dataDir, LEDGER_FILE));
  return rows.filter((r) => (!from || r.date >= from) && (!to || r.date <= to));
}

export const tokensOf = (row) => TOKEN_COLUMNS.reduce((n, k) => n + (row[k] === UNMEASURED ? 0 : Number(row[k] || 0)), 0);
