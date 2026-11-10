// Assumed: setup({ root, packRoot, dryRun, skipPlaywright, runner, nodeVersion, platform, home, exists }) returns the
// output lines and throws InstallError on refusal; syncedFolder(path, { home, platform, exists }) names a sync provider
// or returns null. The runner is a fake, so no real git, npm or network runs, except the one real-git checkout test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { InstallError } from '../../install.mjs';
import { syncedFolder, setup } from '../../setup.mjs';
import { withTempDir } from '../../lib/temp-dir.mjs';
import { makePack, put, snapshot } from './_pack-repo.mjs';

const NODE_VERSION = process.versions.node;
const HOME = join('/', 'home', 'student');
const TAG = 'career-ops-v1.39.0';
const CODEX = 'templates/codex-config.suggested.toml';
const CLAUDE = 'templates/claude-settings.suggested.json';

// opts.status is what `git status` prints, opts.localLog what `git log origin/main..main` prints, opts.noTag makes the tag lookup fail, opts.fail(cmd, args) throws a step error.
// opts.head and opts.tagCommit are the shas `rev-parse HEAD` and `rev-parse <tag>^{commit}` print; the default pair differs.
function fakeRunner({ status = '', localLog = '', noTag = false, head = 'aaa111', tagCommit = 'bbb222', fail = () => false } = {}) {
  const calls = [];
  const runner = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, opts });
    if (fail(cmd, args)) throw Object.assign(new Error(`Command failed: ${cmd} ${args.join(' ')}`), { status: 1, stderr: `${cmd} ERR! sample failure\nsecond line` });
    if (cmd === 'git' && args[0] === 'status') return status;
    if (cmd === 'git' && args[0] === 'log') return localLog;
    if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === 'HEAD') return `${head}\n`;
    if (cmd === 'git' && args[0] === 'rev-parse' && args[1] === '--verify') {
      // with noTag the tag is missing until a fetch has run
      if (noTag && !calls.some((c) => c.cmd === 'git' && c.args[0] === 'fetch')) throw new Error('no tag');
      return `${tagCommit}\n`;
    }
    return '';
  };
  return { runner, calls };
}
const has = (calls, cmd, ...args) => calls.some((c) => c.cmd === cmd && args.every((a, i) => c.args[i] === a));

function withPack(opts, fn) {
  const p = makePack(opts);
  try {
    return fn(p);
  } finally {
    p.cleanup();
  }
}

const run = (p, { runner, ...extra } = {}) => setup({ root: p.root, packRoot: p.pack, runner: runner ?? fakeRunner().runner, nodeVersion: NODE_VERSION, home: HOME, ...extra });
const err = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
};

