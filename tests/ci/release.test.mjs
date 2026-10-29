import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciGreen, nextVersion, releaseNotes, syncChangelog, CHANGELOG_SUBJECT_PREFIX, WITHHELD_NOTE } from '../../scripts/ci/release.mjs';

const PACK = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLACEHOLDER = '- (subject withheld: failed the personal-data check)';
// Built by join so this file never holds an address outside the example domains.
const BAD_ADDRESS = ['pat.example', 'mail.test'].join('@');

const git = (cwd, env, ...args) =>
  execFileSync('git', ['-c', 'user.name=Example Tester', '-c', 'user.email=tester@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).trim();

const put = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};

// Scratch pack repo holding copies of the CLI and its imports so the pack root resolves inside it.
function scratchRepo({ version = '0.1.0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pack-release-'));
  git(root, {}, 'init', '-q');
  cpSync(join(PACK, 'lib'), join(root, 'lib'), { recursive: true });
  mkdirSync(join(root, 'scripts', 'ci'), { recursive: true });
  cpSync(join(PACK, 'scripts', 'ci', 'release.mjs'), join(root, 'scripts', 'ci', 'release.mjs'));
  cpSync(join(PACK, 'scripts', 'pii-lint.mjs'), join(root, 'scripts', 'pii-lint.mjs'));
  put(root, 'package.json', `${JSON.stringify({ name: 'scratch-pack', version, type: 'module' }, null, 2)}\n`);
  put(root, '.gitignore', 'out/\n');
  git(root, {}, 'add', '-A');
  return root;
}

let tick = 0;
function commit(root, subject, { body = '', date } = {}) {
  tick += 1;
  const when = date ?? `2026-01-${String(10 + (tick % 15)).padStart(2, '0')}T12:00:00Z`;
  const env = { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when };
  const args = ['commit', '-q', '--allow-empty', '-m', subject];
  if (body) args.push('-m', body);
  git(root, env, ...args);
  return git(root, {}, 'rev-parse', 'HEAD');
}

const tag = (root, name) => git(root, {}, 'tag', name);

