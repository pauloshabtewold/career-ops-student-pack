#!/usr/bin/env node
// One honest coverage line per preset, read aloud in interview phase 3. Outside tech, coverage is only as good as
// the preset's employer list, so the line says what is automated and what is not.
// Usage: coverage.mjs <preset-id> [<preset-id>] [--today YYYY-MM-DD]
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { UsageError, parseArgs, runCli } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { loadPreset } from '../lib/presets.mjs';

const STALE_DAYS = 60;
const DAY_MS = 86400000;

export function readOwners(packRoot) {
  const file = join(packRoot, 'presets', 'OWNERS.yml');
  return existsSync(file) ? yaml.load(readFileSync(file, 'utf8')) ?? {} : {};
}

export function coverageLine(presetIds, { packRoot, today, owners: ownersIn } = {}) {
  const paths = resolvePaths({});
  const root = packRoot ?? paths.packRoot;
  const day = today ?? createClock({}).today();
  const owners = ownersIn ?? readOwners(root);
  return presetIds.map((id) => {
    const preset = loadPreset(id, {});
    const owner = owners[id];
    const age = owner?.last_reviewed ? (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${owner.last_reviewed}T00:00:00Z`)) / DAY_MS : Infinity;
    const unmaintained = !owner?.owner || age > STALE_DAYS;
    const lead = preset.coverage.level === 'discovery-only' ? 'Discovery help, not automation: ' : '';
    const flag = unmaintained ? ' (unmaintained: no current owner, treat the employer list as a starting point)' : '';
    return `${preset.name} [${preset.coverage.level}]: ${lead}${preset.coverage.note}${flag}`;
  });
}

async function main() {
  const { command, positionals: rest, flags } = parseArgs(process.argv.slice(2), { flags: {} });
  const positionals = command ? [command, ...rest] : [];
  if (!positionals.length) throw new UsageError('usage: coverage.mjs <preset-id> [<preset-id>]');
  for (const line of coverageLine(positionals, { today: flags.today })) console.log(line);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(main);
