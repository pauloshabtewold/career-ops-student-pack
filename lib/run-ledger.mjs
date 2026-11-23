// data/student-runs.tsv: one row per scheduled run (start, end, kind, status), so a laptop that slept through runs
// catches up once on the next run and the digest names what was missed instead of silently skipping days.
import { join } from 'node:path';
import { createClock } from './clock.mjs';
import { appendTsv, readTsv } from './tsv.mjs';

export const RUNS_FILE = 'student-runs.tsv';
const HEADER = ['start', 'end', 'kind', 'status'];
export const MAX_LISTED = 7;
const DAY_MS = 86400000;

// Recorded runs from the run ledger.
export async function readRuns(dataDir) {
  return (await readTsv(join(dataDir, RUNS_FILE))).rows;
}

export const recordRun = (dataDir, row) => appendTsv(join(dataDir, RUNS_FILE), HEADER, [row]);

// A run finished when it has an end; a status other than ok (a run that recorded its failure) does not count.
const finished = (r) => Boolean(r.end) && (!r.status || r.status === 'ok');

// The start of the last finished run of this kind, or null.
export function lastSuccess(rows, kind) {
  const ok = rows.filter((r) => r.kind === kind && finished(r)).map((r) => r.start).sort();
  return ok.length ? ok.at(-1) : null;
}

const addDays = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const LOCAL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (v) => (v instanceof Date ? v : new Date(v));

// Local dates of runs recorded as paused: a day the student paused on purpose is not a missed run.
export function pausedDates(rows, tz) {
  const clock = createClock({ timezone: tz || undefined });
  return rows.filter((r) => r.status === 'paused' && r.start).map((r) => clock.localTime(toDate(r.start)).date);
}

/**
 * Missed slots since the last successful run, called as missedSlots({ lastSuccess, now, tz, kind, skip }) or
 * missedSlots(lastSuccess, now, tz). lastSuccess and now may be Dates or strings; a YYYY-MM-DD lastSuccess is that local
 * date. Daily: each local date strictly between the last success and today, minus the dates in skip (paused days); the
 * most recent MAX_LISTED are listed in dates and count is how many more there were. Hourly misses collapse into one
 * count, because the next hourly run covers them all. Returns { dates, count }.
 */
export function missedSlots(arg, nowArg, tzArg) {
  const named = arg !== null && typeof arg === 'object' && !(arg instanceof Date);
  const { lastSuccess: last, now: rawNow, tz, kind = 'daily', skip = [] } = named ? arg : { lastSuccess: arg, now: nowArg, tz: tzArg };
  if (!last) return { dates: [], count: 0 };
  const now = rawNow == null ? new Date() : toDate(rawNow);
  if (kind === 'hourly') {
    const hours = Math.floor((now.getTime() - toDate(last).getTime()) / 3600000) - 1;
    return { dates: [], count: Math.max(0, hours) };
  }
  const clock = createClock({ timezone: tz || undefined });
  const today = clock.localTime(now).date;
  const from = LOCAL_DATE.test(String(last)) ? String(last) : clock.localTime(toDate(last)).date;
  const skipped = new Set(skip);
  const dates = [];
  for (let d = addDays(from, 1); d < today; d = addDays(d, 1)) if (!skipped.has(d)) dates.push(d);
  const listed = dates.slice(-MAX_LISTED);
  return { dates: listed, count: dates.length - listed.length };
}

// Digest line naming missed run dates; null when none were missed.
export function missedLine({ dates, count }) {
  if (!dates.length && !count) return null;
  const more = count ? ` and ${count} earlier date${count === 1 ? '' : 's'}` : '';
  return `missed runs: ${dates.join(', ')}${more}; this run caught up once`;
}
