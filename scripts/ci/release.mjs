#!/usr/bin/env node
// Release helper stub: signatures only, bodies are not implemented yet.
export const CHANGELOG_SUBJECT_PREFIX = 'Update CHANGELOG.md for ';
export const WITHHELD_NOTE = '(subject withheld: failed the personal-data check)';

export function nextVersion({ tags, packageVersion, bump = 'minor' }) {
  return undefined;
}

export function releaseNotes(commits) {
  return undefined;
}

export function planRelease({ packRoot, bump = 'minor', runner } = {}) {
  return undefined;
}

export function ciGreen({ runs, sha }) {
  return undefined;
}

export function syncChangelog({ text, releases }) {
  return undefined;
}

console.error('release.mjs: not implemented');
process.exitCode = 1;
