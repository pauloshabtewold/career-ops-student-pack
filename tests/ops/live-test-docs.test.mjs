// docs/live-test.md: the live test table (use case, environment, what happened, evidence, PASS/FAIL) holds one row per
// module and upgrade id, each with evidence and a PASS or FAIL verdict.
// Ruling: the ids checked are the module and upgrade ids the pack already names per feature in docs/token-report.md
// (the features built in P1 to P4); the live test may list more, never fewer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const DOC = join(PACK_ROOT, 'docs', 'live-test.md');
const IDS = [
  'M1', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'M10', 'M11', 'M12', 'M13',
  'U1', 'U2', 'U3', 'U4', 'U5', 'U8',
  'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G9',
  'H2', 'H3', 'H4', 'H5',
];
const EMPTY = /^(|-+|—|tbd|todo|n\/a|none|\?)$/i;

const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const plain = (c) => c.replace(/[*_`]/g, '').trim();

// Every markdown table in the doc as { header, rows }, header cells lower-cased.
function tables(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].trim().startsWith('|') || !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) continue;
    const header = cells(lines[i]).map((c) => plain(c).toLowerCase());
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && lines[j].trim().startsWith('|'); j++) rows.push(cells(lines[j]));
    out.push({ header, rows });
    i = j - 1;
  }
  return out;
}

// M-007-S2-osdr
test('M-007-S2-osdr docs/live-test.md has a row with PASS or FAIL and evidence for every module id', () => {
  assert.ok(existsSync(DOC), 'docs/live-test.md exists');
  const live = tables(readFileSync(DOC, 'utf8')).filter((t) => t.header.some((h) => h.includes('evidence')) && t.header.some((h) => /pass|fail|result|verdict/.test(h)));
  assert.ok(live.length >= 1, 'a table with an Evidence column and a PASS/FAIL column');
  const problems = [];
  for (const id of IDS) {
    const word = new RegExp(`(^|[^A-Za-z0-9])${id}(?![0-9])`);
    const found = live.flatMap((t) => t.rows.filter((r) => word.test(r.join(' '))).map((r) => ({ t, r })));
    if (!found.length) {
      problems.push(`${id}: no row`);
      continue;
    }
    const ok = found.some(({ t, r }) => {
      const ev = t.header.findIndex((h) => h.includes('evidence'));
      const verdict = t.header.findIndex((h) => /pass|fail|result|verdict/.test(h));
      return ev >= 0 && verdict >= 0 && !EMPTY.test(plain(r[ev] ?? '')) && /^(PASS|FAIL)$/.test(plain(r[verdict] ?? ''));
    });
    if (!ok) problems.push(`${id}: row lacks evidence or a PASS/FAIL verdict`);
  }
  assert.deepEqual(problems, []);
});
