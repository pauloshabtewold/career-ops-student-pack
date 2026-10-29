// Marker tests over synthetic owners text and issue arrays. Only association values appear, never logins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { STALE_DAYS, markUnmaintained } from '../../scripts/ci/mark-unmaintained.mjs';
import { coverageLine } from '../../interview/coverage.mjs';

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = join(PACK, 'scripts', 'ci', 'mark-unmaintained.mjs');
const TODAY = '2026-12-31';
const DAY_MS = 86400000;
const daysBefore = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * DAY_MS).toISOString().slice(0, 10);
const stamp = (n) => `${daysBefore(n)}T08:00:00Z`;
const line = (id, owner, reviewed) => `${id}: {owner: ${owner}, last_reviewed: "${reviewed}"}`;
const owners = (...lines) => `# Role placeholders only.\n${lines.join('\n')}\n`;
const fresh = daysBefore(5);
const issue = (number, title, age, comments = []) => ({ number, title, createdAt: stamp(age), comments });
const comment = (association, age) => ({ authorAssociation: association, createdAt: stamp(age) });
const run = (args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

function scratch(ownersText, issues = []) {
  const dir = mkdtempSync(join(tmpdir(), 'pack-unmaintained-'));
  const ownersFile = join(dir, 'OWNERS.yml');
  const issuesFile = join(dir, 'issues.json');
  writeFileSync(ownersFile, ownersText);
  writeFileSync(issuesFile, JSON.stringify(issues));
  return { ownersFile, issuesFile, args: ['--issues', issuesFile, '--owners', ownersFile, '--today', TODAY] };
}

test('STALE_DAYS is 60', () => {
  assert.equal(STALE_DAYS, 60);
});

// M-003-S1 normal
test('M-003-S1 a preset last reviewed 61 days ago is blanked with the date in the reason and other lines unchanged', () => {
  const stale = daysBefore(61);
  const text = owners(line('alpha', 'pack-maintainer', stale), line('beta', 'pack-maintainer', fresh), line('gamma', 'pack-maintainer', fresh));
  const out = markUnmaintained({ ownersText: text, issues: [], today: TODAY });
  assert.equal(out.text, owners(`alpha: {owner: "", last_reviewed: "${stale}"}`, line('beta', 'pack-maintainer', fresh), line('gamma', 'pack-maintainer', fresh)));
  assert.equal(out.marked.length, 1);
  assert.equal(out.marked[0].preset, 'alpha');
  assert.ok(out.marked[0].reason.includes(stale), out.marked[0].reason);
});

// M-003-S2 edge
test('M-003-S2 a preset last reviewed exactly 60 days ago stays owned', () => {
  const text = owners(line('alpha', 'pack-maintainer', daysBefore(60)));
  const out = markUnmaintained({ ownersText: text, issues: [], today: TODAY });
  assert.deepEqual(out.marked, []);
  assert.equal(out.text, text);
});

// M-003-S3 normal
test('M-003-S3 coverageLine flags unmaintained only the preset markUnmaintained blanked', () => {
  const text = owners(line('software-cs', 'pack-maintainer', daysBefore(60)), line('accounting', 'pack-maintainer', daysBefore(61)));
  const out = markUnmaintained({ ownersText: text, issues: [], today: TODAY });
  const parsed = yaml.load(out.text);
  assert.ok(parsed['software-cs'].owner, 'the 60-day preset keeps its owner');
  assert.ok(!parsed.accounting.owner, 'the 61-day preset is blanked');
  const [kept, blanked] = coverageLine(['software-cs', 'accounting'], { today: TODAY, owners: parsed });
  assert.ok(!kept.includes('(unmaintained:'), kept);
  assert.ok(blanked.includes('(unmaintained:'), blanked);
});

// M-003-S4 normal
test('M-003-S4 an audit issue older than 60 days with no maintainer comment blanks its preset and names the issue number', () => {
  const text = owners(line('alpha', 'pack-maintainer', fresh), line('beta', 'pack-maintainer', fresh));
  const issues = [issue(7, 'Preset audit: alpha has 2 flagged boards', 61)];
  const out = markUnmaintained({ ownersText: text, issues, today: TODAY });
  assert.equal(out.text, owners(`alpha: {owner: "", last_reviewed: "${fresh}"}`, line('beta', 'pack-maintainer', fresh)));
  assert.equal(out.marked.length, 1);
  assert.equal(out.marked[0].preset, 'alpha');
  assert.match(out.marked[0].reason, /#7\b/);
});

// M-003-S5 edge
test('M-003-S5 a maintainer comment within 60 days keeps the preset owned', () => {
  const text = owners(line('alpha', 'pack-maintainer', fresh));
  for (const association of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
    const issues = [issue(8, 'Preset audit: alpha has 1 flagged board', 120, [comment(association, 10)])];
    const out = markUnmaintained({ ownersText: text, issues, today: TODAY });
    assert.deepEqual(out.marked, [], association);
    assert.equal(out.text, text, association);
  }
});

// M-003-S6 edge
test('M-003-S6 comments with association NONE do not reset the silence', () => {
  const text = owners(line('alpha', 'pack-maintainer', fresh));
  const issues = [issue(9, 'Preset audit: alpha has 1 flagged board', 61, [comment('NONE', 3), comment('NONE', 20)])];
  const out = markUnmaintained({ ownersText: text, issues, today: TODAY });
  assert.deepEqual(out.marked.map((m) => m.preset), ['alpha']);
  assert.match(out.text, /alpha: \{owner: "",/);
});

test('M-003-S6 REST field names are accepted', () => {
  const text = owners(line('alpha', 'pack-maintainer', fresh));
  const issues = [{ number: 11, title: 'Preset audit: alpha has 1 flagged board', created_at: stamp(70), comments: [{ author_association: 'NONE', created_at: stamp(2) }] }];
  const out = markUnmaintained({ ownersText: text, issues, today: TODAY });
  assert.deepEqual(out.marked.map((m) => m.preset), ['alpha']);
  const quiet = [{ number: 12, title: 'Preset audit: alpha has 1 flagged board', created_at: stamp(70), comments: [{ author_association: 'MEMBER', created_at: stamp(2) }] }];
  assert.deepEqual(markUnmaintained({ ownersText: text, issues: quiet, today: TODAY }).marked, []);
});

// M-003-S7 edge
test('M-003-S7 blank owners, non-audit titles and unknown presets produce no change', () => {
  const text = owners(`alpha: {owner: "", last_reviewed: "${daysBefore(200)}"}`, line('beta', 'pack-maintainer', fresh));
  const issues = [
    issue(1, 'Preset audit: alpha has 2 flagged boards', 100),
    issue(2, 'Question about the boards', 100),
    issue(3, 'Preset audit: missing-preset has 1 flagged board', 100),
    issue(4, 'Preset audit: beta is fine', 100),
  ];
  const out = markUnmaintained({ ownersText: text, issues, today: TODAY });
  assert.deepEqual(out.marked, []);
  assert.equal(out.text, text);
});

test('M-003-S7 a preset hit by both rules is marked once', () => {
  const text = owners(line('alpha', 'pack-maintainer', daysBefore(90)));
  const out = markUnmaintained({ ownersText: text, issues: [issue(5, 'Preset audit: alpha has 1 flagged board', 90)], today: TODAY });
  assert.equal(out.marked.length, 1);
  assert.ok(out.marked[0].reason.includes(daysBefore(90)), 'rule 1 reason comes first');
});

// M-003-S8 error and S9 error
test('M-003-S8 a malformed owners line makes the CLI exit 1 naming the preset', () => {
  const text = `# header\nalpha:\n  owner: pack-maintainer\n  last_reviewed: "${daysBefore(61)}"\n${line('beta', 'pack-maintainer', fresh)}\n`;
  const { ownersFile, args } = scratch(text);
  const r = run(args);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /alpha/);
  assert.equal(r.stdout, '');
});

test('M-003-S9 the owners file is byte-identical after the malformed-line failure', () => {
  const text = `# header\nalpha:\n  owner: pack-maintainer\n  last_reviewed: "${daysBefore(61)}"\n${line('beta', 'pack-maintainer', daysBefore(70))}\n`;
  const { ownersFile, args } = scratch(text);
  const r = run(args);
  assert.equal(r.status, 1, r.stderr);
  assert.equal(readFileSync(ownersFile, 'utf8'), text);
});

// M-003-S10 normal
test('M-003-S10 the CLI rewrites the owners file in place', () => {
  const stale = daysBefore(61);
  const text = owners(line('alpha', 'pack-maintainer', stale), line('beta', 'pack-maintainer', fresh));
  const { ownersFile, args } = scratch(text);
  const r = run(args);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(ownersFile, 'utf8'), owners(`alpha: {owner: "", last_reviewed: "${stale}"}`, line('beta', 'pack-maintainer', fresh)));
});

// M-003-S11 normal
test('M-003-S11 the CLI prints one dash line per marked preset', () => {
  const text = owners(line('alpha', 'pack-maintainer', daysBefore(61)), line('beta', 'pack-maintainer', fresh), line('gamma', 'pack-maintainer', fresh));
  const issues = [issue(21, 'Preset audit: gamma has 4 flagged boards', 75)];
  const { args } = scratch(text, issues);
  const r = run(args);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^- alpha: .+/);
  assert.ok(lines[0].includes(daysBefore(61)));
  assert.match(lines[1], /^- gamma: .*#21/);
});

// M-003-S12 edge and S13 edge
test('M-003-S12 with nothing to mark the CLI leaves the owners file byte-identical', () => {
  const text = owners(line('alpha', 'pack-maintainer', daysBefore(60)), line('beta', 'pack-maintainer', fresh));
  const { ownersFile, args } = scratch(text, [issue(1, 'Preset audit: beta has 1 flagged board', 10)]);
  const r = run(args);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(ownersFile, 'utf8'), text);
});

