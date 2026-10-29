// Command contract for the docs: every `node student/...` command in README, docs, modes and the interview names a script
// on disk and shows only flags that script declares. Problems are reported as file:line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOC_FILES, readDoc, scanCommands } from '../helpers/doc-contract.mjs';

// M-003-S4
test('M-003-S4 every node student/ command in the docs names an existing script and declared flags', () => {
  const problems = DOC_FILES.flatMap((f) => scanCommands(f, readDoc(f)));
  assert.deepEqual(problems, []);
});

// M-003-S4
test('M-003-S4 the scanner finds the commands the docs are known to show', () => {
  const text = [readDoc('README.md'), readDoc('interview/interview.md'), readDoc('modes/apply-loop.md')].join('\n');
  assert.match(text, /node student\/scripts\/rank-queue\.mjs/);
  assert.deepEqual(scanCommands('x.md', 'run `node student/scripts/rank-queue.mjs --n 10` now'), []);
});

// M-003-S10
test('M-003-S10 a doc command naming a missing script fails with file and line', () => {
  const problems = scanCommands('docs/example.md', 'intro\n\n`node student/scripts/not-a-script.mjs`\n');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^docs\/example\.md:3:/);
  assert.match(problems[0], /not-a-script\.mjs/);
});

// M-003-S10
test('M-003-S10 a doc command with an undeclared flag fails with file and line', () => {
  const problems = scanCommands('modes/example.md', 'a\nb\n```\nnode student/scripts/rank-queue.mjs --bogus 3\n```\n');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^modes\/example\.md:4:/);
  assert.match(problems[0], /--bogus/);
});

// M-003-S10
test('M-003-S10 common flags and declared flags pass', () => {
  assert.deepEqual(scanCommands('x.md', 'node student/scripts/rank-queue.mjs --n 10 --json --dry-run'), []);
  assert.deepEqual(scanCommands('x.md', 'node student/scripts/check-resume.mjs --pdf a.pdf --html a.html --variant swe'), []);
});

// M-003-S4
test('M-003-S4 modes/apply-loop.md check-resume uses --pdf --html --variant', () => {
  const doc = readDoc('modes/apply-loop.md');
  const line = doc.split('\n').find((l) => l.includes('check-resume.mjs'));
  assert.ok(line);
  for (const f of ['--pdf', '--html', '--variant']) assert.ok(line.includes(f), f);
  assert.ok(!line.includes('--source'));
});
