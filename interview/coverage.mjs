#!/usr/bin/env node
// One honest coverage line per preset, read aloud in interview phase 3. Outside tech, coverage is only as good as
// the preset's employer list, so the line says what is automated and what is not.
// Usage: coverage.mjs <preset-id> [<preset-id>] [--today YYYY-MM-DD]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { loadPreset } from '../lib/presets.mjs';

const STALE_DAYS = 60;
const DAY_MS = 86400000;
const DISCOVERY_LEAD = 'Discovery help, not automation: ';

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
    // A note that already opens with the lead (byo-employer-list) keeps its own wording, so the line says it once.
    const lead = preset.coverage.level === 'discovery-only' && !preset.coverage.note.toLowerCase().startsWith(DISCOVERY_LEAD.toLowerCase()) ? DISCOVERY_LEAD : '';
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

if (isMain(import.meta.url)) await runCli(main);
