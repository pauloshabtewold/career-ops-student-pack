import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const usage = readFileSync(join(ROOT, 'docs', 'usage.md'), 'utf8');

function tuningSection() {
  const lines = usage.split('\n');
  const start = lines.findIndex((l) => l.trim() === '## Tuning the apply list and the weekly audit');
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

// M-001-S7
test('M-001-S7 the tuning section names every parsing knob', () => {
  const tuning = tuningSection();
  assert.ok(tuning.length > 0, 'tuning section missing');
  for (const needle of [
    'audit.duplicate_reason', 'rank.weights.effort', 'rank.easy_apply_hosts',
    'rank.contacts_format', 'rank.metro_match', 'rank.hold_on_pending_connect',
  ]) assert.ok(tuning.includes(needle), `missing ${needle}`);
});

// M-001-S7
test('M-001-S7 the tuning section describes the free-text hold= and reserved-slot forms', () => {
  const tuning = tuningSection();
  assert.ok(tuning.includes('hold='), 'missing hold=');
  assert.ok(tuning.includes('reserved-slot'), 'missing reserved-slot');
  assert.match(tuning, /(text|free text)[^\n]*(ignored|allowed)|(ignored|allowed)[^\n]*text/i);
});

// M-001-S7
test('M-001-S7 usage.md has no em dash and no curly quote', () => {
  for (const cp of [0x2014, 0x2018, 0x2019, 0x201c, 0x201d]) {
    const ch = String.fromCodePoint(cp);
    assert.ok(!usage.includes(ch), `usage.md has U+${cp.toString(16)}`);
  }
});
