// Assumed: uninstall.mjs is a CLI at the pack root (run as `node student/uninstall.mjs --root <career-ops checkout>`)
// that undoes install.mjs and the schedule step, keeps the student's own files, and exits 0 when every step worked.
// The CLI tests pass --skip-schedule so a developer's real launchd agent or Windows task is never touched; the
// schedule step is covered through the exported functions with a scratch home folder and a recording runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { makePack, put } from './_pack-repo.mjs';
import { gitExcludePath, install } from '../../install.mjs';
import { defaultRunner } from '../../lib/upstream.mjs';
import { removeLines, scheduleOwner, uninstall, withoutBlocks } from '../../uninstall.mjs';
import { REMOVE_ABSENT, TASK_NAME, buildPlist, LABEL, removeOutcome, removeScript } from '../../scripts/schedule.mjs';

async function withPack(fn) {
  const p = makePack({});
  try {
    await fn(p);
  } finally {
    p.cleanup();
  }
}

const read = (root, rel) => readFileSync(join(root, rel), 'utf8');

// W-015-U1
test('W-015-U1 uninstall after install leaves no pack entry and keeps the student files', () =>
  withPack((p) => {
    assert.equal(p.run('install.mjs', ['--yes', '--skip-npm']).code, 0);
    put(p.root, 'config/student.yml', 'timezone: America/Chicago\n');
    put(p.root, 'data/applications.md', '# Applications\n');
    put(p.root, 'cv.md', '# Example Student\n');
    const r = p.run('uninstall.mjs', ['--skip-schedule']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.equal(existsSync(join(p.root, 'CLAUDE.local.md')), false, 'CLAUDE.local.md held only the pack block');
    assert.equal(existsSync(join(p.root, 'AGENTS.override.md')), false, 'AGENTS.override.md held only generated blocks');
    const exclude = read(p.root, '.git/info/exclude').split(/\r?\n/);
    for (const e of ['student/', 'CLAUDE.local.md', 'AGENTS.override.md', '.codex/config.toml']) assert.ok(!exclude.includes(e), `exclude still lists ${e}`);
    assert.ok(exclude.includes('config/student.yml'), 'config/student.yml must stay excluded while it exists');
    const local = read(p.root, 'config/local-paths.txt').split(/\r?\n/);
    for (const e of ['student/', 'CLAUDE.local.md', 'AGENTS.override.md', '.codex/config.toml']) assert.ok(!local.includes(e), `local-paths still lists ${e}`);
    for (const f of ['config/student.yml', 'data/applications.md', 'cv.md']) assert.ok(existsSync(join(p.root, f)), `${f} was deleted`);
    assert.ok(p.upstreamCalls().some((c) => c.cli === 'plugins.mjs' && c.argv[0] === 'remove' && c.argv[1] === 'github-lists'), 'pack plugin removed through upstream');
    assert.ok(r.stdout.includes('delete the student folder'), 'last step names the student folder');
  }));

// W-015-U2
test('W-015-U2 uninstall keeps text the student wrote around the pack blocks', () =>
  withPack((p) => {
    put(p.root, 'CLAUDE.local.md', 'My own note.\n');
    assert.equal(p.run('install.mjs', ['--yes', '--skip-npm']).code, 0);
    const override = read(p.root, 'AGENTS.override.md');
    writeFileSync(join(p.root, 'AGENTS.override.md'), `${override}\nLocal note: synthetic test line.\n`);
    assert.equal(p.run('uninstall.mjs', ['--skip-schedule']).code, 0);
    assert.equal(read(p.root, 'CLAUDE.local.md'), 'My own note.\n');
    const after = read(p.root, 'AGENTS.override.md');
    assert.equal(after, 'Local note: synthetic test line.\n');
  }));

// W-015-U3
test('W-015-U3 uninstall --dry-run changes nothing and a second uninstall is a no-op', () =>
  withPack((p) => {
    assert.equal(p.run('install.mjs', ['--yes', '--skip-npm']).code, 0);
    const before = { claude: read(p.root, 'CLAUDE.local.md'), exclude: read(p.root, '.git/info/exclude') };
    const dry = p.run('uninstall.mjs', ['--skip-schedule', '--dry-run']);
    assert.equal(dry.code, 0);
    assert.match(dry.stdout, /would do: CLAUDE\.local\.md/);
    assert.deepEqual({ claude: read(p.root, 'CLAUDE.local.md'), exclude: read(p.root, '.git/info/exclude') }, before);
    // W-023-A5-1: a dry run must not call upstream's plugin removal either.
    assert.ok(!p.upstreamCalls().some((c) => c.cli === 'plugins.mjs' && c.argv[0] === 'remove'), 'dry run calls no plugins.mjs remove');
    assert.ok(existsSync(join(p.root, 'plugins.local', 'github-lists')), 'plugin copy is still there after a dry run');
    assert.equal(p.run('uninstall.mjs', ['--skip-schedule']).code, 0);
    const again = p.run('uninstall.mjs', ['--skip-schedule']);
    assert.equal(again.code, 0);
    assert.doesNotMatch(again.stdout, /removed the pack entries|deleted/);
  }));

// W-015-U4
test('W-015-U4 uninstall removes the macOS schedule only when it runs this career-ops folder', () => {
  const home = mkdtempSync(join(tmpdir(), 'uninstall-home-'));
  try {
    const agents = join(home, 'Library', 'LaunchAgents');
    mkdirSync(agents, { recursive: true });
    const plist = join(agents, `${LABEL}.plist`);
    const root = '/Users/example/career & ops';
    assert.equal(scheduleOwner({ root, platform: 'darwin', home }), 'none');
    writeFileSync(plist, buildPlist({ nodePath: '/usr/local/bin/node', root, time: '06:30' }));
    assert.equal(scheduleOwner({ root, platform: 'darwin', home }), 'this');
    assert.equal(scheduleOwner({ root: '/Users/example/other', platform: 'darwin', home }), 'other');
    assert.equal(scheduleOwner({ root, platform: 'win32', home }), 'this');

    const calls = [];
    const runner = (cmd, args) => {
      if (cmd !== 'git') calls.push(args);
      return '';
    };
    const packRoot = mkdtempSync(join(tmpdir(), 'uninstall-pack-'));
    try {
      const other = uninstall({ root: '/Users/example/other', packRoot, runner, platform: 'darwin', home });
      assert.ok(other.actions.some((a) => a.includes('different career-ops folder')));
      assert.equal(calls.length, 0, 'a schedule for another folder is left alone');
      const dry = uninstall({ root, packRoot, runner, platform: 'darwin', home, dryRun: true });
      assert.ok(dry.actions.includes('schedule: would remove'), 'W-023-A5-1 a dry run names the schedule removal');
      assert.equal(calls.length, 0, 'W-023-A5-1 a dry run runs no schedule removal');
      const mine = uninstall({ root, packRoot, runner, platform: 'darwin', home });
      assert.ok(mine.actions.includes('schedule: removed'));
      assert.deepEqual(calls[0].slice(1), ['remove', '--root', root]);
      const failing = uninstall({ root, packRoot, platform: 'darwin', home, runner: () => { throw Object.assign(new Error('boom'), { stderr: 'launchctl said no' }); } });
      assert.match(failing.problems[0], /schedule: remove failed \(launchctl said no\)/);
    } finally {
      rmSync(packRoot, { recursive: true, force: true });
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// W-015-U5
test('W-015-U5 line and block removal keep CRLF endings and unrelated text', () => {
  assert.equal(removeLines('node_modules\r\nstudent/\r\nmine\r\n', ['student/']), 'node_modules\r\nmine\r\n');
  assert.equal(withoutBlocks('<!-- student-pack:start -->x<!-- student-pack:end -->\n', [/<!-- student-pack:start -->[\s\S]*?<!-- student-pack:end -->/]), '');
  assert.equal(withoutBlocks('keep\n<!-- student-pack:start -->x<!-- student-pack:end -->\n', [/<!-- student-pack:start -->[\s\S]*?<!-- student-pack:end -->/]), 'keep\n');
});

// W-023-A2-2
for (const file of ['CLAUDE.local.md', 'AGENTS.override.md']) {
  test(`W-023-A2-2 uninstall keeps the ignore lines for ${file} while it keeps the file`, () =>
    withPack((p) => {
      assert.equal(p.run('install.mjs', ['--yes', '--skip-npm']).code, 0);
      const mine = `${read(p.root, file)}\nMy private notes, synthetic.\n`;
      writeFileSync(join(p.root, file), mine);
      const r = p.run('uninstall.mjs', ['--skip-schedule']);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.ok(read(p.root, file).includes('My private notes, synthetic.'), `${file} is kept`);
      assert.ok(read(p.root, '.git/info/exclude').split(/\r?\n/).includes(file), `exclude still lists ${file}`);
      assert.ok(read(p.root, 'config/local-paths.txt').split(/\r?\n/).includes(file), `local-paths still lists ${file}`);
      const other = file === 'CLAUDE.local.md' ? 'AGENTS.override.md' : 'CLAUDE.local.md';
      assert.ok(!read(p.root, '.git/info/exclude').split(/\r?\n/).includes(other), `${other} was deleted, so its line goes`);
    }));
}

// W-024-A2-5
test('W-024-A2-5 on Windows uninstall asks the task for its folder and removes only a task that runs this one', () => {
  const root = 'C:\\Users\\Example\\career-ops';
  const packRoot = mkdtempSync(join(tmpdir(), 'uninstall-pack-'));
  const calls = [];
  const asking = (out) => (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'powershell.exe') return out;
    return 'ok';
  };
  try {
    assert.equal(scheduleOwner({ root, platform: 'win32', runner: asking('') }), 'none');
    assert.equal(scheduleOwner({ root, platform: 'win32', runner: asking('c:\\users\\example\\CAREER-OPS\\\r\n') }), 'this');
    assert.equal(scheduleOwner({ root, platform: 'win32', runner: asking('C:\\Users\\Example\\other\r\n') }), 'other');
    assert.equal(scheduleOwner({ root, platform: 'win32', runner: () => { throw new Error('no powershell'); } }), 'this');
    assert.match(calls[0][4], /Get-ScheduledTask -TaskName 'career-ops-student-daily'/);
    // PowerShell pipes stdout in the OEM code page, which would garble a root such as C:\\Users\\José.
    assert.match(calls[0][4], /^\[Console\]::OutputEncoding = \[System\.Text\.Encoding\]::UTF8;/);

    calls.length = 0;
    const none = uninstall({ root, packRoot, platform: 'win32', runner: asking('') });
    assert.ok(none.actions.includes('schedule: none installed'));
    const other = uninstall({ root, packRoot, platform: 'win32', runner: asking('D:\\elsewhere') });
    assert.ok(other.actions.some((a) => a.includes('different career-ops folder')));
    assert.equal(calls.filter((c) => c[1] === undefined || String(c[1]).endsWith('schedule.mjs')).length, 0, 'no remove ran');
    const mine = uninstall({ root, packRoot, platform: 'win32', runner: asking('C:\\Users\\Example\\career-ops') });
    assert.ok(mine.actions.includes('schedule: removed'));
    const missing = uninstall({ root, packRoot, platform: 'win32', runner: (cmd, args) => (cmd === 'powershell.exe' ? (() => { throw new Error('x'); })() : `${TASK_NAME} was not registered\n`) });
    assert.ok(missing.actions.includes('schedule: none installed'), 'a remove that found no task does not claim removal');
    const failing = uninstall({ root, packRoot, platform: 'win32', runner: (cmd) => {
      if (cmd === 'powershell.exe') return root;
      if (cmd === 'git') return '';
      throw Object.assign(new Error('Command failed: node schedule.mjs remove'), { stderr: '', stdout: 'Unregister-ScheduledTask failed: Access is denied\n' });
    } });
    assert.ok(failing.problems.some((p) => p.includes('Access is denied')), failing.problems.join('\n'));
  } finally {
    rmSync(packRoot, { recursive: true, force: true });
  }
});

// W-024-A2-5
test('W-024-A2-5 the Windows remove script tells "not registered" from a real Unregister failure', () => {
  assert.match(removeScript(), /Get-ScheduledTask -TaskName 'career-ops-student-daily' -ErrorAction SilentlyContinue/);
  assert.match(removeScript(), /Unregister-ScheduledTask/);
  assert.deepEqual(removeOutcome({ ok: true, out: `${REMOVE_ABSENT}\n` }), { line: `${TASK_NAME} was not registered`, code: 0 });
  assert.deepEqual(removeOutcome({ ok: true, out: '' }), { line: `removed ${TASK_NAME}`, code: 0 });
  assert.deepEqual(removeOutcome({ ok: false, out: 'Access is denied\nmore' }), { line: 'Unregister-ScheduledTask failed: Access is denied', code: 1 });
});

// W-024-A2-7
const EXCLUDE_ENTRIES = ['student/', 'CLAUDE.local.md', 'AGENTS.override.md', '.codex/config.toml', 'config/student.yml'];

function gitFileRoot() {
  const p = makePack({});
  // Turn the scratch root's .git directory into a gitdir file, as a worktree or --separate-git-dir checkout has.
  const real = mkdtempSync(join(tmpdir(), 'real-gitdir-'));
  rmSync(real, { recursive: true });
  renameSync(join(p.root, '.git'), real);
  writeFileSync(join(p.root, '.git'), `gitdir: ${real}\n`);
  const cleanup = p.cleanup;
  p.cleanup = () => {
    cleanup();
    rmSync(real, { recursive: true, force: true });
  };
  p.gitdir = real;
  return p;
}

test('W-024-A2-7 install and uninstall use the exclude file git names when .git is a file', () =>
  (async () => {
    const p = gitFileRoot();
    try {
      const inst = p.run('install.mjs', ['--yes', '--skip-npm']);
      assert.equal(inst.code, 0, inst.stdout + inst.stderr);
      const exclude = join(p.gitdir, 'info', 'exclude');
      const have = readFileSync(exclude, 'utf8').split(/\r?\n/);
      for (const e of EXCLUDE_ENTRIES) assert.ok(have.includes(e), `exclude lacks ${e}`);
      const un = p.run('uninstall.mjs', ['--skip-schedule']);
      assert.equal(un.code, 0, un.stdout + un.stderr);
      const after = readFileSync(exclude, 'utf8').split(/\r?\n/);
      for (const e of ['student/', 'CLAUDE.local.md', 'AGENTS.override.md', '.codex/config.toml']) assert.ok(!after.includes(e), `exclude still lists ${e}`);
    } finally {
      p.cleanup();
    }
  })());

test('W-024-A2-7 install and uninstall skip the exclude step, with a line, when git cannot name the file', () =>
  withPack((p) => {
    const quiet = (cmd, args) => {
      if (cmd === 'git' && args[0] === 'rev-parse') throw new Error('fatal: not a git repository');
      return '';
    };
    const before = existsSync(join(p.root, '.git', 'info', 'exclude')) ? read(p.root, '.git/info/exclude') : null;
    const res = install({ root: p.root, packRoot: p.pack, runner: quiet, nodeVersion: process.versions.node, skipNpm: true });
    assert.ok(res.actions.some((a) => a.startsWith('.git/info/exclude: skipped')), res.actions.join('\n'));
    assert.ok(existsSync(join(p.root, 'CLAUDE.local.md')), 'the other steps still ran');
    assert.equal(existsSync(join(p.root, '.git', 'info', 'exclude')) ? read(p.root, '.git/info/exclude') : null, before);
    const un = uninstall({ root: p.root, packRoot: p.pack, runner: quiet, skipSchedule: true });
    assert.ok(un.actions.some((a) => a.startsWith('.git/info/exclude: skipped')), un.actions.join('\n'));
    assert.deepEqual(un.problems, []);
  }));

// W-024-A2-8
const DISMISS = '.update-dismissed';
const dismissCase = (name, content, args, expectKept, expectLine) =>
  test(`W-024-A2-8 ${name}`, () =>
    withPack((p) => {
      put(p.root, DISMISS, content);
      const r = p.run('uninstall.mjs', ['--skip-schedule', ...args]);
      assert.equal(r.code, 0, r.stdout + r.stderr);
      assert.equal(existsSync(join(p.root, DISMISS)), expectKept, name);
      if (expectLine) assert.match(r.stdout, expectLine);
    }));
dismissCase('uninstall removes a dismiss marker for a version outside the pack range', '{"version":"1.39.0","at":"2026-10-01T00:00:00.000Z"}\n', [], false, /\.update-dismissed: removed/);
dismissCase('uninstall keeps a dismiss marker for a version inside the pack range', '{"version":"1.38.0","at":"2026-10-01T00:00:00.000Z"}\n', [], true);
dismissCase('uninstall keeps an older bare-timestamp dismiss marker', '2026-10-01T00:00:00.000Z\n', [], true);
dismissCase('uninstall keeps an unparsable dismiss marker', '{"version":', [], true);
dismissCase('uninstall --dry-run says it would remove the marker and keeps it', '{"version":"1.39.0","at":"2026-10-01T00:00:00.000Z"}\n', ['--dry-run'], true, /would do: \.update-dismissed: would remove/);

test('W-024-A2-7 a career-ops folder inside another repository does not write that repository\'s exclude file', () => {
  const outer = mkdtempSync(join(tmpdir(), 'enclosing-repo-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: outer });
    mkdirSync(join(outer, 'career-ops'));
    assert.equal(gitExcludePath(join(outer, 'career-ops'), defaultRunner), null);
    assert.equal(realpathSync.native(gitExcludePath(outer, defaultRunner)), realpathSync.native(join(outer, '.git', 'info')) + sep + 'exclude');
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});
