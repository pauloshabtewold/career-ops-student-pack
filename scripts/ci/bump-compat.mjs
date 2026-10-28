#!/usr/bin/env node
// Raises compat.json upstream.max after the canary passed against a newer upstream release.
// Only upstream.max changes; budgetSha256 and every other field are written back as read.
// Usage: bump-compat.mjs <version> [--file <compat.json>]    exit 0 bumped, 1 not newer, 2 usage
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, runCli } from '../../lib/args.mjs';
import { compare } from '../../lib/semver.mjs';

const DEFAULT_FILE = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'compat.json');

export function bumpCompat(version, file = DEFAULT_FILE) {
  const obj = JSON.parse(readFileSync(file, 'utf8'));
  const current = obj.upstream.max;
  if (compare(version, current) <= 0) return { bumped: false, from: current, to: version };
  obj.upstream.max = version;
  writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
  return { bumped: true, from: current, to: version };
}

async function main() {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2), { common: false, flags: { file: 'string' } });
  const args = [command, ...positionals].filter((a) => a !== null);
  if (args.length !== 1 || !/^\d+\.\d+\.\d+$/.test(args[0])) throw new UsageError('usage: bump-compat.mjs <x.y.z> [--file compat.json]');
  const res = bumpCompat(args[0], flags.file ? resolve(flags.file) : DEFAULT_FILE);
  if (!res.bumped) {
    console.error(`${res.to} is not newer than ${res.from}; nothing written`);
    return 1;
  }
  console.log(`upstream.max ${res.from} -> ${res.to}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(main);