test('M-003-S13 with nothing to mark the CLI prints nothing on stdout', () => {
  const text = owners(line('alpha', 'pack-maintainer', daysBefore(60)));
  const { args } = scratch(text);
  const r = run(args);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});

// M-003-S14 normal
test('M-003-S14 every entry in presets/OWNERS.yml is a one-line flow mapping', () => {
  const rows = readFileSync(join(PACK, 'presets', 'OWNERS.yml'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  assert.ok(rows.length > 0);
  for (const row of rows) assert.match(row, /^[a-z0-9][a-z0-9-]*: \{owner: (""|[a-z][a-z-]*), last_reviewed: "\d{4}-\d{2}-\d{2}"\}$/, row);
});

// M-003-S17 to S19 workflow
const WF = join(PACK, '.github', 'workflows', 'mark-unmaintained.yml');
const wfText = () => {
  assert.ok(existsSync(WF), 'missing .github/workflows/mark-unmaintained.yml');
  return readFileSync(WF, 'utf8');
};
const prStepRun = () => {
  const wf = yaml.load(wfText());
  const steps = Object.values(wf.jobs).flatMap((j) => j.steps);
  const step = steps.find((s) => typeof s.run === 'string' && s.run.includes('gh pr create'));
  assert.ok(step, 'a step runs gh pr create');
  return step.run;
};

test('M-003-S17 the workflow exits 0 on git diff --quiet before any git push', () => {
  const run = prStepRun();
  const diff = run.indexOf('git diff --quiet presets/OWNERS.yml');
  assert.ok(diff >= 0, 'git diff --quiet presets/OWNERS.yml');
  const exitAt = run.indexOf('exit 0', diff);
  assert.ok(exitAt > diff, 'diff guard ends in exit 0');
  const push = run.indexOf('git push');
  assert.ok(push > exitAt, 'git push comes after the guard');
});

test('M-003-S18 the workflow exits 0 when an unmaintained PR is open, before gh pr create', () => {
  const run = prStepRun();
  const diff = run.indexOf('git diff --quiet presets/OWNERS.yml');
  const list = run.indexOf('gh pr list --repo ${{ github.repository }}');
  assert.ok(list > diff && diff >= 0, 'gh pr list follows the diff guard');
  assert.ok(run.indexOf('head:maintenance/unmaintained-', list) > list, 'searches head:maintenance/unmaintained-');
  const exitAt = run.indexOf('exit 0', list);
  const create = run.indexOf('gh pr create');
  assert.ok(exitAt > list && exitAt < create, 'open-PR guard ends in exit 0 before gh pr create');
  assert.ok(run.indexOf('git push') > exitAt, 'git push comes after both guards');
});

test('M-003-S19 the workflow pushes maintenance/unmaintained-<date> and opens the PR with the marked list', () => {
  const text = wfText();
  const wf = yaml.load(text);
  const on = wf.on ?? wf.true;
  assert.equal(on.schedule[0].cron, '37 6 * * 3');
  assert.ok('workflow_dispatch' in on);
  assert.deepEqual(wf.permissions, { contents: 'write', 'pull-requests': 'write', issues: 'read' });
  const run = prStepRun();
  const push = run.indexOf('git push');
  assert.ok(push >= 0);
  assert.match(run.slice(run.indexOf('git checkout') >= 0 ? run.indexOf('git checkout') : 0), /maintenance\/unmaintained-/);
  const create = run.indexOf('gh pr create --repo ${{ github.repository }}');
  assert.ok(create > push, 'gh pr create --repo follows git push');
  assert.ok(run.indexOf('--body-file', create) > create);
  assert.ok(text.includes('mark-unmaintained.mjs'), 'runs the marker');
});
