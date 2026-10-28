// M-009-S8. Regression guard on the existing mode index and relative links, plus one test that is red until the
// milestone adds docs/maintenance.md. Failure messages name the missing path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const read = (rel) => readFileSync(join(PACK_ROOT, rel), 'utf8');

function modePaths(agentsText) {
  const paths = [];
  for (const l of agentsText.split('\n')) {
    const m = l.match(/^\|\s*`((?:modes|interview)\/[^`]+)`\s*\|/);
    if (m) paths.push(m[1]);
  }
  return paths;
}

function relativeLinks(rel) {
  const out = [];
  for (const m of read(rel).matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1].split('#')[0];
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    out.push({ from: rel, target, abs: resolve(PACK_ROOT, dirname(rel), target) });
  }
  return out;
}

test('M-009-S8 every mode path in the AGENTS.student.md index exists', () => {
  const paths = modePaths(read('AGENTS.student.md'));
  assert.ok(paths.length >= 6, 'mode index parsed');
  const missing = paths.filter((p) => !existsSync(join(PACK_ROOT, p)));
  assert.deepEqual(missing, [], `missing mode paths: ${missing.join(', ')}`);
});

test('M-009-S8 every relative link in README.md and docs/*.md exists', () => {
  const files = ['README.md', ...readdirSync(join(PACK_ROOT, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];
  const missing = files.flatMap(relativeLinks).filter((l) => !existsSync(l.abs)).map((l) => `${l.from} -> ${l.target}`);
  assert.deepEqual(missing, [], `missing link targets: ${missing.join('; ')}`);
});

test('M-009-S8 the maintainer runbook docs/maintenance.md exists', () => {
  assert.ok(existsSync(join(PACK_ROOT, 'docs', 'maintenance.md')), 'missing path: docs/maintenance.md');
});