async function withRepo(fn, opts) {
  const root = scratchRepo(opts);
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const cli = (root, ...args) => spawnSync(process.execPath, [join(root, 'scripts', 'ci', 'release.mjs'), ...args], { cwd: root, encoding: 'utf8' });
const kv = (stdout) => Object.fromEntries(stdout.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

// M-002-S1 normal
test('M-002-S1 nextVersion bumps the minor of the highest semver tag, v0.10.0 over v0.9.0', () => {
  const tags = ['v0.9.0', 'v0.10.0', 'safety-2026-01', 'career-ops-v1.38.0', 'v0.10.0-rc1'];
  assert.equal(nextVersion({ tags, packageVersion: '0.1.0', bump: 'minor' }), 'v0.11.0');
  assert.equal(nextVersion({ tags, packageVersion: '0.1.0' }), 'v0.11.0');
});

// M-002-S2 normal
test('M-002-S2 nextVersion patch gives v0.10.1 and major gives v1.0.0 from v0.10.0', () => {
  const tags = ['v0.9.0', 'v0.10.0'];
  assert.equal(nextVersion({ tags, packageVersion: '0.1.0', bump: 'patch' }), 'v0.10.1');
  assert.equal(nextVersion({ tags, packageVersion: '0.1.0', bump: 'major' }), 'v1.0.0');
});

// M-002-S3 edge
test('M-002-S3 nextVersion with no release tag returns v plus the package version for every bump', () => {
  for (const bump of ['minor', 'patch', 'major']) {
    assert.equal(nextVersion({ tags: [], packageVersion: '0.1.0', bump }), 'v0.1.0');
    assert.equal(nextVersion({ tags: ['safety-1', 'base'], packageVersion: '0.3.2', bump }), 'v0.3.2');
  }
});

// M-002-S4 normal
test('M-002-S4 releaseNotes rewrites a merge subject to its body title plus (#N)', () => {
  const notes = releaseNotes([
    { subject: 'Merge pull request #6 from owner/branch', body: '\n\nAdd the budget report\n\nLonger text here\n' },
    { subject: 'Merge pull request #7 from owner/other-branch', body: '' },
    { subject: 'Fix the interview prompt', body: 'ignored body' },
    { subject: `${CHANGELOG_SUBJECT_PREFIX}v0.1.0`, body: '' },
  ]);
  assert.equal(notes, '- Add the budget report (#6)\n- Pull request #7\n- Fix the interview prompt');
  assert.ok(!notes.includes('owner/'));
  assert.equal(releaseNotes([{ subject: `${CHANGELOG_SUBJECT_PREFIX}v0.2.0`, body: '' }]), '');
  assert.equal(releaseNotes([]), '');
});

// M-002-S5 edge
test('M-002-S5 plan prints release=false and exits 0 when only changelog-sync commits follow the previous tag', () =>
  withRepo((root) => {
    commit(root, 'Initial pack');
    tag(root, 'v0.1.0');
    commit(root, `${CHANGELOG_SUBJECT_PREFIX}v0.1.0`);
    const out = join(root, 'out');
    const res = cli(root, 'plan', '--out', out);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(kv(res.stdout).release, 'false');
    assert.equal(existsSync(join(out, 'notes.md')), false);
  }));

// M-002-S6 normal
test('M-002-S6 plan with v0.1.0 and two later commits prints version and target and writes both subjects', () =>
  withRepo((root) => {
    commit(root, 'Initial pack');
    tag(root, 'v0.1.0');
    commit(root, 'Add scheduler preset');
    const head = commit(root, 'Tighten triage queue');
    const out = join(root, 'out');
    const res = cli(root, 'plan', '--out', out);
    assert.equal(res.status, 0, res.stderr);
    const got = kv(res.stdout);
    assert.equal(got.release, 'true');
    assert.equal(got.version, 'v0.2.0');
    assert.equal(got.target, head);
    const notes = readFileSync(join(out, 'notes.md'), 'utf8');
    assert.ok(notes.includes('- Add scheduler preset'));
    assert.ok(notes.includes('- Tighten triage queue'));
    assert.ok(!notes.includes('Initial pack'));
  }));

// M-002-S7 edge
test('M-002-S7 plan targets the first parent when HEAD is a changelog-sync commit', () =>
  withRepo((root) => {
    commit(root, 'Initial pack');
    tag(root, 'v0.1.0');
    commit(root, 'Add scheduler preset');
    const parent = commit(root, 'Tighten triage queue');
    commit(root, `${CHANGELOG_SUBJECT_PREFIX}v0.1.0`);
    const out = join(root, 'out');
    const res = cli(root, 'plan', '--out', out);
    assert.equal(res.status, 0, res.stderr);
    const got = kv(res.stdout);
    assert.equal(got.release, 'true');
    assert.equal(got.target, parent);
    assert.ok(!readFileSync(join(out, 'notes.md'), 'utf8').includes(CHANGELOG_SUBJECT_PREFIX));
  }));

// M-002-S8 edge
test('M-002-S8 plan withholds a subject that fails pii-lint, still releases and never prints the match', () =>
  withRepo((root) => {
    commit(root, 'Initial pack');
    tag(root, 'v0.1.0');
    commit(root, `Thank you ${BAD_ADDRESS} for the report`);
    commit(root, 'Tighten triage queue');
    const out = join(root, 'out');
    const res = cli(root, 'plan', '--out', out);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(kv(res.stdout).release, 'true');
    const notes = readFileSync(join(out, 'notes.md'), 'utf8');
    assert.ok(notes.includes(PLACEHOLDER));
    assert.ok(notes.includes('- Tighten triage queue'));
    for (const text of [notes, res.stdout, res.stderr]) {
      assert.ok(!text.includes(BAD_ADDRESS));
      assert.ok(!text.includes('mail.test'));
    }
  }));

const run = (sha, status, conclusion) => ({ id: 1, head_sha: sha, name: 'CI', path: '.github/workflows/ci.yml', status, conclusion });

// M-002-S9 normal
test('M-002-S9 gate exits 0 when a completed successful run exists for the sha', () =>
  withRepo((root) => {
    const sha = 'a'.repeat(40);
    const file = join(root, 'runs.json');
    writeFileSync(file, JSON.stringify({ workflow_runs: [run('b'.repeat(40), 'completed', 'failure'), run(sha, 'completed', 'success')] }));
    const res = cli(root, 'gate', '--sha', sha, '--runs', file);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(ciGreen({ runs: { workflow_runs: [run(sha, 'completed', 'success')] }, sha }), true);
    assert.equal(ciGreen({ runs: [run(sha, 'completed', 'success')], sha }), true);
  }));

// M-002-S10 error
test('M-002-S10 gate exits 1 naming the sha when runs are failed, in progress or absent', () =>
  withRepo((root) => {
    const sha = 'c'.repeat(40);
    const cases = [
      [run(sha, 'completed', 'failure')],
      [run(sha, 'in_progress', null)],
      [run('d'.repeat(40), 'completed', 'success')],
      [],
    ];
    for (const [i, runs] of cases.entries()) {
      const file = join(root, `runs-${i}.json`);
      writeFileSync(file, JSON.stringify({ workflow_runs: runs }));
      const res = cli(root, 'gate', '--sha', sha, '--runs', file);
      assert.equal(res.status, 1, `case ${i}`);
      assert.ok(res.stderr.includes(`CI is not green on ${sha}; no release`), `case ${i}: ${res.stderr}`);
      assert.equal(ciGreen({ runs, sha }), false);
    }
  }));

// M-002-S11 normal
test('M-002-S11 changelog inserts one dated section per missing tag newest first and prints the subject', () =>
  withRepo((root) => {
    commit(root, 'Initial pack', { date: '2026-01-15T12:00:00Z' });
    commit(root, 'Add scheduler preset', { date: '2026-01-15T12:00:00Z' });
    tag(root, 'v0.1.0');
    commit(root, 'Tighten triage queue', { date: '2026-02-15T12:00:00Z' });
    tag(root, 'v0.2.0');
    put(root, 'CHANGELOG.md', '# Changelog\n\nOne section per pack release.\n');
    const res = cli(root, 'changelog');
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout.trim(), 'Update CHANGELOG.md for v0.2.0');
    const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    const [intro, v2, v1] = [text.indexOf('One section per pack release.'), text.indexOf('## v0.2.0 (2026-02-15)'), text.indexOf('## v0.1.0 (2026-01-15)')];
    assert.ok(intro >= 0 && v2 > intro && v1 > v2, text);
    assert.ok(text.indexOf('- Tighten triage queue') > v2 && text.indexOf('- Tighten triage queue') < v1);
    assert.ok(text.indexOf('- Add scheduler preset') > v1);
    assert.equal(text.split('## v0.').length - 1, 2);
  }));

// M-002-S12 edge
test('M-002-S12 a second changelog run leaves CHANGELOG.md byte-identical and prints nothing', () =>
  withRepo((root) => {
    commit(root, 'Initial pack', { date: '2026-01-15T12:00:00Z' });
    tag(root, 'v0.1.0');
    put(root, 'CHANGELOG.md', '# Changelog\n\nOne section per pack release.\n');
    const first = cli(root, 'changelog');
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout.trim(), 'Update CHANGELOG.md for v0.1.0');
    const before = readFileSync(join(root, 'CHANGELOG.md'));
    const second = cli(root, 'changelog');
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, '');
    assert.deepEqual(readFileSync(join(root, 'CHANGELOG.md')), before);
    const text = '# Changelog\n\nPara.\n';
    const same = syncChangelog({ text: `${text}\n## v0.1.0 (2026-01-01)\n\n- one\n`, releases: [{ tag: 'v0.1.0', date: '2026-01-01', notes: '- one' }] });
    assert.equal(same.text, `${text}\n## v0.1.0 (2026-01-01)\n\n- one\n`);
    assert.deepEqual(same.added, []);
  }));

