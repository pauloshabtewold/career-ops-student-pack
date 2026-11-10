// Stub signatures for the job-source research script; the implementation replaces every body.
export const MIN_MATCHED_ROWS = 5;
export const RESEARCH_LIMITS = Object.freeze({ max_boards: 20, max_lists: 15, deadline_ms: 5 * 60 * 1000 });

export class ResearchError extends Error {}

export function boardFromUrl(_url) {
  return null;
}

export function readCandidates(_file) {
  return {};
}

export async function research({ paths, today, candidates, fetch, sleep, now, upstream, dryRun = false, noSearch = false, preset } = {}) {
  void [paths, today, candidates, fetch, sleep, now, upstream, dryRun, noSearch, preset];
  return {};
}

export function summaryLines({ added, skipped, cost }) {
  void [added, skipped, cost];
  return [];
}

export async function main(_argv = process.argv.slice(2), _deps = {}) {
  return undefined;
}
