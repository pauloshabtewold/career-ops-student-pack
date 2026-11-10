#!/usr/bin/env node
// Turns the monthly per-preset audit-portals --json outputs into at most one issue per preset.
// Flagged boards: no-provider, error, empty, and boards whose posting count fell by half or more since last month.
// Usage: audit-issues.mjs --current <dir> [--previous <dir>]   (<dir>/<preset-id>.json)  prints a JSON array of {preset, title, body}
//        audit-issues.mjs --current <dir> [--previous <dir>] --open <file> --repo <owner/name>
//        --open is gh issue list --state open --json number,title output. Comments on the open audit issue for each flagged
//        preset (and retitles it with this month's count), or opens one when there is none.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError, parseArgs, runCli, isMain } from '../../lib/args.mjs';
import { loadPreset } from '../../lib/presets.mjs';

const FLAGGED = ['no-provider', 'error', 'empty'];

// mark-unmaintained.mjs parses issue titles with AUDIT_TITLE, so the title text lives in one place.
// AUDIT_TITLE captures the preset id from a title that auditTitle wrote.
export const AUDIT_TITLE = /^Preset audit: (\S+) has \d+ flagged boards?$/;

export const auditTitle = (preset, total) => `Preset audit: ${preset} has ${total} flagged board${total === 1 ? '' : 's'}`;

// Accepts { boards: [{ name, status, postings }] }; rows with verdict/count are read the same way.
const boardsOf = (out) => {
  const list = Array.isArray(out) ? out : (out?.boards ?? out?.rows ?? []);
  return list.map((b) => ({ name: b.name, status: b.status ?? b.verdict, postings: b.postings ?? b.count, detail: b.detail ?? '' }));
};

// audit-portals 1.39.0 ignores an entry's max_response_mb, so a board over its 10 MB default always audits as this error.
const CAP_ERROR = /exceeded maxBytes/;

// watchOnly maps preset id -> names of seeds marked watch_only. Their no-provider rows are expected every month, so they
// are counted in one line instead of listed; any other status on them (error, empty, halved) is still flagged.
// capped maps preset id -> names of seeds that set max_response_mb. scan.mjs reads those boards above 10 MB but
// audit-portals does not, so their response-cap error is counted the same way; any other error on them is flagged.
export function auditIssues({ current, previous = {}, watchOnly = {}, capped = {} }) {
  const issues = [];
  for (const [preset, out] of Object.entries(current)) {
    const watched = new Set(watchOnly[preset] ?? []);
    const big = new Set(capped[preset] ?? []);
    const all = boardsOf(out);
    const isWatched = (b) => b.status === 'no-provider' && watched.has(b.name);
    const isCapped = (b) => b.status === 'error' && big.has(b.name) && CAP_ERROR.test(b.detail);
    const boards = all.filter((b) => !isWatched(b) && !isCapped(b));
    const skipped = all.filter(isWatched).length;
    const overCap = all.filter(isCapped).length;
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
        ...(skipped ? [`${skipped} watch-only seed${skipped === 1 ? '' : 's'} with no provider not listed.`, ''] : []),
        ...(overCap ? [`${overCap} board${overCap === 1 ? '' : 's'} over the 10 MB audit limit not listed: scan.mjs reads ${overCap === 1 ? 'it' : 'them'} with max_response_mb.`, ''] : []),
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
  const current = loadDir(flags.current);
  const seedNames = (pick) => Object.fromEntries(Object.keys(current).map((id) => [id, loadPreset(id).seed_employers.filter(pick).map((e) => e.name)]));
  const issues = auditIssues({ current, previous: loadDir(flags.previous), watchOnly: seedNames((e) => e.watch_only), capped: seedNames((e) => e.max_response_mb !== undefined) });
  if (!flags.repo) {
    console.log(JSON.stringify(issues, null, 2));
    return 0;
  }
  const plan = planIssues({ issues, open: JSON.parse(readFileSync(flags.open, 'utf8')) });
  for (const args of ghCommands(plan, flags.repo)) execFileSync('gh', args, { stdio: 'inherit' });
  for (const p of plan) console.log(p.action === 'comment' ? `${p.preset}: commented on #${p.number}` : `${p.preset}: opened a new issue`);
  return 0;
}

if (isMain(import.meta.url)) await runCli(main);
