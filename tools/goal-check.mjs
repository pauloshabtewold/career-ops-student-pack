#!/usr/bin/env node
// Maintainer-only goal-check; implemented in M-004.
export function formatGoalReport({ results, meta }) {
  throw new Error('formatGoalReport: not implemented');
}

if (process.argv[1] && process.argv[1].endsWith('goal-check.mjs')) {
  console.error('goal-check: not implemented');
  process.exit(70);
}
