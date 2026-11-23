// Stub for M-005: the daily autopilot.
export const OUTCOME_QUERY = 'newer_than:2d (application OR interview OR offer OR unfortunately OR "next steps")';

export async function approvedUnsent(dataDir) {
  throw new Error('not implemented');
}

export async function autopilot({ paths, today, deps = {} }) {
  throw new Error('not implemented');
}
