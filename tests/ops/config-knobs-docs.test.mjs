import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const doc = (name) => readFileSync(join(ROOT, 'docs', name), 'utf8');

// Text from the heading line to the next '## ' heading.
function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

// M-004-S1
test('M-004-S1 docs/usage.md names every audit and rank knob and the pipeline note tokens', () => {
  const usage = doc('usage.md');
  const needles = [
    'audit.exclude_reasons', 'audit.require_triage', 'audit.keyword_match',
    'rank.company_caps', 'rank.intern_only', 'rank.one_track_per_company',
    'rank.ignore_words', 'hold=', 'reserved-slot',
  ];
  for (const needle of needles) assert.ok(usage.includes(needle), `missing ${needle}`);
});

// M-004-S1
test('M-004-S1 the tuning section sits before Turning things off and holds the knobs', () => {
  const usage = doc('usage.md');
  const heading = '## Tuning the apply list and the weekly audit';
  const tuning = section(usage, heading);
  assert.ok(tuning.length > 0, 'tuning section missing');
  assert.ok(usage.indexOf(heading) < usage.indexOf('## Turning things off'));
  for (const needle of ['audit.exclude_reasons', 'rank.company_caps', 'hold=', 'reserved-slot']) {
    assert.ok(tuning.includes(needle), `tuning section missing ${needle}`);
  }
});

// M-004-S2
test('M-004-S2 the Parity run section of docs/maintenance.md names the mirrored knobs', () => {
  const parity = section(doc('maintenance.md'), '## Parity run');
  assert.ok(parity.length > 0, 'Parity run section missing');
  for (const needle of ['audit.exclude_reasons', 'keyword_match', 'company_caps']) {
    assert.ok(parity.includes(needle), `missing ${needle}`);
  }
});

// M-004-S3
test('M-004-S3 the Parity and CI section of docs/architecture.md states the shared reason predicate', () => {
  const parity = section(doc('architecture.md'), '## Parity and CI');
  assert.ok(parity.length > 0, 'Parity and CI section missing');
  assert.ok(parity.includes('reason predicate'), 'missing reason predicate');
});

// M-004-S4
test('M-004-S4 the edited docs hold no em dash and no curly quote', () => {
  const banned = [0x2014, 0x2018, 0x2019, 0x201c, 0x201d].map((cp) => String.fromCodePoint(cp));
  for (const name of ['usage.md', 'maintenance.md', 'architecture.md']) {
    const text = doc(name);
    for (const ch of banned) assert.ok(!text.includes(ch), `${name} has U+${ch.codePointAt(0).toString(16)}`);
  }
});
