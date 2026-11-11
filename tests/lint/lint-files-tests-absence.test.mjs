import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintFiles } from '../../scripts/lint-files.mjs';

const dash = String.fromCodePoint(0x2014);

test('typography on a tests/ line that calls doesNotMatch is allowed, anywhere else it is a finding', () => {
  const root = mkdtempSync(join(tmpdir(), 'pack-lint-'));
  try {
    mkdirSync(join(root, 'tests'));
    writeFileSync(join(root, 'tests', 'a.test.mjs'), `assert.doesNotMatch(text, /[${dash}]/);\nconst bad = '${dash}';\n`);
    writeFileSync(join(root, 'notes.md'), `assert.doesNotMatch(x) ${dash}\n`);
    const found = lintFiles(root).map((f) => `${f.file}:${f.line}`).sort();
    assert.deepEqual(found, ['notes.md:1', 'tests/a.test.mjs:2']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
