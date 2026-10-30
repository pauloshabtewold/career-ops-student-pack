// Stub: the student's triage budget and usage ledger. Bodies arrive with the implementation.
export const CHUNK_ROWS = 20;
export const DEFAULT_DAILY = 20;
export const DEFAULT_FIRST_RUN = 60;
export const ALL = 'all';
export const USAGE_FILE = 'triage-usage.tsv';
export const USAGE_HEADER = ['date', 'source', 'rows', 'outcome'];
export const SOURCES = ['scheduled', 'session', 'first-run'];
export const OUTCOMES = ['ok', 'failed'];
const todo = () => {
  throw new Error('not implemented');
};
export function parseBudgetValue(text) {
  return todo(text);
}
export function resolveTriageBudget(config = {}) {
  return todo(config);
}
export const rowsLeft = (budget, used) => todo(budget, used);
export async function appendTriageUsage(dataDir, { date, source, rows, outcome = 'ok' }) {
  return todo(dataDir, date, source, rows, outcome);
}
export function readTriageUsage(dataDir, today) {
  return todo(dataDir, today);
}
export function appendDigestLines({ dataDir, today, heading, lines }) {
  return todo(dataDir, today, heading, lines);
}
