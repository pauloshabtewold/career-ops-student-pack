// Assumed: scripts/triage-budget.mjs is a CLI `triage-budget.mjs <status|cost|set|log|calibrate> [value] [--confirm]
// [--first-run] [--plan P] [--agent A] [--rows N] [--window W] [--today D] --root R --data-dir D`. Exit 0 ok, 1 config
// missing, 2 usage error. Every test runs it in a scratch root; runScript adds --root, --data-dir and --today.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { makeRoot, runScript } from '../helpers/script-harness.mjs';
import { readLedger, untriaged, writeLedger } from '../helpers/triage-harness.mjs';
import { pipelineText } from '../helpers/script-harness.mjs';

const CONFIG = 'automation: scheduled-discovery-plus-triage\nagent: claude\nspend_tier: premium\n';
const withRoot = async (config, fn) => {
  const r = makeRoot({ config });
  try {
    await fn(r);
  } finally {
    r.cleanup();
  }
};
const cli = (r, argv, opts) => runScript('triage-budget', argv, r, opts);
const bytes = (r) => readFileSync(r.file('config/student.yml'));
const parsed = (r) => yaml.load(bytes(r).toString('utf8'));
const out = (res) => res.stdout + res.stderr;
const rowOf = (source, rows, date = '2026-10-27') => ({ date, source, rows: String(rows), outcome: 'ok' });

// M-002-S3
test('M-002-S3 set 150 without --confirm leaves config/student.yml byte-identical and prints the estimate and the exact --confirm command', () =>
  withRoot(CONFIG, (r) => {
    const before = bytes(r);
    const res = cli(r, ['set', '150']);
    assert.equal(res.code, 0, out(res));
    assert.deepEqual(bytes(r), before);
    assert.match(res.stdout, /estimate/);
    assert.match(res.stdout, /nothing written/);
    assert.match(res.stdout, /triage-budget\.mjs set 150 --confirm/);
  }));

// M-002-S3
test('M-002-S3 set 150 --confirm writes triage_budget.daily 150 and every other parsed key stays equal', () =>
  withRoot(CONFIG, (r) => {
    const before = parsed(r);
    const res = cli(r, ['set', '150', '--confirm']);
    assert.equal(res.code, 0, out(res));
    const after = parsed(r);
    assert.equal(after.triage_budget.daily, 150);
    assert.equal(after.triage_budget.first_run, undefined);
    const { triage_budget: _t, ...rest } = after;
    const { triage_budget: _b, ...restBefore } = before;
    assert.deepEqual(rest, restBefore);
    assert.match(res.stdout, /150/);
  }));

// M-002-S3
test('M-002-S3 set all --first-run --confirm writes triage_budget.first_run all and leaves daily alone', () =>
  withRoot(`${CONFIG}triage_budget:\n  daily: 30\n`, (r) => {
    const res = cli(r, ['set', 'all', '--first-run', '--confirm']);
    assert.equal(res.code, 0, out(res));
    const after = parsed(r);
    assert.equal(after.triage_budget.first_run, 'all');
    assert.equal(after.triage_budget.daily, 30);
  }));

// M-002-S3
test('M-002-S3 set 150 --first-run without --confirm writes nothing', () =>
  withRoot(CONFIG, (r) => {
    const before = bytes(r);
    const res = cli(r, ['set', '150', '--first-run']);
    assert.equal(res.code, 0, out(res));
    assert.deepEqual(bytes(r), before);
    assert.match(res.stdout, /set 150 --first-run --confirm|set 150 --confirm --first-run/);
  }));

// M-002-S4
test('M-002-S4 status prints the daily and first-run budgets, rows scored today by source, rows left and the cost line', () =>
  withRoot(CONFIG, (r) => {
    writeLedger(r, [rowOf('scheduled', 5), rowOf('session', 3), rowOf('first-run', 10, '2026-10-20')]);
    const res = cli(r, ['status']);
    assert.equal(res.code, 0, out(res));
    assert.match(res.stdout, /daily\D{0,20}\b20\b/i);
    assert.match(res.stdout, /first-run\D{0,40}\b60\b/i);
    assert.match(res.stdout, /scheduled\D{0,12}\b5\b/);
    assert.match(res.stdout, /session\D{0,12}\b3\b/);
    assert.match(res.stdout, /left\D{0,12}\b12\b|\b12\b\D{0,12}left/i);
    assert.match(res.stdout, /estimate/);
  }));

// M-002-S4
test('M-002-S4 log 7 appends a session ledger row and a session triage digest line', () =>
  withRoot(CONFIG, (r) => {
    const res = cli(r, ['log', '7']);
    assert.equal(res.code, 0, out(res));
    assert.deepEqual(readLedger(r), [{ date: '2026-10-27', source: 'session', rows: '7', outcome: 'ok' }]);
    assert.match(r.read('data/digest/student-2026-10-27.md'), /^- session triage: triaged 7$/m);
    assert.match(res.stdout, /left/i);
  }));

