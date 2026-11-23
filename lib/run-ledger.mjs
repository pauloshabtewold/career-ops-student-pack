// Stub for M-005: the run ledger (data/student-runs.tsv start/end/kind rows) and missed daily slots.
export const RUNS_FILE = 'student-runs.tsv';
export const MAX_LISTED = 7;

export async function readRuns(dataDir) {
  throw new Error('not implemented');
}

export const recordRun = (dataDir, row) => {
  throw new Error('not implemented');
};

export function lastSuccess(rows, kind) {
  throw new Error('not implemented');
}

export function missedSlots({ lastSuccess: last, now, tz, kind = 'daily' }) {
  throw new Error('not implemented');
}

export function missedLine({ dates, count }) {
  throw new Error('not implemented');
}
