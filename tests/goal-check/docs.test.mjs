// Checks the two maintainer-run records: docs/parity-report.md (regenerated on a scratch copy at upstream >= compat min)
// and docs/goal-check.md (the live goal-check run). Both hold counts and verdicts only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compare } from '../../lib/semver.mjs';
import { scanText } from '../../scripts/pii-lint.mjs';
import { PACK_ROOT, isVerdict, tableRows } from './_harness.mjs';

const read = (rel) => (existsSync(join(PACK_ROOT, rel)) ? readFileSync(join(PACK_ROOT, rel), 'utf8') : '');
const compatMin = () => JSON.parse(read('compat.json')).upstream.min;
const versionOf = (text) => /Upstream version:\s*(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? null;

// M-004-S9
test('M-004-S9 docs/parity-report.md names upstream at or above compat min, a feed row that ran and prefilter baseline rows above 0', () => {
  const text = read('docs/parity-report.md');
  const version = versionOf(text);
  assert.ok(version, 'Upstream version line');
  assert.ok(compare(version, compatMin()) >= 0, `${version} below ${compatMin()}`);
  const rows = tableRows(text);
  const feed = rows.find((c) => c[0] === 'feed');
  assert.ok(feed, 'feed row');
  assert.ok(!['not run', 'skipped', '-'].includes(feed[feed.length - 1]) && feed[1] !== '-', `feed row did not run: ${feed.join(' | ')}`);
  const prefilter = rows.find((c) => c[0] === 'prefilter');
  assert.ok(prefilter && Number(prefilter[1]) > 0, `prefilter baseline: ${prefilter?.join(' | ')}`);
  assert.match(text, /Prefilter input rows\D{0,5}[1-9]\d*/);
});

// M-004-S10
test('M-004-S10 docs/goal-check.md records the upstream version and a printed verdict for each of the 10 rows, counts only', () => {
  const text = read('docs/goal-check.md');
  assert.ok(text.length > 0, 'docs/goal-check.md exists');
  const version = versionOf(text);
  assert.ok(version, 'Upstream version line');
  assert.ok(compare(version, compatMin()) >= 0, `${version} below ${compatMin()}`);
  const rows = tableRows(text).filter((c) => c.length >= 4 && isVerdict(c[2]));
  assert.equal(rows.length, 10, text);
  assert.deepEqual(scanText('docs/goal-check.md', text), []);
  assert.ok(!/https?:\/\//i.test(text), 'no URL');
  assert.match(text, /stand-in/i);
  assert.match(text, /PROXY/);
});

// M-004-S13
test('M-004-S13 every row in docs/goal-check.md is met or not met and a not met row names its failed check', () => {
  const text = read('docs/goal-check.md');
  const rows = tableRows(text).filter((c) => c.length >= 4 && isVerdict(c[2]));
  assert.equal(rows.length, 10, 'ten design-goal rows');
  for (const c of rows) {
    assert.ok(c[1].length >= 3, `deciding check named: ${c.join(' | ')}`);
    if (c[2] === 'not met') assert.match(c.join(' '), /failed check/i, c.join(' | '));
  }
});
