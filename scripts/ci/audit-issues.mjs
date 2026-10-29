#!/usr/bin/env node
// Turns the monthly per-preset audit-portals --json outputs into at most one issue per preset.
// Flagged boards: no-provider, error, empty, and boards whose posting count fell by half or more since last month.
// Usage: audit-issues.mjs --current <dir> [--previous <dir>]   (<dir>/<preset-id>.json)  prints a JSON array of {preset, title, body}
//        audit-issues.mjs --current <dir> [--previous <dir>] --open <file> --repo <owner/name>
//        --open is gh issue list --state open --json number,title output. Comments on the open audit issue for each flagged
//        preset (and retitles it with this month's count), or opens one when there is none.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, runCli } from '../../lib/args.mjs';

const FLAGGED = ['no-provider', 'error', 'empty'];

// mark-unmaintained.mjs parses issue titles with AUDIT_TITLE, so the title text lives in one place.
// AUDIT_TITLE captures the preset id from a title that auditTitle wrote.
export const AUDIT_TITLE = /^Preset audit: (\S+) has \d+ flagged boards?$/;

export const auditTitle = (preset, total) => `Preset audit: ${preset} has ${total} flagged board${total === 1 ? '' : 's'}`;

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
      title: auditTitle(preset, total),
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

// The count in the title changes month to month, so an open issue matches on the preset id AUDIT_TITLE captures.
// With several open issues for one preset the newest (highest number) is reused.
export function planIssues({ issues, open = [] }) {
  const byPreset = new Map();
  for (const o of open) {
    const id = AUDIT_TITLE.exec(o.title ?? '')?.[1];
    if (id && !(byPreset.get(id) > o.number)) byPreset.set(id, o.number);
  }
  return issues.map((i) => (byPreset.has(i.preset) ? { action: 'comment', number: byPreset.get(i.preset), ...i } : { action: 'create', ...i }));
}

// gh argument lists for a plan, in order.
export function ghCommands(plan, repo) {
  return plan.flatMap((p) =>
    p.action === 'comment'
      ? [
          ['issue', 'comment', String(p.number), '--repo', repo, '--body', `${p.title}\n\n${p.body}`],
          ['issue', 'edit', String(p.number), '--repo', repo, '--title', p.title],
        ]
      : [['issue', 'create', '--repo', repo, '--title', p.title, '--body', p.body]],
  );
}

function loadDir(dir) {
  if (!dir || !existsSync(dir)) return {};
  return Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, f), 'utf8'))]));
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { common: false, flags: { current: 'string', previous: 'string', open: 'string', repo: 'string' } });
  if (!flags.current) throw new UsageError('--current <dir> is required');
  if (Boolean(flags.open) !== Boolean(flags.repo)) throw new UsageError('--open and --repo go together');
  const issues = auditIssues({ current: loadDir(flags.current), previous: loadDir(flags.previous) });
  if (!flags.repo) {
    console.log(JSON.stringify(issues, null, 2));
    return 0;
  }
  const plan = planIssues({ issues, open: JSON.parse(readFileSync(flags.open, 'utf8')) });
  for (const args of ghCommands(plan, flags.repo)) execFileSync('gh', args, { stdio: 'inherit' });
  for (const p of plan) console.log(p.action === 'comment' ? `${p.preset}: commented on #${p.number}` : `${p.preset}: opened a new issue`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(main);
