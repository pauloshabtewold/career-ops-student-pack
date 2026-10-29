// Assumed: install.mjs is a CLI at the pack root (run as `node student/install.mjs --root <career-ops checkout>`);
// it treats <root> as the upstream checkout and the pack as <root>/student, exits 0 on success and 1 with a
// one-line instruction on refusal. Flags: --root --dry-run --yes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePack, put, snapshot } from './_pack-repo.mjs';

const BLOCK = /<!-- student-pack:start -->\s*@student\/AGENTS\.student\.md\s*<!-- student-pack:end -->/;
const lines = (text) => text.split(/\r?\n/);

function listFiles(dir, base = dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isDirectory()) listFiles(abs, base, out);
    else out.push(abs.slice(base.length + 1));
  }
  return out.sort();
}

async function withPack(opts, fn) {
  const p = makePack(opts);
  try {
    await fn(p);
  } finally {
    p.cleanup();
  }
}

// M-005-S1
test('M-005-S1 install writes local-paths, exclude entries, the CLAUDE.local.md block and plugin copies', () =>
  withPack({}, (p) => {
    const r = p.run('install.mjs', ['--yes', '--skip-npm']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const paths = lines(readFileSync(join(p.root, 'config', 'local-paths.txt'), 'utf8'));
    assert.ok(paths.includes('student/'), 'local-paths.txt lacks student/');
    assert.ok(paths.includes('CLAUDE.local.md'), 'local-paths.txt lacks CLAUDE.local.md');
    const exclude = lines(readFileSync(join(p.root, '.git', 'info', 'exclude'), 'utf8'));
    for (const e of ['student/', 'CLAUDE.local.md', 'config/student.yml']) assert.ok(exclude.includes(e), `exclude lacks ${e}`);
    assert.match(readFileSync(join(p.root, 'CLAUDE.local.md'), 'utf8'), BLOCK);
    const src = join(p.pack, 'plugins');
    for (const id of readdirSync(src)) {
      assert.deepEqual(listFiles(join(p.root, 'plugins.local', id)), listFiles(join(src, id)), `plugin ${id} not fully copied`);
      assert.equal(readFileSync(join(p.root, 'plugins.local', id, 'manifest.json'), 'utf8'), readFileSync(join(src, id, 'manifest.json'), 'utf8'));
    }
    assert.ok(r.stdout.toLowerCase().includes('claude code'), 'next step should mention opening the folder in Claude Code');
  }));

// M-005-S1
test('M-005-S1 install never enables a plugin and writes no settings file', () =>
  withPack({}, (p) => {
    const r = p.run('install.mjs', ['--yes', '--skip-npm']);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    const yml = join(p.root, 'config', 'plugins.yml');
    if (existsSync(yml)) assert.doesNotMatch(readFileSync(yml, 'utf8'), /enabled:\s*true/);
    assert.equal(existsSync(join(p.root, '.claude', 'settings.json')), false);
    assert.equal(existsSync(join(p.root, 'config', 'student.yml')), false);
  }));

// M-005-S2
test('M-005-S2 a second install changes no file and user lines survive', () =>
  withPack({}, (p) => {
    put(p.root, 'config/local-paths.txt', 'my-notes/\r\nmy-drafts/\r\n');
    put(p.root, 'CLAUDE.local.md', 'My own rule one.\n\nMy own rule two.\n');
    const first = p.run('install.mjs', ['--yes', '--skip-npm']);
    assert.equal(first.code, 0, first.stdout + first.stderr);
    const before = snapshot(p.root, { skip: ['student'] });
    const second = p.run('install.mjs', ['--yes', '--skip-npm']);
    assert.equal(second.code, 0, second.stdout + second.stderr);
    assert.deepEqual(snapshot(p.root, { skip: ['student'] }), before);
    const paths = readFileSync(join(p.root, 'config', 'local-paths.txt'), 'utf8');
    assert.ok(paths.startsWith('my-notes/\r\nmy-drafts/\r\n'));
    assert.ok(!/(^|[^\r])\n/.test(paths), 'CRLF line endings were not preserved');
    const md = readFileSync(join(p.root, 'CLAUDE.local.md'), 'utf8');
    assert.ok(md.includes('My own rule one.') && md.includes('My own rule two.'));
    assert.equal(md.match(/student-pack:start/g).length, 1);
  }));

// M-005-S3
test('M-005-S3 install refuses an upstream below 1.38.0 with one line and writes nothing', () =>
  withPack({ upstreamVersion: '1.37.0' }, (p) => {
    const before = snapshot(p.root, { skip: ['student'] });
    const r = p.run('install.mjs', ['--yes', '--skip-npm']);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.equal(r.lines.length, 1, r.lines.join('\n'));
    assert.match(r.lines[0], /1\.38\.0/);
    assert.deepEqual(snapshot(p.root, { skip: ['student'] }), before);
    assert.equal(existsSync(join(p.root, 'plugins.local', 'github-lists')), false);
  }));

// M-005-S3
test('M-005-S3 install refuses a directory that is not a career-ops checkout and writes nothing', () =>
  withPack({ checkout: false }, (p) => {
    const before = snapshot(p.root, { skip: ['student'] });
    const r = p.run('install.mjs', ['--yes', '--skip-npm']);
    assert.equal(r.code, 1, r.stdout + r.stderr);
    assert.equal(r.lines.length, 1, r.lines.join('\n'));
    assert.deepEqual(snapshot(p.root, { skip: ['student'] }), before);
  }));
