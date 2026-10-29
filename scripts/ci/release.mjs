#!/usr/bin/env node
// Monthly release helper for release.yml.
// Usage: release.mjs plan [--bump minor|patch|major] [--out <dir>]   prints release, version and target as key=value lines
//        release.mjs gate --sha <sha> --runs <file>                  exit 0 only when ci.yml succeeded on the sha
//        release.mjs changelog [--file CHANGELOG.md]                 adds a section per release tag the file lacks
// Exit 0 ok, 1 refused (notes still fail pii-lint after withholding, CI not green), 2 usage.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, runCli } from '../../lib/args.mjs';
import { compare, parse } from '../../lib/semver.mjs';
import { scanText } from '../pii-lint.mjs';

const defaultPackRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;
const BUMPS = ['minor', 'patch', 'major'];
const LOG_FORMAT = '%H%x1f%s%x1f%b%x1e';
const MERGE_SUBJECT = /^Merge pull request #(\d+) from \S+/;

export const CHANGELOG_SUBJECT_PREFIX = 'Update CHANGELOG.md for ';
export const WITHHELD_NOTE = '(subject withheld: failed the personal-data check)';

const gitRunner = (args, { cwd }) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

const releaseTags = (tags) => tags.filter((t) => RELEASE_TAG.test(t)).sort((a, b) => compare(a.slice(1), b.slice(1)));
const lines = (text) => text.split('\n').map((l) => l.trim()).filter(Boolean);

export function nextVersion({ tags, packageVersion, bump = 'minor' }) {
  if (!BUMPS.includes(bump)) throw new UsageError(`bump must be one of: ${BUMPS.join(', ')}`);
  const latest = releaseTags(tags).at(-1);
  if (!latest) return `v${packageVersion}`;
  const [major, minor, patch] = parse(latest.slice(1));
  if (bump === 'major') return `v${major + 1}.0.0`;
  if (bump === 'patch') return `v${major}.${minor}.${patch + 1}`;
  return `v${major}.${minor + 1}.0`;
}

// Merge subjects carry the owner handle in "from owner/branch" and the repository is public, so the pull request
// title (the first body line) replaces them. A first-parent subject cannot be edited without rewriting main, so a
// line that fails the pii-lint scan is withheld instead of blocking every later release and changelog sync.
export function releaseNotes(commits) {
  const out = [];
  for (const { subject, body = '' } of commits) {
    if (subject.startsWith(CHANGELOG_SUBJECT_PREFIX)) continue;
    const merge = MERGE_SUBJECT.exec(subject);
    const title = merge ? lines(body)[0] : null;
    const line = !merge ? subject : title ? `${title} (#${merge[1]})` : `Pull request #${merge[1]}`;
    out.push(scanText('CHANGELOG.md', line).length ? WITHHELD_NOTE : line);
  }
  return out.map((l) => `- ${l}`).join('\n');
}

function readLog(runner, packRoot, range) {
  const raw = runner(['log', '--first-parent', `--format=${LOG_FORMAT}`, ...range], { cwd: packRoot });
  return raw
    .split('\x1e')
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim())
    .map((r) => {
      const [sha, subject, body = ''] = r.split('\x1f');
      return { sha, subject, body: body.trim() };
    });
}

const readTags = (runner, packRoot) => lines(runner(['tag', '--list', 'v[0-9]*'], { cwd: packRoot }));

// The target skips changelog-sync commits: they never get a CI run, so gating on one would block every month in
// which nothing else merged.
export function planRelease({ packRoot = defaultPackRoot, bump = 'minor', runner = gitRunner }) {
  const tags = readTags(runner, packRoot);
  const previous = releaseTags(tags).at(-1);
  const target = readLog(runner, packRoot, ['HEAD']).find((c) => !c.subject.startsWith(CHANGELOG_SUBJECT_PREFIX));
  if (!target) return { release: false };
  const notes = releaseNotes(readLog(runner, packRoot, previous ? [`${previous}..${target.sha}`] : [target.sha]));
  if (!notes) return { release: false };
  const packageVersion = JSON.parse(readFileSync(join(packRoot, 'package.json'), 'utf8')).version;
  return { release: true, version: nextVersion({ tags, packageVersion, bump }), target: target.sha, notes, findings: scanText('CHANGELOG.md', notes) };
}

