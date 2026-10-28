// Asserts docs/usage.md names each command and backend, README.md links it, and neither leaks an owner handle,
// a repo URL, an em dash or curly quotes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const read = (rel) => readFileSync(join(PACK_ROOT, rel), 'utf8');

// M-008-S14
test('M-008-S14 docs/usage.md names the interview, schedule install and remove, daily, inbox backends and pilot-report', () => {
  const usage = read('docs/usage.md');
  assert.match(usage, /session-start/);
  assert.match(usage, /interview/i);
  assert.match(usage, /student\/scripts\/schedule\.mjs/);
  assert.match(usage, /schedule\.mjs install/);
  assert.match(usage, /schedule\.mjs remove/);
  assert.match(usage, /daily\.mjs/);
  for (const backend of ['connector', 'paste', 'gmail-plugin']) assert.ok(usage.includes(backend), backend);
  assert.match(usage, /pilot-report\.mjs/);
  assert.match(usage, /stop outreach/);
  assert.match(usage, /stop handshake/);
});

// M-008-S14
test('M-008-S14 docs/usage.md uses placeholders and plain punctuation', () => {
  const usage = read('docs/usage.md');
  assert.ok(!/github\.com\//i.test(usage), 'no repo URL');
  assert.ok(!/[\u2014\u2018\u2019\u201C\u201D]/.test(usage), 'no em dash or curly quotes');
});

// M-008-S14
test('M-008-S14 README.md links docs/usage.md from a Daily use section after Install and Update', () => {
  const readme = read('README.md');
  assert.match(readme, /\]\(docs\/usage\.md\)/);
  const daily = readme.indexOf('## Daily use');
  assert.ok(daily > readme.indexOf('## Install'), 'Daily use follows Install');
  assert.ok(daily > readme.indexOf('## Update'), 'Daily use follows Update');
  assert.ok(readme.indexOf('docs/usage.md') > daily, 'the link sits in or after the Daily use section');
  for (const word of ['interview', 'schedule', 'daily', 'inbox', 'pilot']) {
    assert.ok(readme.slice(daily).toLowerCase().includes(word), `Daily use mentions ${word}`);
  }
});
