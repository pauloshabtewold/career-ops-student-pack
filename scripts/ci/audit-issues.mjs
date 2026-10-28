#!/usr/bin/env node
// Turns the monthly per-preset audit-portals --json outputs into at most one issue per preset.
// Flagged boards: no-provider, error, empty, and boards whose posting count fell by half or more since last month.
// Usage: audit-issues.mjs --current <dir> [--previous <dir>]   (<dir>/<preset-id>.json)  prints a JSON array of {preset, title, body}
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, runCli } from '../../lib/args.mjs';

const FLAGGED = ['no-provider', 'error', 'empty'];

// Accepts { boards: [{ name, status, postings }] }; rows with verdict/count are read the same way.
const boardsOf = (out) => {
  const list = Array.isArray(out) ? out : (out?.boards ?? out?.rows ?? []);
  return list.map((b) => ({ name: b.name, status: b.status ?? b.verdict, postings: b.postings ?? b.count }));
};

export function auditIssues({ current, previous = {} }) {
  const issues = [];
  for (const [preset, out] of Object.entries(current)) {
    const boards = boardsOf(out);
    const before = new Map(boardsOf(previous[preset]).filter((b) => Number.isFinite(b.postings)).map((b) => [b.name, b.postings]));
    const groups = new Map(FLAGGED.map((s) => [s, boards.filter((b) => b.status === s).map((b) => b.name)]));
    const halved = boards
      .filter((b) => !FLAGGED.includes(b.status) && Number.isFinite(b.postings) && before.get(b.name) > 0 && b.postings * 2 <= before.get(b.name))
      .map((b) => `${b.name} (${before.get(b.name)} to ${b.postings})`);
    const total = [...groups.values()].reduce((n, g) => n + g.length, 0) + halved.length;
    if (!total) continue;
    const section = (title, items) => (items.length ? [`## ${title} (${items.length})`, '', ...items.map((i) => `- ${i}`), ''] : []);
    issues.push({
      preset,
      title: `Preset audit: ${preset} has ${total} flagged board${total === 1 ? '' : 's'}`,
      body: [
        `Monthly audit of the ${preset} seed list found boards that need a look. Fix the careers URL, find another provider, or remove the employer.`,
        '',
        ...section('Status no-provider', groups.get('no-provider')),
        ...section('Status error', groups.get('error')),
        ...section('Status empty', groups.get('empty')),
        ...section('Posting count halved or worse', halved),
      ].join('\n'),
    });
  }
  return issues;
}

function loadDir(dir) {
  if (!dir || !existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, f), 'utf8'))]));
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { common: false, flags: { current: 'string', previous: 'string' } });
  if (!flags.current) throw new UsageError('--current <dir> is required');
  console.log(JSON.stringify(auditIssues({ current: loadDir(flags.current), previous: loadDir(flags.previous) }), null, 2));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(main);