export function ciGreen({ runs, sha }) {
  const list = Array.isArray(runs) ? runs : (runs?.workflow_runs ?? []);
  return list.some((r) => r.head_sha === sha && r.status === 'completed' && r.conclusion === 'success');
}

// Sections are derived from tags so a changelog push that failed after the tag was cut is backfilled on the next run.
export function syncChangelog({ text, releases }) {
  const missing = releases.filter((r) => !new RegExp(`^## ${r.tag.replace(/\./g, '\\.')} `, 'm').test(text));
  if (!missing.length) return { text, added: [] };
  const sections = [...missing].reverse().map((r) => `## ${r.tag} (${r.date})\n\n${r.notes}\n`).join('\n');
  const at = text.search(/^## /m);
  const next = at === -1 ? `${text.endsWith('\n') ? text : `${text}\n`}\n${sections}` : `${text.slice(0, at)}${sections}\n${text.slice(at)}`;
  return { text: next, added: missing.map((r) => r.tag) };
}

function releasesFromTags({ packRoot, runner }) {
  const tags = releaseTags(readTags(runner, packRoot));
  return tags.map((tag, i) => ({
    tag,
    date: runner(['log', '-1', '--format=%cs', tag], { cwd: packRoot }).trim(),
    notes: releaseNotes(readLog(runner, packRoot, i ? [`${tags[i - 1]}..${tag}`] : [tag])) || '- No user-facing changes.',
  }));
}

function reportFindings(findings, label = 'notes') {
  for (const f of findings) console.error(`${label} line ${f.line}: ${f.rule}`);
}

function runPlan({ bump, out = '.', packRoot, runner }) {
  const plan = planRelease({ packRoot, bump, runner });
  if (!plan.release) {
    console.log('release=false');
    console.error('nothing merged since the previous release tag');
    return 0;
  }
  if (plan.findings.length) {
    reportFindings(plan.findings);
    return 1;
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'notes.md'), `${plan.notes}\n`);
  console.log(`release=true\nversion=${plan.version}\ntarget=${plan.target}`);
  console.error(`releasing ${plan.version} at ${plan.target}`);
  return 0;
}

function runGate({ sha, runs }) {
  if (!sha || !runs) throw new UsageError('usage: release.mjs gate --sha <sha> --runs <file>');
  if (ciGreen({ runs: JSON.parse(readFileSync(runs, 'utf8')), sha })) return 0;
  console.error(`CI is not green on ${sha}; no release`);
  return 1;
}

function runChangelog({ file = 'CHANGELOG.md', packRoot, runner }) {
  const path = join(packRoot, file);
  const releases = releasesFromTags({ packRoot, runner });
  const findings = releases.flatMap((r) => scanText('CHANGELOG.md', r.notes));
  if (findings.length) {
    reportFindings(findings, 'changelog');
    return 1;
  }
  const { text, added } = syncChangelog({ text: readFileSync(path, 'utf8'), releases });
  if (!added.length) return 0;
  writeFileSync(path, text);
  console.log(`${CHANGELOG_SUBJECT_PREFIX}${added.at(-1)}`);
  return 0;
}

async function main() {
  const { command, flags } = parseArgs(process.argv.slice(2), { common: false, flags: { bump: 'string', out: 'string', sha: 'string', runs: 'string', file: 'string' } });
  const bump = flags.bump ?? 'minor';
  if (!BUMPS.includes(bump)) throw new UsageError(`--bump must be one of: ${BUMPS.join(', ')}`);
  const ctx = { packRoot: defaultPackRoot, runner: gitRunner };
  if (command === 'plan') return runPlan({ ...ctx, bump, out: flags.out });
  if (command === 'gate') return runGate(flags);
  if (command === 'changelog') return runChangelog({ ...ctx, file: flags.file });
  throw new UsageError('usage: release.mjs plan | gate | changelog');
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) await runCli(main);
