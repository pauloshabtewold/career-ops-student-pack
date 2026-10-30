import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });

test('package.json basics', () => {
  assert.equal(pkg.name, 'career-ops-student-pack');
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.engines.node, '^22.13.0 || >=23.4.0');
  assert.deepEqual(pkg.dependencies, { 'js-yaml': '5.5.0' });
  assert.equal(pkg.devDependencies?.['js-yaml'], undefined);
  for (const k of ['repository', 'homepage', 'author']) assert.ok(!(k in pkg), k);
});

// M-001-S14
test('M-001-S14 test and lint scripts', () => {
  assert.equal(pkg.scripts.test, 'node --test --test-concurrency=1');
  assert.ok(pkg.scripts.lint.includes('node scripts/lint-files.mjs'));
  assert.equal(pkg.scripts.hooks, 'git config core.hooksPath .githooks');
});

// M-001-S15
test('M-001-S15 git check-attr reports eol lf', () => {
  for (const p of ['a.mjs', 'a.js', 'a.json', 'a.md', 'a.yml', 'a.yaml']) {
    assert.match(git('check-attr', 'eol', '--', p).trim(), /: eol: lf$/, p);
  }
});

// M-001-S18
test('M-001-S18 pre-push hook is stored with index mode 100755', () => {
  const entry = git('ls-files', '-s', '--', '.githooks/pre-push');
  assert.match(entry, /^100755 /);
});
