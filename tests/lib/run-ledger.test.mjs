// Assumed (M-005): lib/run-ledger.mjs keeps data/student-runs.tsv. recordRun(dataDir, { start, end, kind }) appends one
// row (start and end are ISO instants; a row with an end is a finished run), readRuns(dataDir) reads them back,
// lastSuccess(rows, kind) picks the last finished run of a kind, and missedSlots({ lastSuccess, now, tz }) returns
// { dates, count }: the local dates strictly after the last success and strictly before today in tz (today is the run
// happening now), at most MAX_LISTED of them in dates and the rest as count. missedLine({ dates, count }) is the digest
// line. scripts/scheduled.mjs writes the missed slots to data/<MISSED_FILE> before it starts daily.mjs, exactly once.
// Synthetic scratch roots only; the fake runner never starts a process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { MAX_LISTED, lastSuccess, missedLine, missedSlots, readRuns, recordRun } from '../../lib/run-ledger.mjs';
import { MISSED_FILE, scheduledRun } from '../../scripts/scheduled.mjs';
import { shiftDate } from '../helpers/budget-harness.mjs';
import { makeRoot, PACK_ROOT } from '../helpers/script-harness.mjs';

const TZ = 'America/Chicago';
const localDate = (when) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(when);
// 22 as a count, not the day part of a date such as 2026-10-22.
const COUNT_22 = /(^|[^-\d])22([^-\d]|$)/;
const finished = (date) => ({ start: `${date}T18:00:00.000Z`, end: `${date}T18:05:00.000Z`, kind: 'daily' });

async function slotsAfter(r, lastDate, now) {
  await recordRun(r.data, finished(lastDate));
  const last = lastSuccess(await readRuns(r.data), 'daily');
  return missedSlots({ lastSuccess: last, now, tz: TZ });
}

// Runs scheduledRun against a ledger whose last daily success was daysAgo local days before today; returns the daily.mjs
// starts and the missed-runs file as it was when daily.mjs started.
async function scheduledAfter(r, daysAgo) {
  const today = localDate(new Date());
  await recordRun(r.data, finished(shiftDate(today, -daysAgo)));
  const daily = [];
  const runner = (cmd, args) => {
    if (basename(String(args[0])) === 'daily.mjs') {
      const file = join(r.data, MISSED_FILE);
      daily.push(existsSync(file) ? readFileSync(file, 'utf8') : '');
    }
    return '';
  };
  await scheduledRun({ root: r.root, packRoot: PACK_ROOT, passThrough: [], dataDir: r.data, today, runner, out: () => {} });
  return { today, daily };
}

// M-005-S2-osdr
test('M-005-S2-osdr two missed daily runs lead to one run and the digest lists both dates', async () => {
  const r = makeRoot({ config: 'automation: scheduled-discovery\n' });
  try {
    const slots = await slotsAfter(r, '2026-10-24', new Date('2026-10-27T20:00:00.000Z'));
    assert.deepEqual([...slots.dates].sort(), ['2026-10-25', '2026-10-26']);
    assert.equal(slots.count, 0);
    const line = missedLine(slots);
    assert.match(line, /2026-10-25/);
    assert.match(line, /2026-10-26/);

    const s = makeRoot({ config: 'automation: scheduled-discovery\n' });
    try {
      const { today, daily } = await scheduledAfter(s, 3);
      assert.equal(daily.length, 1, 'daily.mjs runs once');
      for (const d of [shiftDate(today, -2), shiftDate(today, -1)]) assert.ok(daily[0].includes(d), `missed ${d} is listed: ${daily[0]}`);
    } finally {
      s.cleanup();
    }
  } finally {
    r.cleanup();
  }
});

// M-005-S7-osdr
test('M-005-S7-osdr after 30 days asleep the digest lists 7 dates plus a count and one run happens', async () => {
  const r = makeRoot({ config: 'automation: scheduled-discovery\n' });
  try {
    assert.equal(MAX_LISTED, 7);
    const slots = await slotsAfter(r, '2026-09-27', new Date('2026-10-27T20:00:00.000Z'));
    assert.equal(slots.dates.length, 7);
    assert.equal(slots.count, 22, '29 missed dates: 7 listed and 22 counted');
    for (const d of slots.dates) assert.match(d, /^2026-(09-(2[89]|30)|10-([01]\d|2[0-6]))$/, `a missed date: ${d}`);
    const line = missedLine(slots);
    for (const d of slots.dates) assert.ok(line.includes(d), d);
    assert.match(line, COUNT_22, 'the line names the 22 dates not listed');

    const s = makeRoot({ config: 'automation: scheduled-discovery\n' });
    try {
      const { daily } = await scheduledAfter(s, 30);
      assert.equal(daily.length, 1, 'daily.mjs runs once, not once per missed day');
      assert.equal((daily[0].match(/\d{4}-\d{2}-\d{2}/g) ?? []).length, 7, daily[0]);
      assert.match(daily[0], COUNT_22);
    } finally {
      s.cleanup();
    }
  } finally {
    r.cleanup();
  }
});
