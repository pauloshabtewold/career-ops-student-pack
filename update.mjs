#!/usr/bin/env node
// Updates the pack and upstream. Run as `node student/update.mjs`; session start runs it with --safety-only.
// Order: integrity check, safety tag, newest release tag, plugin re-copy, upstream update, integrity check.
// The pack enforces the upstream version range itself: upstream's dismiss file does not gate `apply`, and
// `check --force` bypasses it, so this script never passes --force and never applies a version outside compat.json.
// Usage: update.mjs [--root R] [--offline] [--dry-run] [--safety-only]
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { refreshOverride } from './lib/agents-override.mjs';
import { parseArgs, runCli, isMain } from './lib/args.mjs';
import { verifyAndRestore } from './lib/integrity.mjs';
import { resolvePaths } from './lib/paths.mjs';
import { checkSafetyDiff } from './lib/safety-diff.mjs';
import { inRange } from './lib/semver.mjs';
import { oneLine } from './lib/text.mjs';
import { createUpstream, defaultRunner } from './lib/upstream.mjs';

const LOCAL_COMMITS = 'student/ has local commits; pack update skipped (fork-and-edit, see README)';
// A blocked network must fail in seconds, not hang on a credential prompt: 20 s covers a slow first fetch and
// GIT_TERMINAL_PROMPT=0 makes git give up rather than ask for a password nobody is there to type.
const FETCH_OPTS = { timeout: 20000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } };

const git = (runner, packRoot, args, opts) => (opts ? runner('git', ['-C', packRoot, ...args], opts) : runner('git', ['-C', packRoot, ...args]));

function newestTag(runner, packRoot, pattern) {
  const out = git(runner, packRoot, ['tag', '--list', pattern, '--sort=-version:refname']);
  return out.split('\n').map((l) => l.trim()).filter(Boolean)[0] ?? null;
}

function isContained(runner, packRoot, tag) {
  try {
    git(runner, packRoot, ['merge-base', '--is-ancestor', tag, 'HEAD']);
    return true;
  } catch {
    return false;
  }
}

// Capabilities a user consented to when enabling a plugin; a change sends the decision back to the user.
export function consentSurface(manifestFile) {
  if (!existsSync(manifestFile)) return null;
  const m = JSON.parse(readFileSync(manifestFile, 'utf8'));
  return JSON.stringify({ hooks: [...(m.hooks ?? [])].sort(), allowedHosts: [...(m.allowedHosts ?? [])].sort(), requiredEnv: [...(m.requiredEnv ?? [])].sort(), jobPostings: Boolean(m.jobPostings) });
}

function enabledPlugins(root) {
  const file = join(root, 'config', 'plugins.yml');
  if (!existsSync(file)) return new Set();
  const doc = yaml.load(readFileSync(file, 'utf8')) ?? {};
  return new Set(Object.entries(doc.plugins ?? {}).filter(([, v]) => v?.enabled === true).map(([id]) => id));
}

export function syncPlugins({ root, packRoot, upstream, dryRun, say }) {
  const src = join(packRoot, 'plugins');
  if (!existsSync(src)) return;
  const enabled = enabledPlugins(root);
  for (const id of readdirSync(src).filter((d) => existsSync(join(src, d, 'manifest.json')))) {
    const dest = join(root, 'plugins.local', id);
    const before = consentSurface(join(dest, 'manifest.json'));
    const after = consentSurface(join(src, id, 'manifest.json'));
    if (!dryRun) {
      rmSync(dest, { recursive: true, force: true });
      cpSync(join(src, id), dest, { recursive: true });
    }
    say(`plugin ${id}: copied`);
    if (!enabled.has(id)) continue;
    // A moved pin silently stops a plugin, so trust is restored only when the consent surface is unchanged.
    if (before === after) {
      if (!dryRun) upstream.pluginsTrust(id);
      say(`plugin ${id}: trusted again`);
    } else say(`re-enable ${id}: its permissions changed`);
  }
}

function fastForward({ runner, packRoot, dryRun, say }, tag, label) {
  if (dryRun) {
    say(`would fast-forward to ${label} ${tag}`);
    return true;
  }
  try {
    git(runner, packRoot, ['merge', '--ff-only', tag]);
    say(`pack: updated to ${tag}`);
    return true;
  } catch {
    say(LOCAL_COMMITS);
    return false;
  }
}

