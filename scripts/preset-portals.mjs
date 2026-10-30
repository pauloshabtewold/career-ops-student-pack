#!/usr/bin/env node
// Prints a preset's seed employers as upstream portals.yml tracked_companies, for
// `node audit-portals.mjs --json --file <this output>` and the monthly preset audit.
// Usage: preset-portals.mjs <preset-id>
import * as yaml from 'js-yaml';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { loadPreset } from '../lib/presets.mjs';

export function presetPortals(id) {
  const preset = loadPreset(id);
  const entries = preset.seed_employers.map(({ name, careers_url, ...rest }) => ({ name, careers_url, ...rest, enabled: true }));
  return yaml.dump({ tracked_companies: entries }, { lineWidth: -1 });
}

async function main() {
  const { command, positionals } = parseArgs(process.argv.slice(2), { flags: {} });
  if (!command || positionals.length) throw new UsageError('usage: preset-portals.mjs <preset-id>');
  process.stdout.write(presetPortals(command));
  return 0;
}

if (isMain(import.meta.url)) await runCli(main);
