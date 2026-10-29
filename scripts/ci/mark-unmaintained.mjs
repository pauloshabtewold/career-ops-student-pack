#!/usr/bin/env node
// Marker stub: signatures only, bodies are not implemented yet.
export const STALE_DAYS = 60;

export function markUnmaintained({ ownersText, issues = [], today }) {
  return { text: ownersText, marked: [] };
}

console.error('mark-unmaintained.mjs: not implemented');
process.exitCode = 1;
