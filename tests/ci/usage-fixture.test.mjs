// Assumed: scripts/ci/usage-fixture.mjs --rows <n> prints the fixture prompt and --print-argv prints the claude and
// codex argv of the measurement. It makes no network or agent call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fixturePrompt, syntheticPostings } from '../../scripts/ci/usage-fixture.mjs';
import { PACK_ROOT } from '../helpers/budget-harness.mjs';

const FIXTURE = join(PACK_ROOT, 'scripts', 'ci', 'usage-fixture.mjs');
const cli = (...args) => spawnSync(process.execPath, [FIXTURE, ...args], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 60000 });
const headings = (text) => (text.match(/^### https:\/\/example\.com\/jobs\/\S+$/gm) ?? []).length;
const hosts = (text) => [...text.matchAll(/https?:\/\/([^\s/'")]+)/g)].map((m) => m[1]);

// M-001-S6
test('M-001-S6 fixturePrompt is identical across calls and holds n example.com postings for 1, 5 and 20 rows', () => {
  for (const n of [1, 5, 20]) {
    const a = fixturePrompt(n);
    assert.equal(a, fixturePrompt(n));
    assert.equal(headings(a), n);
    assert.ok(a.length > n * 5400);
  }
});

// M-001-S6
test('M-001-S6 syntheticPostings gives n deterministic postings with 5400-character text on example.com urls', () => {
  for (const n of [1, 5, 20]) {
    const postings = syntheticPostings(n);
    assert.equal(postings.length, n);
    assert.deepEqual(postings, syntheticPostings(n));
    assert.equal(new Set(postings.map((p) => p.url)).size, n);
    for (const p of postings) {
      assert.match(p.url, /^https:\/\/example\.com\/jobs\/\d+$/);
      assert.match(p.company, /^Example Company \d+$/);
      assert.equal(typeof p.title, 'string');
      assert.equal(p.text.length, 5400);
      assert.doesNotMatch(p.text, /https?:\/\//);
    }
  }
});

// M-001-S6
test('M-001-S6 no host other than example.com appears in the prompt', () => {
  const found = new Set(hosts(fixturePrompt(5)));
  assert.deepEqual([...found], ['example.com']);
});

// M-001-S6
test('M-001-S6 --rows prints the same prompt on every run with that many postings', () => {
  for (const n of ['1', '5', '20']) {
    const first = cli('--rows', n);
    const second = cli('--rows', n);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, second.stdout);
    assert.equal(headings(first.stdout), Number(n));
    assert.deepEqual([...new Set(hosts(first.stdout))], ['example.com']);
  }
});

// M-001-S6
test('M-001-S6 --print-argv prints the claude and codex argv used for the measurement', () => {
  const out = cli('--print-argv');
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /--setting-sources project/);
  assert.match(out.stdout, /--strict-mcp-config/);
  assert.match(out.stdout, /--model sonnet/);
  assert.match(out.stdout, /--output-format json/);
  assert.match(out.stdout, /codex/);
  assert.match(out.stdout, /exec/);
  assert.match(out.stdout, /--json/);
});
