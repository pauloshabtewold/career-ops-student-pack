// Assumed: lib/triage-budget.mjs exports the budget helpers named in the milestone interface; the ledger lives in
// <dataDir>/triage-usage.tsv and the digest in <dataDir>/digest/student-<today>.md. Every test uses a scratch data dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendDigestLines, appendTriageUsage, parseBudgetValue, readTriageUsage, resolveTriageBudget, rowsLeft } from '../../lib/triage-budget.mjs';

const TODAY = '2026-10-30';
async function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pack-triage-budget-'));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const HEADER = 'date\tsource\trows\toutcome\n';
const ledger = (dir, ...rows) => writeFileSync(join(dir, 'triage-usage.tsv'), HEADER + rows.map((r) => `${r}\n`).join(''));

// M-001-S1
test('M-001-S1 an empty config resolves a daily budget of 20, a first-run budget of 60 and no calibration', () => {
  assert.deepEqual(resolveTriageBudget({}), { daily: 20, firstRun: 60, calibration: null });
  assert.deepEqual(resolveTriageBudget(), { daily: 20, firstRun: 60, calibration: null });
  assert.deepEqual(resolveTriageBudget({ triage_budget: {} }), { daily: 20, firstRun: 60, calibration: null });
});

// M-001-S1
test('M-001-S1 triage_budget.daily 150 or "all" resolves unclamped and first_run is read', () => {
  assert.equal(resolveTriageBudget({ triage_budget: { daily: 150 } }).daily, 150);
  assert.equal(resolveTriageBudget({ triage_budget: { daily: 'all' } }).daily, 'all');
  assert.equal(resolveTriageBudget({ triage_budget: { first_run: 200 } }).firstRun, 200);
  assert.equal(resolveTriageBudget({ triage_budget: { first_run: 'all' } }).firstRun, 'all');
});

// M-001-S5
test('M-001-S5 a calibration of percent per 100 rows and window resolves to { pctPer100Rows, window }', () => {
  const b = resolveTriageBudget({ triage_budget: { measured_pct_per_100_rows: 4, measured_window: '5-hour' } });
  assert.deepEqual(b.calibration, { pctPer100Rows: 4, window: '5-hour' });
});

// M-001-S3
test('M-001-S3 limits.triage_daily 50 with no triage_budget.daily resolves daily 50 without a clamp', () => {
  assert.equal(resolveTriageBudget({ limits: { triage_daily: 50 } }).daily, 50);
});

// M-001-S3
test('M-001-S3 triage_budget.daily 5 wins over limits.triage_daily 50', () => {
  assert.equal(resolveTriageBudget({ triage_budget: { daily: 5 }, limits: { triage_daily: 50 } }).daily, 5);
});

// M-001-S3
test('M-001-S3 triage_budget.daily 0 resolves to 0 even with a legacy limit', () => {
  assert.equal(resolveTriageBudget({ triage_budget: { daily: 0 } }).daily, 0);
  assert.equal(resolveTriageBudget({ triage_budget: { daily: 0 }, limits: { triage_daily: 50 } }).daily, 0);
});

// M-001-S8
test('M-001-S8 parseBudgetValue accepts whole numbers, digit strings and "all"', () => {
  assert.equal(parseBudgetValue(0), 0);
  assert.equal(parseBudgetValue(7), 7);
  assert.equal(parseBudgetValue('7'), 7);
  assert.equal(parseBudgetValue('0'), 0);
  assert.equal(parseBudgetValue('all'), 'all');
});

// M-001-S8
test('M-001-S8 parseBudgetValue rejects "abc" and -3 with an error naming the value', () => {
  assert.throws(() => parseBudgetValue('abc'), /abc/);
  assert.throws(() => parseBudgetValue(-3), /-3/);
  assert.throws(() => parseBudgetValue(2.5), /2\.5/);
  assert.throws(() => parseBudgetValue('1.5'), /1\.5/);
});

