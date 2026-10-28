import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPORT_HEADER } from '../../tools/parity-compare.mjs';
import { PACK_ROOT } from './_source.mjs';

const doc = (name) => readFileSync(join(PACK_ROOT, 'docs', name), 'utf8');

// Text from the heading line to the next '## ' heading.
function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}

// M-005-S1
test('M-005-S1 the table header in docs/parity-report.md equals REPORT_HEADER', () => {
  const header = doc('parity-report.md').split('\n').find((l) => l.startsWith('| Stage'));
  assert.ok(REPORT_HEADER.length > 0);
  assert.equal(header, REPORT_HEADER);
});

// M-005-S2
test('M-005-S2 docs/maintenance.md Parity run section names the fixture and the allowance stages', () => {
  const parity = section(doc('maintenance.md'), '## Parity run');
  assert.ok(parity.length > 0, 'Parity run section missing');
  for (const needle of ['tests/fixtures/parity/student.yml', 'merge-staging', 'rank-queue', 'fail-audit']) {
    assert.ok(parity.includes(needle), `missing ${needle}`);
  }
});

// M-005-S3
test('M-005-S3 architecture and maintenance docs hold no em dash and no curly quote', () => {
  const banned = [0x2014, 0x2018, 0x2019, 0x201c, 0x201d].map((cp) => String.fromCodePoint(cp));
  for (const name of ['architecture.md', 'maintenance.md']) {
    const text = doc(name);
    for (const ch of banned) assert.ok(!text.includes(ch), `${name} has U+${ch.codePointAt(0).toString(16)}`);
  }
});

// M-005-S4
test('M-005-S4 the Parity and CI section of docs/architecture.md carries the truthful-semantics phrases', () => {
  const parity = section(doc('architecture.md'), '## Parity and CI');
  assert.ok(parity.length > 0, 'Parity and CI section missing');
  for (const needle of ['local/', 'stage error', 'data/student-cycle.json', 'URL set', 'derived', 'Warnings', 'killed before']) {
    assert.ok(parity.includes(needle), `missing ${needle}`);
  }
});
