// first-run.mjs --queue: the same ingest steps, then the raw queue instead of the triage list. firstRun({ ..., queue: true })
// takes the place of the flag in-process; the --queue/--list-only clash is a CLI usage error and runs as a child process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { firstRun } from '../../scripts/first-run.mjs';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT, TODAY, jobUrl, line, pipelineText } from '../helpers/script-harness.mjs';

function setup(pending, presets = '[]') {
  const up = createFakeUpstream();
  writeFileSync(join(up.root, 'config', 'student.yml'), `timezone: America/Chicago\npresets: ${presets}\n`);
  writeFileSync(join(up.root, 'data', 'pipeline.md'), pipelineText({ pending }));
  return { up, data: join(up.root, 'data'), cleanup: () => rmSync(up.root, { recursive: true, force: true }) };
}

// Row i (1 to 12): company Co i, title Data Intern i, location Remote, imported 2026-10-(10 + i); src alternates.
const rows = Array.from({ length: 12 }, (_, i) => {
  const n = i + 1;
  const src = n % 3 === 0 ? 'github-lists' : 'handshake';
  const triage = n % 2 === 0 ? '; triage=PASS; score=4.6' : '';
  return line(jobUrl(n), `Co ${n}`, `Data Intern ${n}`, 'Remote', `src=${src}; imported=2026-10-${10 + n}${triage}`);
});

// M-001-S13-cdel
test('M-001-S13-cdel --queue prints the Pending total, counts by source, the 10 newest rows without a score and the upcoming section', async () => {
  const s = setup(rows, '[consulting]');
  try {
    const ran = [];
    const out = [];
    const code = await firstRun({ root: s.up.root, dataDir: s.data, packRoot: PACK_ROOT, today: TODAY, queue: true, runner: (...a) => { ran.push(a); return '{}'; }, out: (l) => out.push(String(l)) });
    assert.equal(code, 0, out.join('\n'));
    assert.ok(ran.length > 0, 'the ingest steps still run');
    assert.ok(out.includes('queue: 12 postings waiting'), out.join('\n'));
    assert.ok(out.includes('source handshake: 8'), out.join('\n'));
    assert.ok(out.includes('source github-lists: 4'), out.join('\n'));
    const at = out.indexOf('newest:');
    assert.ok(at >= 0, out.join('\n'));
    const newest = out.slice(at + 1, at + 11);
    assert.deepEqual(newest, Array.from({ length: 10 }, (_, i) => `Co ${12 - i} | Data Intern ${12 - i} | Remote`));
    assert.ok(!out.includes('Co 2 | Data Intern 2 | Remote') && !out.includes('Co 1 | Data Intern 1 | Remote'), 'only the 10 newest rows are listed');
    assert.ok(!out.some((l) => /4\.6|PASS/.test(l)), 'no score or verdict');
    assert.ok(!out.some((l) => /triage budget|Untriaged/i.test(l)), 'no triage-budget line and no untriaged list');
  } finally {
    s.cleanup();
  }
});

test('extra check: the Upcoming and check by hand section names the watch-only seeds of the merged presets and not the readable ones', async () => {
  const s = setup(rows.slice(0, 3), '[consulting]');
  try {
    const out = [];
    await firstRun({ root: s.up.root, dataDir: s.data, packRoot: PACK_ROOT, today: TODAY, queue: true, runner: () => '{}', out: (l) => out.push(String(l)) });
    const at = out.indexOf('Upcoming and check by hand:');
    assert.ok(at >= 0, out.join('\n'));
    const section = out.slice(at + 1);
    assert.ok(section.some((l) => l.includes('McKinsey & Company') && l.includes('https://www.mckinsey.com/careers') && l.includes('(upcoming)')), section.join('\n'));
    assert.ok(!section.some((l) => l.includes('Oliver Wyman')), 'a readable seed is not watch-only');
  } finally {
    s.cleanup();
  }
});

// M-001-S14-cdel
test('M-001-S14-cdel --queue together with --list-only exits 2 with a usage line naming both flags', () => {
  const s = setup([]);
  try {
    const r = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'first-run.mjs'), '--root', s.up.root, '--data-dir', s.data, '--today', TODAY, '--queue', '--list-only'], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /use --queue or --list-only, not both/);
    assert.deepEqual(s.up.calls(), [], 'no upstream script ran');
  } finally {
    s.cleanup();
  }
});

test('rows the board scan wrote carry no src note and are counted as "board", never "none"', async () => {
  const s = setup([line(jobUrl(1), 'Co 1', 'EE Intern 1', 'Remote', 'imported=2026-10-11'), line(jobUrl(2), 'Co 2', 'EE Intern 2', 'Remote', 'src=github:list-a; imported=2026-10-12')]);
  try {
    const out = [];
    await firstRun({ root: s.up.root, dataDir: s.data, packRoot: PACK_ROOT, today: TODAY, queue: true, step: 'view', runner: () => '{}', out: (l) => out.push(String(l)) });
    assert.ok(out.includes('source board: 1'), out.join('\n'));
    assert.ok(out.includes('source github:list-a: 1'), out.join('\n'));
    assert.ok(!out.some((l) => /none/.test(l)), out.join('\n'));
  } finally {
    s.cleanup();
  }
});