// M-002-S13 error
test('M-002-S13 an unknown bump value or subcommand exits 2 with a usage message', () =>
  withRepo((root) => {
    commit(root, 'Initial pack');
    tag(root, 'v0.1.0');
    commit(root, 'Add scheduler preset');
    const bad = cli(root, 'plan', '--bump', 'huge', '--out', join(root, 'out'));
    assert.equal(bad.status, 2);
    assert.ok(bad.stderr.trim().length > 0);
    assert.equal(cli(root, 'launch').status, 2);
  }));

// M-002-S14 edge
test('M-002-S14 releaseNotes and changelog emit the withheld placeholder for plain and merge subjects that fail pii-lint', () =>
  withRepo((root) => {
    assert.equal(WITHHELD_NOTE, '(subject withheld: failed the personal-data check)');
    const notes = releaseNotes([
      { subject: `Credit ${BAD_ADDRESS}`, body: '' },
      { subject: 'Merge pull request #9 from owner/branch', body: `Reply to ${BAD_ADDRESS}` },
      { subject: 'Keep this one', body: '' },
    ]);
    assert.equal(notes, `${PLACEHOLDER}\n${PLACEHOLDER}\n- Keep this one`);

    commit(root, 'Initial pack', { date: '2026-01-15T12:00:00Z' });
    commit(root, `Credit ${BAD_ADDRESS}`, { date: '2026-01-15T12:00:00Z' });
    tag(root, 'v0.1.0');
    put(root, 'CHANGELOG.md', '# Changelog\n\nOne section per pack release.\n');
    const res = cli(root, 'changelog');
    assert.equal(res.status, 0, res.stderr);
    const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
    assert.ok(text.includes(PLACEHOLDER));
    assert.ok(!text.includes('mail.test'));
    assert.ok(!res.stdout.includes('mail.test') && !res.stderr.includes('mail.test'));
  }));

test('M-002-S11 syncChangelog inserts missing sections newest first after the intro paragraph', () => {
  const text = '# Changelog\n\nOne section per pack release.\n';
  const releases = [
    { tag: 'v0.1.0', date: '2026-01-15', notes: '- one' },
    { tag: 'v0.2.0', date: '2026-02-15', notes: '- two' },
  ];
  const res = syncChangelog({ text, releases });
  assert.deepEqual([...res.added].sort(), ['v0.1.0', 'v0.2.0']);
  assert.ok(res.text.startsWith(text.trimEnd()));
  const [a, b] = [res.text.indexOf('## v0.2.0 (2026-02-15)'), res.text.indexOf('## v0.1.0 (2026-01-15)')];
  assert.ok(a > 0 && b > a);
  assert.ok(res.text.indexOf('- two') > a && res.text.indexOf('- two') < b);
});
