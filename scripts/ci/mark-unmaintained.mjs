#!/usr/bin/env node
// Blanks the owner of a preset in presets/OWNERS.yml when nobody has looked at it for more than 60 days:
// either last_reviewed is older, or its open audit issue has no maintainer comment for that long.
// interview/coverage.mjs already reports a preset with a blank owner as unmaintained, so no runtime code changes.
// Usage: mark-unmaintained.mjs --issues <file> [--owners <file>] [--today YYYY-MM-DD]
// --issues is gh issue list --json number,title,createdAt,comments output. Prints "- <preset>: <reason>" per marked
// preset (the pull request body). Exit 0, 1 when an OWNERS line cannot be rewritten, 2 usage.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { UsageError, parseArgs, runCli } from '../../lib/args.mjs';
import { createClock } from '../../lib/clock.mjs';
import { AUDIT_TITLE } from './audit-issues.mjs';

const defaultPackRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const DAY_MS = 86400000;
// Author associations that identify a repository maintainer without storing a login in the repo.
const MAINTAINER_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

// Same strictly-greater rule as interview/coverage.mjs, so a preset marked here is exactly one the coverage line flags.
// interview/coverage.mjs keeps its own copy of this number; a test in tests/ci checks the two agree at 60 and 61 days.
export const STALE_DAYS = 60;

// gh issue list uses camelCase field names and the REST API uses snake_case.
const field = (o, camel, snake) => o?.[camel] ?? o?.[snake];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A comment from someone without write standing does not count as a maintainer looking at the board.
// Silence starts at the newest maintainer comment, or at issue creation when there is none.
function silenceStart(issue) {
  const comments = Array.isArray(issue.comments) ? issue.comments : [];
  const stamps = comments
    .filter((c) => MAINTAINER_ASSOCIATIONS.has(field(c, 'authorAssociation', 'author_association')))
    .map((c) => Date.parse(field(c, 'createdAt', 'created_at')));
  return Math.max(Date.parse(field(issue, 'createdAt', 'created_at')), ...stamps);
}

// Returns { text, marked }: the OWNERS text with the owner blanked for each stale preset, and { preset, reason } per
// change. A preset whose owner is already blank is skipped. A stale last_reviewed takes priority over issue silence in
// the reason. Throws when a preset line is not a one-line flow mapping.
export function markUnmaintained({ ownersText, issues = [], today }) {
  const owners = yaml.load(ownersText) ?? {};
  const now = Date.parse(`${today}T00:00:00Z`);
  const reasons = new Map();
  for (const [id, entry] of Object.entries(owners)) {
    if (!entry?.owner) continue;
    if (!entry.last_reviewed) reasons.set(id, 'no last_reviewed');
    else if ((now - Date.parse(`${entry.last_reviewed}T00:00:00Z`)) / DAY_MS > STALE_DAYS) {
      reasons.set(id, `last_reviewed ${entry.last_reviewed} is more than ${STALE_DAYS} days old`);
    }
  }
  // Every open audit issue counts: the audit now comments on an open one, but older runs left duplicates, so an old
  // unanswered issue still marks the preset when a newer one exists.
  for (const issue of issues) {
    const id = AUDIT_TITLE.exec(issue.title ?? '')?.[1];
    if (!id || !owners[id]?.owner || reasons.has(id)) continue;
    if ((now - silenceStart(issue)) / DAY_MS > STALE_DAYS) {
      reasons.set(id, `audit issue #${issue.number} has had no maintainer comment for more than ${STALE_DAYS} days`);
    }
  }
  // A line rewrite keeps the header comments that a yaml dump would drop.
  let text = ownersText;
  for (const id of reasons.keys()) {
    const line = new RegExp(`^${escapeRe(id)}:\\s*\\{owner:\\s*[^,}]*,`, 'm');
    if (!line.test(text)) throw new Error(`presets/OWNERS.yml line for ${id} is not a one-line flow mapping`);
    text = text.replace(line, `${id}: {owner: "",`);
  }
  return { text, marked: [...reasons].map(([preset, reason]) => ({ preset, reason })) };
}

// --today exists for tests and reruns. OWNERS.yml is written only when a preset was marked, so the workflow's git diff
// check sees no change otherwise.
async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { common: false, flags: { issues: 'string', owners: 'string', today: 'date' } });
  if (!flags.issues) throw new UsageError('usage: mark-unmaintained.mjs --issues <file> [--owners <file>] [--today YYYY-MM-DD]');
  const ownersFile = flags.owners ?? join(defaultPackRoot, 'presets', 'OWNERS.yml');
  const today = flags.today ?? createClock({ timezone: 'UTC' }).today();
  let result;
  try {
    result = markUnmaintained({ ownersText: readFileSync(ownersFile, 'utf8'), issues: JSON.parse(readFileSync(flags.issues, 'utf8')), today });
  } catch (err) {
    console.error(err.message);
    return 1;
  }
  if (result.marked.length) writeFileSync(ownersFile, result.text);
  for (const m of result.marked) console.log(`- ${m.preset}: ${m.reason}`);
  return 0;
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) await runCli(main);
