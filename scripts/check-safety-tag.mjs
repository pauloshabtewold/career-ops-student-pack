#!/usr/bin/env node
// Safety-tag gate: a tag diff may only tighten budget ceilings or turn defaults off.
// Usage: check-safety-tag.mjs <tag> | <base> <head>. Exit 0 pass, 1 fail with one line per violation, 2 usage.
// The one-argument form picks the base itself (pickBase); the two-argument form compares the refs it is given.
// Also exported (checkSafetyDiff) for update.mjs.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import * as yaml from 'js-yaml';
import { parseArgs, runCli, UsageError } from '../lib/args.mjs';
import { compare } from '../lib/semver.mjs';

const defaultPackRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const ALLOWED_FILES = new Set(['scripts/budget.mjs', 'compat.json', 'templates/student.defaults.yml', 'AGENTS.student.md']);
const allowedFile = (f) => ALLOWED_FILES.has(f) || /^modes\/[^/]+\.md$/.test(f);

// Higher rank = more permissive. A default may move down but never up.
const RANKS = {
  'switches.outreach': ['off', 'drafts', 'on'],
  'switches.handshake': ['off', 'on'],
  'switches.submission': ['user', 'agent'],
  automation: ['manual', 'scheduled-discovery', 'scheduled-discovery-plus-triage'],
};

// Release tags are compared by version, as update.mjs does, never by creation date.
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;
const BASE_NOTE = { previous: 'nearest earlier tag', baseline: 'baseline: first release tag' };

const LOAD_SCRIPT = 'const m = await import(process.argv[1]); process.stdout.write(JSON.stringify(m.CEILINGS));';

const gitRunner = (args, { cwd }) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

const toComparable = (v) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : v);

async function loadCeilings(packRoot, ref, run) {
  const source = run(['show', `${ref}:scripts/budget.mjs`], { cwd: packRoot });
  // The temp file sits beside the real one so the module's relative imports resolve inside this checkout.
  const tmp = join(packRoot, 'scripts', `.budget-check-${randomUUID()}.mjs`);
  writeFileSync(tmp, source);
  try {
    // A child process loads the ref's module so its top-level code never runs inside this one.
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', LOAD_SCRIPT, pathToFileURL(tmp).href], { cwd: packRoot, encoding: 'utf8' });
    return JSON.parse(out);
  } finally {
    rmSync(tmp, { force: true });
  }
}

const show = (run, packRoot, ref, file) => {
  try {
    return run(['show', `${ref}:${file}`], { cwd: packRoot });
  } catch {
    return null;
  }
};

function compareCeilings(base, head, violations) {
  for (const [name, b] of Object.entries(base)) {
    const h = head[name];
    if (!h) {
      violations.push(`ceiling removed: ${name}`);
      continue;
    }
    if (h.tighten !== b.tighten) violations.push(`ceiling direction changed: ${name} (${b.tighten} -> ${h.tighten})`);
    const [bv, hv] = [toComparable(b.value), toComparable(h.value)];
    if (typeof bv === 'number' && typeof hv === 'number') {
      if (b.tighten === 'down' && hv > bv) violations.push(`max ceiling raised: ${name} ${b.value} -> ${h.value}`);
      if (b.tighten === 'up' && hv < bv) violations.push(`min ceiling lowered: ${name} ${b.value} -> ${h.value}`);
    } else if (!isDeepStrictEqual(b.value, h.value)) {
      violations.push(`ceiling changed beyond comparison: ${name}`);
    }
  }
}

function compareDefaults(baseText, headText, violations) {
  const read = (t) => (t && t.trim() ? yaml.load(t) ?? {} : {});
  const [b, h] = [read(baseText), read(headText)];
  const dig = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  for (const [path, order] of Object.entries(RANKS)) {
    const [from, to] = [dig(b, path), dig(h, path)];
    if (to === undefined || from === to) continue;
    const [fi, ti] = [order.indexOf(from), order.indexOf(to)];
    if (ti < 0 || (fi >= 0 && ti > fi)) violations.push(`default turned on: ${path} ${from ?? '(unset)'} -> ${to}`);
  }
}

function compareCompat(baseText, headText, violations) {
  const strip = (t) => {
    const o = t ? JSON.parse(t) : {};
    delete o.budgetSha256;
    return o;
  };
  if (!isDeepStrictEqual(strip(baseText), strip(headText))) violations.push('compat.json changed outside budgetSha256');
}

export async function checkSafetyDiff({ packRoot = defaultPackRoot, base, head, runner = gitRunner }) {
  const violations = [];
  const out = runner(['diff', '--name-only', '--no-renames', '-z', base, head], { cwd: packRoot });
  const changed = out.split('\0').filter(Boolean);
  for (const f of changed) if (!allowedFile(f)) violations.push(`file not allowed in a safety tag: ${f}`);
  if (changed.includes('scripts/budget.mjs')) {
    const [b, h] = [await loadCeilings(packRoot, base, runner), await loadCeilings(packRoot, head, runner)];
    compareCeilings(b, h, violations);
  }
  if (changed.includes('templates/student.defaults.yml')) {
    compareDefaults(show(runner, packRoot, base, 'templates/student.defaults.yml'), show(runner, packRoot, head, 'templates/student.defaults.yml'), violations);
  }
  if (changed.includes('compat.json')) {
    compareCompat(show(runner, packRoot, base, 'compat.json'), show(runner, packRoot, head, 'compat.json'), violations);
  }
  return { ok: violations.length === 0, violations };
}

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

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) await runCli(main);