// M-002-S4
test('M-002-S4 log 7 --first-run appends a first-run ledger row and a first-run triage digest line', () =>
  withRoot(CONFIG, (r) => {
    const res = cli(r, ['log', '7', '--first-run']);
    assert.equal(res.code, 0, out(res));
    assert.deepEqual(readLedger(r), [{ date: '2026-10-27', source: 'first-run', rows: '7', outcome: 'ok' }]);
    assert.match(r.read('data/digest/student-2026-10-27.md'), /^- first-run triage: triaged 7$/m);
  }));

// M-002-S4
test('M-002-S4 cost all with 230 untriaged Pending rows prints the estimate for 230 rows in 12 calls', () =>
  withRoot(CONFIG, (r) => {
    r.write('data/pipeline.md', pipelineText({ pending: untriaged(230) }));
    const res = cli(r, ['cost', 'all']);
    assert.equal(res.code, 0, out(res));
    assert.match(res.stdout, /estimate/);
    assert.match(res.stdout, /\b230 rows\b/);
    assert.match(res.stdout, /\b12 calls\b/);
  }));

// M-002-S4
test('M-002-S4 cost 100 prints the estimate for 100 rows in 5 calls', () =>
  withRoot(CONFIG, (r) => {
    const res = cli(r, ['cost', '100']);
    assert.equal(res.code, 0, out(res));
    assert.match(res.stdout, /\b100 rows\b/);
    assert.match(res.stdout, /\b5 calls\b/);
  }));

// M-002-S4
test('M-002-S4 calibrate 6 --rows 150 --window weekly writes measured_pct_per_100_rows 4 and measured_window weekly', () =>
  withRoot(CONFIG, (r) => {
    const res = cli(r, ['calibrate', '6', '--rows', '150', '--window', 'weekly']);
    assert.equal(res.code, 0, out(res));
    const after = parsed(r);
    assert.equal(after.triage_budget.measured_pct_per_100_rows, 4);
    assert.equal(after.triage_budget.measured_window, 'weekly');
  }));

// M-002-S9
test('M-002-S9 set lots, set -1, log -3 and calibrate with rows 0, percent 0 or a negative percent exit 2 naming the value and write nothing', () =>
  withRoot(CONFIG, (r) => {
    const before = bytes(r);
    const cases = [
      [['set', 'lots', '--confirm'], 'lots'],
      [['set', '-1', '--confirm'], '-1'],
      [['log', '-3'], '-3'],
      [['calibrate', '150', '--rows', '0'], '0'],
      [['calibrate', '0', '--rows', '50'], '0'],
      [['calibrate', '-2', '--rows', '50'], '-2'],
    ];
    for (const [argv, value] of cases) {
      const res = cli(r, argv);
      assert.equal(res.code, 2, `${argv.join(' ')}: ${out(res)}`);
      assert.ok(out(res).includes(value), `${argv.join(' ')} names ${value}: ${out(res)}`);
    }
    assert.deepEqual(bytes(r), before);
    assert.equal(r.exists('data/triage-usage.tsv'), false);
    assert.equal(r.exists('data/digest'), false);
  }));

// M-002-S9
test('M-002-S9 status, set and log with config/student.yml missing exit 1 and tell the student to run the interview', () =>
  withRoot(CONFIG, (r) => {
    rmSync(r.file('config/student.yml'));
    for (const argv of [['status'], ['set', '20', '--confirm'], ['log', '3']]) {
      const res = cli(r, argv);
      assert.equal(res.code, 1, `${argv.join(' ')}: ${out(res)}`);
      assert.match(out(res), /interview/i);
    }
    assert.equal(r.exists('config/student.yml'), false);
    assert.equal(r.exists('data/triage-usage.tsv'), false);
  }));

// M-002-S9
test('M-002-S9 cost --plan chatgpt-plus --agent codex 20 works with no config', () =>
  withRoot(CONFIG, (r) => {
    rmSync(r.file('config/student.yml'));
    const res = cli(r, ['cost', '--plan', 'chatgpt-plus', '--agent', 'codex', '20']);
    assert.equal(res.code, 0, out(res));
    assert.match(res.stdout, /estimate/);
    assert.match(res.stdout, /\b20 rows\b/);
  }));

// M-002-S14
test('M-002-S14 log 7 --today 2026-11-02 dates the ledger row and the digest file by that day, and status counts it only for that day', () =>
  withRoot(CONFIG, (r) => {
    const res = cli(r, ['log', '7'], { today: '2026-11-02' });
    assert.equal(res.code, 0, out(res));
    assert.deepEqual(readLedger(r), [{ date: '2026-11-02', source: 'session', rows: '7', outcome: 'ok' }]);
    assert.match(r.read('data/digest/student-2026-11-02.md'), /^- session triage: triaged 7$/m);
    assert.equal(r.exists('data/digest/student-2026-10-27.md'), false);
    const same = cli(r, ['status'], { today: '2026-11-02' });
    assert.equal(same.code, 0, out(same));
    assert.match(same.stdout, /session\D{0,12}\b7\b/);
    const next = cli(r, ['status'], { today: '2026-11-03' });
    assert.equal(next.code, 0, out(next));
    assert.doesNotMatch(next.stdout, /session\D{0,12}\b7\b/);
  }));
