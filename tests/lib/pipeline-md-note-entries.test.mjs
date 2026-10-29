// Covers M-002-S1 and M-002-S2: ordered note entries, duplicate keys, and Map plus round-trip semantics.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noteEntries, rowNoteEntries, parseNotes, parseRow, formatRow } from '../../lib/pipeline-md.mjs';

const DUP = '- [ ] https://example.com/jobs/1 | Acme | Software Intern | Remote | note: reason=a; triage=2; reason=b; audited';
const PLAIN = '- [ ] https://example.com/jobs/2 | Globex | Data Intern | Remote | note: src=list; score=4.1';
const NO_NOTE = '- [ ] https://example.com/jobs/3 | Acme | Data Intern | Austin, TX';

// M-002-S1
test('M-002-S1 noteEntries returns every pair in order with null for a bare key', () => {
  assert.deepEqual(noteEntries('reason=a; triage=2; reason=b; audited'), [
    ['reason', 'a'],
    ['triage', '2'],
    ['reason', 'b'],
    ['audited', null],
  ]);
});

// M-002-S1
test('M-002-S1 noteEntries skips empty tokens and trims', () => {
  assert.deepEqual(noteEntries(' a=1 ;; b ; '), [['a', '1'], ['b', null]]);
});

// M-002-S1
test('M-002-S1 rowNoteEntries returns the row note pairs and [] for non-row lines or rows without a note', () => {
  assert.deepEqual(rowNoteEntries(DUP), [['reason', 'a'], ['triage', '2'], ['reason', 'b'], ['audited', null]]);
  assert.deepEqual(rowNoteEntries(PLAIN), [['src', 'list'], ['score', '4.1']]);
  assert.deepEqual(rowNoteEntries('## Skipped'), []);
  assert.deepEqual(rowNoteEntries(''), []);
  assert.deepEqual(rowNoteEntries(NO_NOTE), []);
});

// M-002-S2
test('M-002-S2 parseNotes keeps the last duplicate in its Map', () => {
  const m = parseNotes('reason=a; triage=2; reason=b; audited');
  assert.equal(m.get('reason'), 'b');
  assert.equal(m.get('triage'), '2');
  assert.ok(m.has('audited'));
  assert.equal(m.size, 3);
});

// M-002-S2
test('M-002-S2 formatRow(parseRow(line)) round-trips the fixture rows', () => {
  for (const l of [PLAIN, NO_NOTE]) assert.equal(formatRow(parseRow(l)), l);
  assert.equal(parseRow(DUP).notes.get('reason'), 'b');
  assert.equal(formatRow(parseRow(DUP)), DUP.replace('reason=a; triage=2; reason=b', 'triage=2; reason=b'));
});
