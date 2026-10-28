// Assumed: scripts/check-plugin-versions.mjs exports checkPluginVersions({ packRoot, base }) -> { ok, offenders }
// where offenders lists the plugin ids (strings, or objects with id) whose files changed since base without a
// greater manifest.json version. CLI: `node scripts/check-plugin-versions.mjs <base>` run from the pack root,
// exit 0 clean, 1 with the plugin id printed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPluginVersions } from '../../scripts/check-plugin-versions.mjs';
import { git, put } from './_pack-repo.mjs';
import { PACK_ROOT } from '../helpers/budget-harness.mjs';

const manifest = (version) => `${JSON.stringify({ id: 'x', version, apiVersion: 1 }, null, 2)}\n`;

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'pack-versions-'));
  git(root, 'init', '-q');
  cpSync(join(PACK_ROOT, 'lib'), join(root, 'lib'), { recursive: true });
  symlinkSync(join(PACK_ROOT, 'node_modules'), join(root, 'node_modules'));
  cpSync(join(PACK_ROOT, 'scripts'), join(root, 'scripts'), { recursive: true });
  put(root, '.gitignore', 'node_modules/\n');
  for (const id of ['alpha', 'beta']) {
    put(root, `plugins/${id}/manifest.json`, manifest('1.0.0'));
    put(root, `plugins/${id}/index.mjs`, 'export const v = 1;\n');
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  git(root, 'tag', 'base');
  return root;
}
async function withRepo(fn) {
  const root = scratch();
  try {
    await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
async function verdict(root, mutate) {
  mutate(root);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'head');
  const res = await checkPluginVersions({ packRoot: root, base: 'base' });
  const ids = (res.offenders ?? []).map((o) => (typeof o === 'string' ? o : o.id ?? o.plugin));
  return { ok: res.ok, ids };
}
const cli = (root, ...args) => spawnSync(process.execPath, [join(root, 'scripts', 'check-plugin-versions.mjs'), ...args], { cwd: root, encoding: 'utf8' });

// M-005-S14
test('M-005-S14 a changed plugin file without a version bump is an offender', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => put(root, 'plugins/alpha/index.mjs', 'export const v = 2;\n'));
    assert.equal(v.ok, false);
    assert.deepEqual(v.ids, ['alpha']);
  }));

// M-005-S14
test('M-005-S14 a changed plugin file with a greater manifest version passes', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => {
      put(root, 'plugins/alpha/index.mjs', 'export const v = 2;\n');
      put(root, 'plugins/alpha/manifest.json', manifest('1.0.1'));
    });
    assert.equal(v.ok, true);
    assert.deepEqual(v.ids, []);
  }));

// M-005-S14
test('M-005-S14 a lowered or equal manifest version does not count as an increase', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => {
      put(root, 'plugins/alpha/index.mjs', 'export const v = 2;\n');
      put(root, 'plugins/alpha/manifest.json', manifest('0.9.0'));
      put(root, 'plugins/beta/manifest.json', `${JSON.stringify({ id: 'x', version: '1.0.0', apiVersion: 1, description: 'edited' }, null, 2)}\n`);
    });
    assert.equal(v.ok, false);
    assert.deepEqual([...v.ids].sort(), ['alpha', 'beta']);
  }));

// M-005-S14
test('M-005-S14 a tree with no plugin changes passes', () =>
  withRepo(async (root) => {
    const v = await verdict(root, () => put(root, 'README.md', 'Readme.\n'));
    assert.equal(v.ok, true);
  }));

// M-005-S14
test('M-005-S14 the CLI exits 1 naming the plugin and 0 after a bump', () =>
  withRepo((root) => {
    put(root, 'plugins/beta/index.mjs', 'export const v = 2;\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'change');
    const bad = cli(root, 'base');
    assert.equal(bad.status, 1, bad.stdout + bad.stderr);
    assert.match(bad.stdout + bad.stderr, /beta/);
    assert.doesNotMatch(bad.stdout + bad.stderr, /alpha/);
    put(root, 'plugins/beta/manifest.json', manifest('1.1.0'));
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'bump');
    const good = cli(root, 'base');
    assert.equal(good.status, 0, good.stdout + good.stderr);
  }));
