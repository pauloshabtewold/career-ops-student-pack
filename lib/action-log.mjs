// data/action-log.tsv: one row per budgeted action, refusal, warning or clamp. Rows are append-only and
// written through lib/tsv.mjs under the directory lock so concurrent sessions never interleave a line.
import { readTsv, appendTsv } from './tsv.mjs';

export const LOG_HEADER = Object.freeze(['ts', 'date', 'session', 'action', 'target', 'company', 'approval', 'detail']);

// Returns typed rows (ms = parsed ts) ordered as written; since (Date or ms) drops older rows.
export async function readActionLog(file, { since } = {}) {
  const { rows } = await readTsv(file);
  const floor = since instanceof Date ? since.getTime() : since;
  return rows
    .map((r) => ({ ...r, ms: Date.parse(r.ts) }))
    .filter((r) => Number.isFinite(r.ms) && (floor === undefined || r.ms >= floor));
}

export async function appendAction(file, rowOrRows) {
  const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
  if (rows.length) await appendTsv(file, [...LOG_HEADER], rows);
}

// Reads one key from a detail cell such as "note=100;next_allowed=2026-03-10T17:00:00.000Z".
export function detailValue(detail, key) {
  const m = new RegExp(`(?:^|[;\\s])${key}=([^;\\s]*)`).exec(detail ?? '');
  return m ? m[1] : undefined;
}
