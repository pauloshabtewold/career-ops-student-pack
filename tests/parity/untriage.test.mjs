// Assumed: parity.mjs takes --untriage N and strips the triage= and reason= notes from the first N Pending rows of
// data/pipeline.md in both copies before any stage runs, and the report header carries a "Prefilter input rows" line
// holding the count of untriaged Pending rows the prefilter stage starts from.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runParity } from '../../tools/parity.mjs';
import { makeSource, makeStudentConfig, okRunner, tmp, cleanupTmp } from './_source.mjs';

after(cleanupTmp);

const TODAY = '2026-10-27';
const row = (n, note) => `- [ ] https://jobs.example.com/openings/u-${n} | Example Co | Software Engineer Intern ${n} | Remote | note: ${note}`;
const triaged = (n) => row(n, 'src=example; triage=4.2; reason=in field');

function build(pending) {
  const source = makeSource();
  writeFileSync(join(source, 'data', 'pipeline.md'), `# Pipeline\n\n## Pending\n\n${pending.join('\n')}\n\n## Flagged\n\n## Skipped\n\n## Processed\n`);
  const scratch = join(tmp('parity-untriage-run-'), 'work');
  const report = join(tmp('parity-untriage-report-'), 'report.md');
  return { source, scratch, report, base: ['--source', source, '--scratch', scratch, '--student-config', makeStudentConfig(), '--report', report, '--today', TODAY] };
}

// Runs the harness, snapshotting both copies' pipeline.md when the first stage is called.
async function drive(b, extra) {
  const seen = {};
  const runner = async (call) => {
    seen[call.side] ??= readFileSync(join(call.cwd, 'data', 'pipeline.md'), 'utf8');
    return okRunner(call);
  };
  const code = await runParity([...b.base, ...extra], { stageRunner: runner, proc: new EventEmitter(), exit: () => {} });
  const text = existsSync(b.report) ? readFileSync(b.report, 'utf8') : '';
  return { code, seen, text };
}

const pendingLines = (text = '') => text.split('\n').filter((l) => l.startsWith('- [ ] '));

// M-004-S6
test('M-004-S6 --untriage 50 strips triage and reason notes from the first 50 Pending rows of both copies', async () => {
  const b = build(Array.from({ length: 60 }, (_, i) => triaged(i + 1)));
  const r = await drive(b, ['--untriage', '50']);
  for (const side of ['baseline', 'pack']) {
    const rows = pendingLines(r.seen[side]);
    assert.equal(rows.length, 60, side);
    rows.slice(0, 50).forEach((l, i) => {
      assert.ok(!l.includes('triage=') && !l.includes('reason='), `${side} row ${i + 1}: ${l}`);
      assert.ok(l.includes('src=example'), `${side} row ${i + 1} keeps its other notes`);
      assert.ok(l.includes(`/u-${i + 1} |`), `${side} row ${i + 1} keeps its URL`);
    });
    rows.slice(50).forEach((l) => assert.ok(l.includes('triage=4.2') && l.includes('reason=in field'), `${side}: ${l}`));
  }
  assert.match(r.text, /Prefilter input rows\D{0,5}50\b/, r.text);
});

// M-004-S7
test('M-004-S7 --untriage -1 or a non-integer exits 2 and creates no scratch dir', async () => {
  const ok = build([triaged(1)]);
  assert.equal((await drive(ok, ['--untriage', '0'])).code, 0, '--untriage 0 is accepted');
  for (const bad of ['-1', '2.5', 'many']) {
    const b = build([triaged(1)]);
    const r = await drive(b, ['--untriage', bad]);
    assert.equal(r.code, 2, `--untriage ${bad}`);
    assert.equal(existsSync(b.scratch), false, `--untriage ${bad} left a scratch dir`);
  }
});

// M-004-S8
test('M-004-S8 without --untriage both copies keep their triage notes and the harness still exits 0', async () => {
  const b = build([triaged(1), triaged(2)]);
  const r = await drive(b, []);
  assert.equal(r.code, 0);
  for (const side of ['baseline', 'pack']) {
    for (const l of pendingLines(r.seen[side])) assert.ok(l.includes('triage=4.2') && l.includes('reason=in field'), `${side}: ${l}`);
  }
});
