import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePipeline, serializePipeline, ensureSections, parseRow, formatRow } from '../../lib/pipeline-md.mjs';

const FULL = [
  '# Pipeline',
  '',
  '## Pending',
  '',
  '- [ ] https://example.com/jobs/1 | Example Robotics | Software Intern | Remote | note: src=list; score=4.1',
  '- [ ] https://example.com/jobs/2 | Example Robotics | Data Intern | Austin, TX',
  '',
  '## Flagged',
  '',
  'https://example.com/jobs/3 | Example Robotics | Odd Role | reason: needs review',
  '',
  '## Skipped',
  '',
  'https://example.com/jobs/4 | Example Robotics | Senior Role | too senior',
  '',
  '## Processed',
  '',
  '- [x] https://example.com/jobs/5 | Example Robotics | Done Role | Remote | #1 | 4.2/5',
  '',
].join('\n');

// M-001-S1
test('M-001-S1 parse then serialize is byte-identical', () => {
  const variants = [FULL, FULL.replace(/\n$/, ''), FULL.replace(/\n/g, '\r\n'), FULL + '\n\n', '', 'no headings at all\n'];
  for (const text of variants) {
    assert.equal(serializePipeline(parsePipeline(text)), text);
  }
});

// M-001-S2
test('M-001-S2 ensureSections inserts Flagged and Skipped after Pending, other lines unchanged', () => {
  const input = [
    '# Pipeline',
    '',
    '## Pending',
    '',
    '- [ ] https://example.com/jobs/1 | Example Robotics | Software Intern',
    '',
    '## Processed',
    '',
    '- [x] https://example.com/jobs/5 | Example Robotics | Done Role',
    '',
  ].join('\n');
  const names = ['Pending', 'Flagged', 'Skipped', 'Processed'];
  const parsed = parsePipeline(input);
  const ensured = ensureSections(parsed, names);
  const out = serializePipeline(ensured ?? parsed);
  const lines = out.split('\n');
  const idx = (h) => lines.indexOf(h);
  assert.ok(idx('## Pending') >= 0 && idx('## Flagged') > idx('## Pending'));
  assert.ok(idx('## Skipped') > idx('## Flagged'));
  assert.ok(idx('## Processed') > idx('## Skipped'));
  const strip = (arr) => arr.filter((l) => l !== '## Flagged' && l !== '## Skipped' && l.trim() !== '');
  assert.deepEqual(strip(lines), strip(input.split('\n')));
  // original non-blank lines keep their relative order
  const orig = input.split('\n').filter((l) => l.trim() !== '');
  let at = -1;
  for (const l of orig) {
    const next = lines.indexOf(l, at + 1);
    assert.ok(next > at, `line out of order or missing: ${l}`);
    at = next;
  }
});

test('M-001-S2 ensureSections is a no-op when all sections exist', () => {
  const names = ['Pending', 'Flagged', 'Skipped', 'Processed'];
  const parsed = parsePipeline(FULL);
  const ensured = ensureSections(parsed, names);
  assert.equal(serializePipeline(ensured ?? parsed), FULL);
});

test('row format round trip', () => {
  const rows = [
    '- [ ] https://example.com/jobs/1 | Example Robotics | Software Intern | Remote | note: src=list; score=4.1',
    '- [x] https://example.com/jobs/5 | Example Robotics | Done Role | Remote | #1 | 4.2/5',
    'https://example.com/jobs/3 | Example Robotics | Odd Role | reason: needs review',
  ];
  for (const r of rows) assert.equal(formatRow(parseRow(r)), r);
});
