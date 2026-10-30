#!/usr/bin/env node
// Keeps compat.json budgetSha256 equal to the SHA-256 of scripts/budget.mjs.
// --check exits 0 when they match and 1 when they differ; --write rewrites only that field.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runCli, UsageError, isMain } from '../lib/args.mjs';

const packRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const FIELD = /("budgetSha256"\s*:\s*")([0-9a-f]*)(")/;

export function budgetHash(root = packRoot) {
  return createHash('sha256').update(readFileSync(join(root, 'scripts', 'budget.mjs'))).digest('hex');
}

function main() {
  const { flags, positionals } = parseArgs(process.argv.slice(2), { common: false, flags: { check: 'boolean', write: 'boolean' } });
  if (positionals.length || flags.check === flags.write) throw new UsageError('use exactly one of --check or --write');
  const file = join(packRoot, 'compat.json');
  const text = readFileSync(file, 'utf8');
  const m = FIELD.exec(text);
  if (!m) throw new UsageError('compat.json has no budgetSha256 field');
  const actual = budgetHash();
  if (flags.check) {
    if (m[2] === actual) {
      console.log('compat-hash: budgetSha256 matches scripts/budget.mjs');
      return 0;
    }
    console.log(`compat-hash: budgetSha256 ${m[2]} differs from scripts/budget.mjs ${actual}`);
    return 1;
  }
  writeFileSync(file, text.replace(FIELD, `$1${actual}$3`));
  console.log(`compat-hash: budgetSha256 set to ${actual}`);
  return 0;
}

if (isMain(import.meta.url)) await runCli(main);