// M-001-S1
test('M-001-S1 rowsLeft is Infinity for "all" and otherwise the budget minus used, never below 0', () => {
  assert.equal(rowsLeft('all', 500), Infinity);
  assert.equal(rowsLeft(20, 5), 15);
  assert.equal(rowsLeft(20, 20), 0);
  assert.equal(rowsLeft(20, 25), 0);
  assert.equal(rowsLeft(0, 0), 0);
});

// M-001-S4
test('M-001-S4 scheduled and session rows count for today only and first-run rows for every date', () =>
  withDir((dir) => {
    ledger(
      dir,
      '2026-10-30\tscheduled\t5\tok',
      '2026-10-30\tscheduled\t3\tfailed',
      '2026-10-30\tsession\t4\tok',
      '2026-10-29\tscheduled\t7\tok',
      '2026-10-29\tsession\t2\tok',
      '2026-10-29\tfirst-run\t60\tok',
      '2026-10-30\tfirst-run\t10\tok',
    );
    assert.deepEqual(readTriageUsage(dir, TODAY), { scheduled: 8, session: 4, firstRun: 70, today: 12, stoppedToday: true, skipped: 0 });
  }));

// M-001-S4
test('M-001-S4 a failed scheduled row from another date, or a failed session row, does not set stoppedToday', () =>
  withDir((dir) => {
    ledger(dir, '2026-10-29\tscheduled\t5\tfailed', '2026-10-30\tsession\t5\tfailed', '2026-10-30\tfirst-run\t5\tfailed', '2026-10-30\tscheduled\t5\tok');
    const u = readTriageUsage(dir, TODAY);
    assert.equal(u.stoppedToday, false);
    assert.equal(u.scheduled, 5);
    assert.equal(u.session, 5);
    assert.equal(u.firstRun, 5);
    assert.equal(u.today, 10);
  }));

// M-001-S4
test('M-001-S4 a missing ledger counts 0', () =>
  withDir((dir) => {
    assert.deepEqual(readTriageUsage(join(dir, 'nope'), TODAY), { scheduled: 0, session: 0, firstRun: 0, today: 0, stoppedToday: false, skipped: 0 });
  }));

// M-001-S4
test('M-001-S4 appendTriageUsage writes the header once and defaults the outcome to ok', () =>
  withDir(async (dir) => {
    const data = join(dir, 'data');
    await appendTriageUsage(data, { date: TODAY, source: 'scheduled', rows: 5 });
    await appendTriageUsage(data, { date: TODAY, source: 'session', rows: 3, outcome: 'failed' });
    const text = readFileSync(join(data, 'triage-usage.tsv'), 'utf8');
    assert.equal(text, `${HEADER}2026-10-30\tscheduled\t5\tok\n2026-10-30\tsession\t3\tfailed\n`);
    assert.deepEqual(readTriageUsage(data, TODAY), { scheduled: 5, session: 3, firstRun: 0, today: 8, stoppedToday: false, skipped: 0 });
  }));

// W-023-A1-5
test('W-023-A1-5 a ledger without its header keeps its first data row instead of reading it as the header', () =>
  withDir((dir) => {
    writeFileSync(join(dir, 'triage-usage.tsv'), '2026-10-30\tscheduled\t20\tfailed\n');
    const u = readTriageUsage(dir, TODAY);
    assert.equal(u.scheduled, 20);
    assert.equal(u.today, 20);
    assert.equal(u.stoppedToday, true);
    assert.equal(u.skipped, 0);
  }));

// W-023-A1-5
test('W-023-A1-5 appending to an empty ledger file writes the header first, so the row counts', () =>
  withDir(async (dir) => {
    writeFileSync(join(dir, 'triage-usage.tsv'), '');
    await appendTriageUsage(dir, { date: TODAY, source: 'scheduled', rows: 20 });
    assert.equal(readFileSync(join(dir, 'triage-usage.tsv'), 'utf8'), `${HEADER}2026-10-30\tscheduled\t20\tok\n`);
    assert.equal(readTriageUsage(dir, TODAY).today, 20);
  }));