// Returns true when a fast-forward failed because the pack has local commits.
async function updatePack({ packRoot, runner, offline, dryRun, safetyOnly, say }) {
  const env = { runner, packRoot, dryRun, say };
  let localCommits = false;
  if (!offline && !dryRun) {
    try {
      git(runner, packRoot, ['fetch', '--tags'], FETCH_OPTS);
    } catch {
      say('update check skipped (offline)');
    }
  }
  const safety = newestTag(runner, packRoot, 'safety-*');
  if (safety && !isContained(runner, packRoot, safety)) {
    const verdict = await checkSafetyDiff({ packRoot, base: 'HEAD', head: safety });
    if (!verdict.ok) say(`pack: refused ${safety}: ${verdict.violations[0]}`);
    else if (!fastForward(env, safety, 'safety release')) localCommits = true;
  }
  if (!safetyOnly && !localCommits) {
    const release = newestTag(runner, packRoot, 'v*');
    if (release && !isContained(runner, packRoot, release)) {
      if (!fastForward(env, release, 'release')) localCommits = true;
    } else say(`pack: up to date${release ? ` (${release})` : ''}`);
  }
  return localCommits;
}

function applyUpstream({ status, up, compat, dryRun, say }) {
  const remote = status.remote ?? status.latest ?? status.version;
  if (inRange(remote, compat.upstream)) {
    if (!dryRun) up.updateApply();
    say(`upstream: updated to ${remote}`);
    return;
  }
  if (!dryRun) up.updateDismiss(remote);
  say(`upstream ${remote} is outside what this pack supports (${compat.upstream.min} to ${compat.upstream.max}); not applied`);
}

function updateUpstream({ up, packRoot, dryRun, say }) {
  const compat = JSON.parse(readFileSync(join(packRoot, 'compat.json'), 'utf8'));
  let status = null;
  try {
    status = up.updateCheck();
  } catch {
    say('upstream: update check failed');
  }
  if (status?.status === 'update-available') applyUpstream({ status, up, compat, dryRun, say });
  else if (status) say(`upstream: up to date (${up.version()})`);
}

export async function runUpdate({ root, packRoot, offline = false, dryRun = false, safetyOnly = false, runner = defaultRunner, upstream }) {
  const lines = [];
  const say = (l) => lines.push(l);
  const up = upstream ?? createUpstream({ root, runner });

  const first = verifyAndRestore({ packRoot, runner });
  if (first.restored || !first.ok) say(first.message);

  const localCommits = await updatePack({ packRoot, runner, offline, dryRun, safetyOnly, say });
  if (!localCommits) syncPlugins({ root, packRoot, upstream: up, dryRun, say });
  if (!offline && !safetyOnly) updateUpstream({ up, packRoot, dryRun, say });

  // Refreshed after every step that can replace AGENTS.md or AGENTS.student.md. Session start runs this with safetyOnly
  // and refreshes and reports the override itself, so only an explicit update touches it here.
  if (!safetyOnly) {
    try {
      const override = refreshOverride({ root, packRoot, dryRun });
      if (override.line) say(override.line);
      else if (override.status === 'created' || override.status === 'updated') say(dryRun ? 'AGENTS.override.md: would refresh' : 'AGENTS.override.md: refreshed');
    } catch (err) {
      say(`AGENTS.override.md not refreshed (${oneLine(err.message) || 'write failed'})`);
    }
  }

  const last = verifyAndRestore({ packRoot, runner });
  if (last.restored || !last.ok) say(last.message);
  return { lines, code: localCommits ? 1 : 0 };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { offline: 'boolean', 'safety-only': 'boolean' } });
  const paths = resolvePaths({ root: flags.root });
  const res = await runUpdate({ root: paths.root, packRoot: paths.packRoot, offline: flags.offline, dryRun: flags.dryRun, safetyOnly: flags.safetyOnly });
  for (const l of res.lines) console.log(l);
  return res.code;
}

if (isMain(import.meta.url)) await runCli(main);
