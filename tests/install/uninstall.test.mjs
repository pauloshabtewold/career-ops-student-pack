// Assumed: uninstall.mjs is a CLI at the pack root (run as `node student/uninstall.mjs --root <career-ops checkout>`)
// that undoes install.mjs and the schedule step, keeps the student's own files, and exits 0 when every step worked.
// The CLI tests pass --skip-schedule so a developer's real launchd agent or Windows task is never touched; the
// schedule step is covered through the exported functions with a scratch home folder and a recording runner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makePack, put } from './_pack-repo.mjs';
import { removeLines, scheduleOwner, uninstall, withoutBlocks } from '../../uninstall.mjs';
import { buildPlist, LABEL } from '../../scripts/schedule.mjs';

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
      calls.push(args);
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
