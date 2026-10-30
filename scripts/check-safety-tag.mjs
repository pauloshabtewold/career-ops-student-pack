#!/usr/bin/env node
// Safety-tag gate: a tag diff may only tighten budget ceilings or turn defaults off.
// Usage: check-safety-tag.mjs <tag> | <base> <head>. Exit 0 pass, 1 fail with one line per violation, 2 usage.
// The one-argument form picks the base itself (pickBase); the two-argument form compares the refs it is given.
// The comparison itself is checkSafetyDiff in lib/safety-diff.mjs, which update.mjs also uses.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runCli, UsageError, isMain } from '../lib/args.mjs';
import { gitRunner } from '../lib/run.mjs';
import { checkSafetyDiff } from '../lib/safety-diff.mjs';
import { compare } from '../lib/semver.mjs';

const defaultPackRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// Release tags are compared by version, as update.mjs does, never by creation date.
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;
const BASE_NOTE = { previous: 'nearest earlier tag', baseline: 'baseline: first release tag' };

// Thrown by pickBase when no v release tag exists. The message goes to the maintainer unchanged.
export class NoBaselineError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NoBaselineError';
  }
}

// A safety tag is applied on top of the release a student runs, so its nearest earlier release or safety tag is the
// diff they receive. With no earlier tag the first release is the only realistic baseline: a root-commit diff would
// flag every file as not allowed.
// Returns { base, reason }: reason 'previous' is the nearest ancestor vMAJOR.MINOR.PATCH or safety tag of <tag>^,
// 'baseline' is the lowest-version v tag. Throws NoBaselineError when neither exists. runner is injectable for tests.
export function pickBase({ packRoot = defaultPackRoot, tag, runner = gitRunner }) {
  // A glob cannot say vMAJOR.MINOR.PATCH, so a nearer non-semver v tag (v1, v0.2-beta) is excluded and git describe
  // asked again. Each round excludes one more tag, so the loop ends when describe runs out of ancestors.
  const exclude = [];
  try {
    for (;;) {
      const args = ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', '--match', 'safety-*', ...exclude.flatMap((t) => ['--exclude', t]), `${tag}^`];
      const previous = runner(args, { cwd: packRoot }).trim();
      if (!previous) break;
      if (previous.startsWith('safety-') || RELEASE_TAG.test(previous)) return { base: previous, reason: 'previous' };
      exclude.push(previous);
    }
  } catch (err) {
    // git describe exits 128 with "No names found" or "No tags can describe" (depending on the git version) when no
    // ancestor tag exists, and with "Not a valid object name" when the tag sits on the root commit (<tag>^ has no
    // parent); the baseline applies then. Any other failure surfaces.
    const stderr = String(err && err.stderr);
    const noAncestor = err && err.status === 128 && ['No names found', 'No tags can describe', 'Not a valid object name'].some((m) => stderr.includes(m));
    if (!noAncestor) throw err;
  }
  // Safety tags and non-semver v tags are excluded: the baseline must be a release a student can be running.
  const releases = runner(['tag', '--list', 'v[0-9]*'], { cwd: packRoot })
    .split('\n')
    .map((t) => t.trim())
    .filter((t) => RELEASE_TAG.test(t))
    .sort((a, b) => compare(a.slice(1), b.slice(1)));
  if (!releases.length) throw new NoBaselineError('no v release tag exists, so a safety tag has nothing to compare with. Maintainer: cut the first release (see docs/maintenance.md, Releases), then cut the safety tag from it.');
  return { base: releases[0], reason: 'baseline' };
}

// Prints one line per violation of the base..head diff, then returns the exit code (0 ok, 1 violations).
async function verdict(base, head) {
  const res = await checkSafetyDiff({ base, head });
  for (const v of res.violations) console.log(v);
  if (res.ok) console.log('safety tag ok');
  return res.ok ? 0 : 1;
}

// One ref: pick the base, name it, compare. Two refs: compare as given. A missing baseline prints the maintainer
// message and exits 1 with that message only.
async function main() {
  const { command, positionals } = parseArgs(process.argv.slice(2), { common: false, flags: {} });
  const refs = command ? [command, ...positionals] : [];
  if (refs.length === 2) return verdict(refs[0], refs[1]);
  if (refs.length !== 1) throw new UsageError('usage: check-safety-tag.mjs <tag> | <base> <head>');
  let picked;
  try {
    picked = pickBase({ tag: refs[0] });
  } catch (err) {
    if (!(err instanceof NoBaselineError)) throw err;
    console.error(err.message);
    return 1;
  }
  console.log(`comparing ${refs[0]} with ${picked.base} (${BASE_NOTE[picked.reason]})`);
  return verdict(picked.base, refs[0]);
}

if (isMain(import.meta.url)) await runCli(main);
