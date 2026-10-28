// Assumed CLI: node scripts/apply-triage.mjs <results-file> [--dry-run] --root R --data-dir D --today T.
// Counts are printed to stdout as one JSON value. Triage tokens are triage=<score> and reason=<text> in the row note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { makeRoot, runScript, line, pipelineText, urlsOf, rowsOf, jobUrl } from '../helpers/script-harness.mjs';

const RESULTS = [
  `TRIAGE: PASS | ${jobUrl(1)} | 4.5/5 | strong fit`,
  `TRIAGE: MARGINAL | ${jobUrl(2)} | 3.6 | okay fit`,
  `TRIAGE: FAIL | ${jobUrl(3)} | 1.0/5 | level too senior | extra column`,
  `TRIAGE: SKIP | ${jobUrl(4)} | 2.0 | not for now`,
  `TRIAGE: EXPIRED | ${jobUrl(5)} | 0.0 | posting closed`,
  `TRIAGE: BROWSER | ${jobUrl(6)} | 3.0 | needs browser check`,
  '',
].join('\n');

const pipeline = () =>
  pipelineText({
    pending: [1, 2, 3, 4, 5, 6, 7].map((n) => line(jobUrl(n), 'Example Robotics', `Role ${n}`)),
    flagged: [line(jobUrl(20), 'Example Robotics', 'Old flagged')],
    skipped: [line(jobUrl(21), 'Example Robotics', 'Old skipped')],
  });

function setup() {
  const r = makeRoot();
  r.write('data/pipeline.md', pipeline());
  r.write('data/results.txt', RESULTS);
  return r;
}

// M-004-S5
test('M-004-S5 verdicts move rows to Flagged or Skipped with triage tokens and print JSON counts', () => {
  const r = setup();
  try {
    const out = runScript('apply-triage', [r.file('data/results.txt')], r);
    assert.equal(out.code, 0, out.stderr);
    assert.doesNotThrow(() => JSON.parse(out.stdout));
    const text = r.read('data/pipeline.md');
    assert.deepEqual(urlsOf(text, 'Pending').sort(), [jobUrl(1), jobUrl(2), jobUrl(7)].sort());
    assert.deepEqual(urlsOf(text, 'Skipped').sort(), [jobUrl(21), jobUrl(3), jobUrl(4), jobUrl(5)].sort());
    assert.deepEqual(urlsOf(text, 'Flagged').sort(), [jobUrl(20), jobUrl(6)].sort());
    const pass = rowsOf(text, 'Pending').find((x) => x.url === jobUrl(1));
    assert.equal(parseFloat(pass.notes.get('triage')), 4.5);
    assert.equal(pass.notes.get('reason'), 'strong fit');
    const fail = rowsOf(text, 'Skipped').find((x) => x.url === jobUrl(3));
    assert.equal(parseFloat(fail.notes.get('triage')), 1);
    assert.equal(fail.notes.get('reason'), 'level too senior');
    const browser = rowsOf(text, 'Flagged').find((x) => x.url === jobUrl(6));
    assert.equal(parseFloat(browser.notes.get('triage')), 3);
    assert.ok(!rowsOf(text, 'Pending').find((x) => x.url === jobUrl(7)).notes.has('triage'));
  } finally {
    r.cleanup();
  }
});

// M-004-S5
test('M-004-S5 the lock is released and no temp file is left after the write', () => {
  const r = setup();
  try {
    assert.equal(runScript('apply-triage', [r.file('data/results.txt')], r).code, 0);
    assert.deepEqual(r.list('data'), ['pipeline.md', 'results.txt']);
  } finally {
    r.cleanup();
  }
});

// M-004-S6
test('M-004-S6 a live holder past the timeout gives exit 1 and leaves pipeline.md unchanged', { timeout: 90000 }, () => {
  const r = setup();
  const control = setup();
  try {
    assert.equal(runScript('apply-triage', [control.file('data/results.txt')], control).code, 0, 'the same run succeeds without a holder');
    assert.notEqual(control.read('data/pipeline.md'), r.read('data/pipeline.md'));
    const before = r.read('data/pipeline.md');
    const lockDir = r.file('data/pipeline.md.lock');
    mkdirSync(lockDir);
    writeFileSync(`${lockDir}/owner.json`, `${JSON.stringify({ pid: process.pid, token: 'held', started_at: new Date().toISOString(), pipeline: r.file('data/pipeline.md') })}\n`);
    const out = runScript('apply-triage', [r.file('data/results.txt')], r, { timeout: 80000 });
    assert.equal(out.code, 1);
    assert.equal(r.read('data/pipeline.md'), before);
    assert.ok(r.exists('data/pipeline.md.lock'), 'the live holder keeps its lock');
  } finally {
    control.cleanup();
    r.cleanup();
  }
});

// M-004-S7
test('M-004-S7 --dry-run prints the same counts and leaves pipeline.md byte-identical', () => {
  const r = setup();
  try {
    const before = r.read('data/pipeline.md');
    const dry = runScript('apply-triage', [r.file('data/results.txt'), '--dry-run'], r);
    assert.equal(dry.code, 0, dry.stderr);
    assert.equal(r.read('data/pipeline.md'), before);
    assert.ok(!readdirSync(r.data).some((f) => f.endsWith('.tmp')));
    const real = runScript('apply-triage', [r.file('data/results.txt')], r);
    assert.deepEqual(JSON.parse(dry.stdout), JSON.parse(real.stdout));
  } finally {
    r.cleanup();
  }
});