test('syncedFolder names the provider for each synced location and null elsewhere', () => {
  const icloudOn = new Set([join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Desktop')]);
  const on = (p) => icloudOn.has(p);
  const off = () => false;
  const mac = { home: HOME, platform: 'darwin' };
  const table = [
    [join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'career-ops'), { ...mac, exists: off }, /iCloud/],
    [join(HOME, 'Desktop', 'career-ops'), { ...mac, exists: on }, /iCloud/],
    [join(HOME, 'Documents', 'school', 'career-ops'), { ...mac, exists: on }, /iCloud/],
    [join(HOME, 'Library', 'CloudStorage', 'GoogleDrive-a@b.c', 'career-ops'), { ...mac, exists: off }, /cloud storage/],
    [join(HOME, 'Library', 'CloudStorage', 'Dropbox', 'career-ops'), { ...mac, exists: off }, /cloud storage/],
    ['C:\\Users\\s\\OneDrive - School\\career-ops', { home: 'C:\\Users\\s', platform: 'win32', exists: off }, /OneDrive/],
    ['C:\\Users\\s\\onedrive\\career-ops', { home: 'C:\\Users\\s', platform: 'win32', exists: off }, /OneDrive/],
    [join(HOME, 'Dropbox', 'career-ops'), { ...mac, exists: off }, /Dropbox/],
    [join(HOME, 'Google Drive', 'career-ops'), { ...mac, exists: off }, /Google Drive/],
    [join(HOME, 'My Drive', 'career-ops'), { home: HOME, platform: 'linux', exists: off }, /Google Drive/],
  ];
  for (const [path, opts, re] of table) assert.match(syncedFolder(path, opts) ?? '', re, path);
  const negatives = [
    [join(HOME, 'career-ops'), { ...mac, exists: on }],
    [join(HOME, 'Developer', 'career-ops'), { ...mac, exists: on }],
    [join(HOME, 'Desktop', 'career-ops'), { ...mac, exists: off }],
    [join(HOME, 'Documents', 'career-ops'), { ...mac, exists: off }],
    [join(HOME, 'Documents', 'career-ops'), { home: HOME, platform: 'linux', exists: on }],
  ];
  for (const [path, opts] of negatives) assert.equal(syncedFolder(path, opts), null, path);
});

test('setup refuses a synced root and points at <home>/career-ops', () =>
  withPack({}, (p) => {
    withTempDir('setup-onedrive-', (dir) => {
      const sub = join(dir, 'OneDrive', 'career-ops');
      mkdirSync(sub, { recursive: true });
      const e2 = err(() => setup({ root: sub, packRoot: p.pack, runner: fakeRunner().runner, nodeVersion: NODE_VERSION, home: HOME }));
      assert.ok(e2 instanceof InstallError);
      assert.match(e2.message, /OneDrive/);
      assert.match(e2.message, new RegExp(`${HOME.replace(/\\/g, '\\\\')}.career-ops`));
    });
  }));

test('pin is skipped when HEAD is the tag commit', () =>
  withPack({ upstreamVersion: '1.39.0' }, (p) => {
    const { runner, calls } = fakeRunner({ head: 'ccc333', tagCommit: 'ccc333' });
    const lines = run(p, { runner });
    assert.ok(lines.includes(`skipped: career-ops is already at ${TAG}`), lines.join('\n'));
    assert.equal(has(calls, 'git', 'checkout'), false);
    assert.equal(has(calls, 'git', 'fetch'), false);
  }));

test('pin runs when the version equals max but HEAD is a different commit than the tag', () =>
  withPack({ upstreamVersion: '1.39.0' }, (p) => {
    const { runner, calls } = fakeRunner();
    const lines = run(p, { runner });
    assert.equal(lines.some((l) => l.startsWith('skipped: career-ops is already')), false);
    assert.ok(has(calls, 'git', 'checkout', '-B', 'main', TAG));
    assert.ok(calls.some((c) => c.cmd === 'npm' && c.args[0] === 'install'));
  }));

test('pin checks out the compat max tag and runs npm install when career-ops is older', () =>
  withPack({}, (p) => {
    const { runner, calls } = fakeRunner();
    run(p, { runner });
    const names = calls.map((c) => `${c.cmd} ${c.args.join(' ')}`);
    assert.ok(names.includes(`git checkout -B main ${TAG}`), names.join('\n'));
    assert.equal(has(calls, 'git', 'fetch'), false, 'tag exists locally, so no fetch');
    const co = names.indexOf(`git checkout -B main ${TAG}`);
    const npm = calls.findIndex((c, i) => i > co && c.cmd === 'npm' && c.args[0] === 'install' && c.opts.cwd === realpathSync.native(p.root));
    assert.ok(npm > co, 'npm install in root after the checkout');
  }));

test('pin fetches tags first when the tag is missing locally', () =>
  withPack({}, (p) => {
    const { runner, calls } = fakeRunner({ noTag: true });
    run(p, { runner });
    const names = calls.map((c) => `${c.cmd} ${c.args.join(' ')}`);
    assert.ok(names.indexOf('git fetch --tags origin') !== -1);
    assert.ok(names.indexOf('git fetch --tags origin') < names.indexOf(`git checkout -B main ${TAG}`));
  }));

test('a dirty tracked tree is refused before any checkout', () =>
  withPack({}, (p) => {
    const { runner, calls } = fakeRunner({ status: ' M package.json' });
    const e = err(() => run(p, { runner }));
    assert.ok(e instanceof InstallError);
    assert.match(e.message, /changed tracked files/);
    assert.equal(has(calls, 'git', 'checkout'), false);
    assert.ok(calls.some((c) => c.cmd === 'git' && c.args.join(' ') === 'status --porcelain --untracked-files=no'));
  }));

test('codex config is written when missing, skipped when identical, kept when different', () =>
  withPack({ upstreamVersion: '1.39.0' }, (p) => {
    const dest = join(p.root, '.codex', 'config.toml');
    const want = readFileSync(join(p.pack, CODEX), 'utf8');
    assert.match(want, /enabled = false/);
    let lines = run(p);
    assert.equal(readFileSync(dest, 'utf8'), want);
    assert.ok(lines.some((l) => l.startsWith('done: .codex/config.toml')));
    lines = run(p);
    assert.ok(lines.some((l) => l.startsWith('skipped: .codex/config.toml already matches')));
    writeFileSync(dest, '# mine\n');
    lines = run(p);
    assert.equal(readFileSync(dest, 'utf8'), '# mine\n');
    const kept = lines.find((l) => l.includes('.codex/config.toml kept'));
    assert.ok(kept && kept.includes(CODEX) && kept.includes('Gmail'), lines.join('\n'));
  }));

test('claude settings: written when missing, merge keeps every other key and entry, invalid JSON kept', () =>
  withPack({ upstreamVersion: '1.39.0' }, (p) => {
    const dest = join(p.root, '.claude', 'settings.local.json');
    const want = JSON.parse(readFileSync(join(p.pack, CLAUDE), 'utf8'));
    run(p);
    assert.deepEqual(JSON.parse(readFileSync(dest, 'utf8')), want);

    const mine = { model: 'x', permissions: { deny: ['Bash(rm:*)'], allow: ['Bash(ls:*)', want.permissions.allow[1]] }, env: { A: '1' } };
    writeFileSync(dest, JSON.stringify(mine));
    run(p);
    const merged = JSON.parse(readFileSync(dest, 'utf8'));
    assert.equal(merged.model, 'x');
    assert.deepEqual(merged.env, { A: '1' });
    assert.deepEqual(merged.permissions.deny, ['Bash(rm:*)']);
    assert.deepEqual(merged.permissions.allow.slice(0, 2), ['Bash(ls:*)', want.permissions.allow[1]]);
    assert.deepEqual([...merged.permissions.allow].sort(), [...new Set(['Bash(ls:*)', ...want.permissions.allow])].sort());
    assert.ok(!merged.permissions.allow.some((e) => e === 'Bash' || e === 'Bash(*)'));

    writeFileSync(dest, '{ not json');
    const lines = run(p);
    assert.equal(readFileSync(dest, 'utf8'), '{ not json');
    assert.ok(lines.some((l) => l.includes('.claude/settings.local.json kept as you have it')));
  }));

test('playwright failure is a warning, not fatal; success and --skip-playwright lines', () =>
  withPack({ upstreamVersion: '1.39.0' }, (p) => {
    const failing = fakeRunner({ fail: (cmd) => cmd === 'npx' });
    const lines = run(p, { runner: failing.runner });
    const warn = lines.find((l) => l.startsWith('warning: playwright'));
    assert.equal(warn, `warning: playwright chromium install failed (npx ERR! sample failure); run "npx playwright install chromium" in ${realpathSync.native(p.root)} later`);
    assert.ok(lines.some((l) => l.startsWith('SETUP OK:')));
    const call = failing.calls.find((c) => c.cmd === 'npx');
    assert.deepEqual(call.args, ['playwright', 'install', 'chromium']);
    assert.equal(call.opts.timeout, 15 * 60 * 1000);

    const skipping = fakeRunner();
    const l2 = run(p, { runner: skipping.runner, skipPlaywright: true });
    assert.equal(skipping.calls.some((c) => c.cmd === 'npx'), false);
    assert.ok(l2.some((l) => l.startsWith('skipped: playwright')));
  }));

test('a missing generated file fails verification', () =>
  withPack({ upstreamVersion: '1.39.0' }, (p) => {
    // a runner cannot make install skip its writes, so remove the file through a fake npx call after install ran
    const { runner } = fakeRunner();
    const wrapped = (cmd, args, opts) => {
      if (cmd === 'npx') execFileSync(process.execPath, ['-e', `require('fs').rmSync(${JSON.stringify(join(p.root, 'CLAUDE.local.md'))})`]);
      return runner(cmd, args, opts);
    };
    const e = err(() => run(p, { runner: wrapped }));
    assert.ok(e instanceof InstallError);
    assert.match(e.message, /CLAUDE\.local\.md/);
  }));

test('the final lines are exact and a dry run prints neither', () =>
  withPack({ upstreamVersion: '1.39.0' }, (p) => {
    const root = realpathSync.native(p.root);
    const lines = run(p);
    assert.deepEqual(lines.slice(-2), [
      `SETUP OK: ${root}`,
      `NEXT: start the interview now. Work from ${root}, run "node student/scripts/session-start.mjs" there, and follow student/AGENTS.student.md.`,
    ]);
  }));

test('dry run writes nothing and prints would do lines only', () =>
  withPack({}, (p) => {
    const before = snapshot(p.root, { skip: ['student'] });
    const { runner, calls } = fakeRunner();
    const lines = run(p, { runner, dryRun: true });
    assert.deepEqual(snapshot(p.root, { skip: ['student'] }), before);
    assert.equal(existsSync(join(p.root, '.codex')), false);
    assert.equal(existsSync(join(p.root, '.claude')), false);
    assert.ok(lines.length > 5);
    assert.ok(lines.every((l) => !l.startsWith('SETUP OK') && !l.startsWith('NEXT:')));
    assert.ok(lines.some((l) => l.startsWith('would do: git checkout -B main')));
    for (const c of calls) {
      const mutating = (c.cmd === 'git' && ['checkout', 'fetch'].includes(c.args[0])) || ['npm', 'npx'].includes(c.cmd);
      assert.equal(mutating, false, `${c.cmd} ${c.args.join(' ')} ran in a dry run`);
    }
  }));

test('win32 runs npm.cmd and npx.cmd through a shell', () =>
  withPack({}, (p) => {
    const { runner, calls } = fakeRunner();
    run(p, { runner, platform: 'win32' });
    const tools = calls.filter((c) => /^np[mx]/.test(c.cmd));
    assert.ok(tools.length >= 3);
    for (const c of tools) {
      assert.match(c.cmd, /\.cmd$/);
      assert.equal(c.opts.shell, true);
    }
    assert.equal(calls.some((c) => c.cmd === 'npm' || c.cmd === 'npx'), false);
  }));

test('a real git checkout -B main <tag> keeps an untracked student folder', () =>
  withTempDir('setup-git-', (dir) => {
    const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.com' };
    const git = (...a) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...a], { cwd: dir, env, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    put(dir, 'package.json', '{"name":"career-ops","version":"1.39.0"}\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'one');
    git('tag', TAG);
    put(dir, 'package.json', '{"name":"career-ops","version":"1.40.0"}\n');
    git('commit', '-qam', 'two');
    put(dir, 'student/mine.txt', 'keep me\n');
    git('checkout', '-B', 'main', TAG);
    assert.equal(readFileSync(join(dir, 'student', 'mine.txt'), 'utf8'), 'keep me\n');
    assert.match(readFileSync(join(dir, 'package.json'), 'utf8'), /1\.39\.0/);
  }));

test('a dirty tree message says to show the student and never offers a discard command', () =>
  withPack({}, (p) => {
    const e = err(() => run(p, { runner: fakeRunner({ status: ' M package.json' }).runner }));
    assert.match(e.message, /show the student the changed files; never discard them/);
    assert.doesNotMatch(e.message, /git checkout \./);
  }));

test('local main commits that are not in origin/main are refused before the checkout', () =>
  withPack({}, (p) => {
    const { runner, calls } = fakeRunner({ localLog: 'abc1234 my change' });
    const e = err(() => run(p, { runner }));
    assert.ok(e instanceof InstallError);
    assert.match(e.message, /local main has commits.*show the student/);
    assert.equal(has(calls, 'git', 'checkout'), false);
    assert.ok(has(calls, 'git', 'log', '--oneline', 'origin/main..main'));
  }));

test('a kept codex config missing Gmail entries gets a warning naming them and is not rewritten', () =>
  withPack({ upstreamVersion: '1.39.0' }, (p) => {
    const dest = join(p.root, '.codex', 'config.toml');
    const want = readFileSync(join(p.pack, CODEX), 'utf8');
    const trimmed = want.replace(/\[apps\.connector_[^\]]*\.tools\.send_email\]\r?\nenabled = false\r?\n/, '').replace(/(\.tools\.delete_emails\]\r?\n)enabled = false/, '$1enabled = true');
    assert.notEqual(trimmed, want);
    mkdirSync(join(p.root, '.codex'), { recursive: true });
    writeFileSync(dest, trimmed);
    const lines = run(p);
    assert.equal(readFileSync(dest, 'utf8'), trimmed);
    const warn = lines.find((l) => l.startsWith('warning: .codex/config.toml is missing the Gmail block for'));
    assert.ok(warn, lines.join('\n'));
    assert.ok(warn.includes('send_email') && warn.includes('delete_emails') && !warn.includes('archive_emails'), warn);
    writeFileSync(dest, `${want}# mine\n`);
    assert.equal(run(p).some((l) => l.startsWith('warning: .codex')), false);
  }));

test('dry run on a checkout older than the compat minimum prints the plan instead of throwing', () =>
  withPack({ upstreamVersion: '1.0.0' }, (p) => {
    const lines = run(p, { dryRun: true });
    assert.ok(lines.some((l) => l.startsWith('would do: git checkout -B main')));
    const e = err(() => run(p));
    assert.ok(e instanceof InstallError);
  }));
