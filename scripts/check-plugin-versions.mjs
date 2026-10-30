#!/usr/bin/env node
// Upstream pins each plugin by a hash of its files, and a changed plugin without a new manifest version is skipped
// silently. This check fails when plugin files changed since a base ref but the manifest version did not increase.
// Usage: check-plugin-versions.mjs <base-ref> [--pack-root P]    exit 0 ok, 1 offending plugins, 2 usage
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { compare } from '../lib/semver.mjs';
import { defaultRunner } from '../lib/upstream.mjs';

export function checkPluginVersions({ packRoot, base, runner = defaultRunner }) {
  const changed = runner('git', ['-C', packRoot, 'diff', '--name-only', base, '--', 'plugins']).split('\n').filter(Boolean);
  const ids = [...new Set(changed.map((f) => f.split('/')[1]).filter(Boolean))];
  const offenders = [];
  for (const id of ids) {
    let before = null;
    try {
      before = JSON.parse(runner('git', ['-C', packRoot, 'show', `${base}:plugins/${id}/manifest.json`])).version;
    } catch {
      continue; // a plugin new since the base has nothing to compare against
    }
    let now = null;
    try {
      now = JSON.parse(readFileSync(join(packRoot, 'plugins', id, 'manifest.json'), 'utf8')).version;
    } catch {
      continue; // a removed plugin is not copied anywhere
    }
    if (compare(now, before) <= 0) offenders.push({ id, before, now });
  }
  return { ok: offenders.length === 0, offenders };
}

async function main() {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2), { common: false, flags: { 'pack-root': 'string' } });
  if (!command || positionals.length !== 0) throw new UsageError('usage: check-plugin-versions.mjs <base-ref>');
  const packRoot = resolve(flags.packRoot ?? join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const { offenders } = checkPluginVersions({ packRoot, base: command });
  for (const o of offenders) console.log(`plugin ${o.id}: files changed but manifest version is still ${o.now} (was ${o.before}); bump it`);
  if (!offenders.length) console.log('check-plugin-versions: ok');
  return offenders.length ? 1 : 0;
}

if (isMain(import.meta.url)) await runCli(main);