// M-001-S13
test('M-001-S13 malformed ledger rows are skipped from every count and reported; a valid row of 0 rows counts 0', () =>
  withDir((dir) => {
    ledger(
      dir,
      '2026-10-30\tscheduled\t5\tok',
      '2026-10-30\tsession\t0\tok',
      '2026-1-30\tscheduled\t5\tok',
      '30/10/2026\tsession\t5\tok',
      '2026-10-30\tscheduled\tabc\tfailed',
      '2026-10-30\tsession\t-1\tok',
      '2026-10-30\tsession\t2.5\tok',
      '2026-10-30\tcron\t5\tok',
      '2026-10-30\tscheduled\t5\tmaybe',
      '2026-10-30\tscheduled\t5',
    );
    assert.deepEqual(readTriageUsage(dir, TODAY), { scheduled: 5, session: 0, firstRun: 0, today: 5, stoppedToday: false, skipped: 8 });
  }));

// M-001-S14
test('M-001-S14 three chunk lines under "Daily triage" share one heading and "Session triage" gets its own', () =>
  withDir((dir) => {
    appendDigestLines({ dataDir: dir, today: TODAY, heading: 'Daily triage', lines: ['chunk 1: triaged 20'] });
    appendDigestLines({ dataDir: dir, today: TODAY, heading: 'Daily triage', lines: ['chunk 2: triaged 20'] });
    appendDigestLines({ dataDir: dir, today: TODAY, heading: 'Daily triage', lines: ['chunk 3: triaged 5'] });
    appendDigestLines({ dataDir: dir, today: TODAY, heading: 'Session triage', lines: ['session: triaged 4'] });
    const text = readFileSync(join(dir, 'digest', `student-${TODAY}.md`), 'utf8');
    assert.equal(text.startsWith('# Student daily run 2026-10-30\n'), true);
    assert.deepEqual(text.split('\n').filter((l) => l.startsWith('## ')), ['## Daily triage', '## Session triage']);
    assert.deepEqual(text.split('\n').filter((l) => l.startsWith('- ')), ['- chunk 1: triaged 20', '- chunk 2: triaged 20', '- chunk 3: triaged 5', '- session: triaged 4']);
    assert.ok(text.indexOf('- chunk 3: triaged 5') < text.indexOf('## Session triage'));
  }));

// M-001-S14
test('M-001-S14 a heading that differs from the last one is written again, and several lines go in one call', () =>
  withDir((dir) => {
    appendDigestLines({ dataDir: dir, today: TODAY, heading: 'Daily triage', lines: ['a', 'b'] });
    appendDigestLines({ dataDir: dir, today: TODAY, heading: 'Session triage', lines: ['c'] });
    appendDigestLines({ dataDir: dir, today: TODAY, heading: 'Daily triage', lines: ['d'] });
    const text = readFileSync(join(dir, 'digest', `student-${TODAY}.md`), 'utf8');
    assert.deepEqual(text.split('\n').filter((l) => l.startsWith('## ')), ['## Daily triage', '## Session triage', '## Daily triage']);
    assert.deepEqual(text.split('\n').filter((l) => l.startsWith('- ')), ['- a', '- b', '- c', '- d']);
  }));

// M-001-S14
test('M-001-S14 an existing digest keeps its own title and its last heading decides', () =>
  withDir((dir) => {
    mkdirSync(join(dir, 'digest'));
    writeFileSync(join(dir, 'digest', `student-${TODAY}.md`), '# Student daily run 2026-10-30\n\n## Discovery\n- found 3\n');
    appendDigestLines({ dataDir: dir, today: TODAY, heading: 'Daily triage', lines: ['x'] });
    const text = readFileSync(join(dir, 'digest', `student-${TODAY}.md`), 'utf8');
    assert.equal(text.split('\n').filter((l) => l.startsWith('# ')).length, 1);
    assert.deepEqual(text.split('\n').filter((l) => l.startsWith('## ')), ['## Discovery', '## Daily triage']);
  }));
