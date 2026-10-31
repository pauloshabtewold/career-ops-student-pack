// The student's own model-usage budget for triage, and the ledger that counts it. This is not a budget.mjs ceiling:
// the rows a student sends to their own model plan are theirs to raise, after the cost is shown (triage-budget.mjs set).
// The ledger data/triage-usage.tsv is the only counting source; digest lines are a readable record, because daily.mjs
// rewrites the day's digest on every run. Node built-ins and lib/tsv.mjs only.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isIsoDate } from './clock.mjs';
import { appendTsv } from './tsv.mjs';

// One agent call carries at most this many rows: a measured 20-row claude call took about 10 minutes of the 15-minute timeout.
export const CHUNK_ROWS = 20;
export const DEFAULT_DAILY = 20;
// 60 rows is the first batch of 20 plus the two further batches of 20 the interview offers.
export const DEFAULT_FIRST_RUN = 60;
export const ALL = 'all';

export const USAGE_FILE = 'triage-usage.tsv';
export const USAGE_HEADER = ['date', 'source', 'rows', 'outcome'];
export const SOURCES = ['scheduled', 'session', 'first-run'];
export const OUTCOMES = ['ok', 'failed'];

const WHOLE = /^\d+$/;

// A whole number of 0 or more (as a number or digit string) or "all"; anything else throws naming the value.
export function parseBudgetValue(text) {
  const s = String(text).trim();
  if (s === ALL) return ALL;
  if (WHOLE.test(s) && Number.isSafeInteger(Number(s))) return Number(s);
  throw new Error(`"${text}" is not a budget: use a whole number of 0 or more, or "all"`);
}

// triage_budget.daily wins over an older limits.triage_daily, which is read as a plain number without clamping.
export function resolveTriageBudget(config = {}) {
  const own = config.triage_budget ?? {};
  const legacy = config.limits?.triage_daily;
  const legacyDaily = Number.isFinite(legacy) ? Math.max(0, Math.floor(legacy)) : undefined;
  const hasCalibration = typeof own.measured_pct_per_100_rows === 'number' && own.measured_window;
  return {
    daily: own.daily ?? legacyDaily ?? DEFAULT_DAILY,
    firstRun: own.first_run ?? DEFAULT_FIRST_RUN,
    calibration: hasCalibration ? { pctPer100Rows: own.measured_pct_per_100_rows, window: own.measured_window } : null,
  };
}

// Rows left under a budget after `used` were counted; "all" never runs out.
export const rowsLeft = (budget, used) => (budget === ALL ? Infinity : Math.max(0, budget - used));

// Rows sent to an agent are recorded whether the call worked or not: tokens are spent once the prompt is received.
export async function appendTriageUsage(dataDir, { date, source, rows, outcome = 'ok' }) {
  if (!isIsoDate(date) || !SOURCES.includes(source) || !Number.isSafeInteger(rows) || rows < 0 || !OUTCOMES.includes(outcome)) {
    throw new Error(`bad triage usage row: ${[date, source, rows, outcome].join(' ')}`);
  }
  await appendTsv(join(dataDir, USAGE_FILE), USAGE_HEADER, [{ date, source, rows, outcome }]);
}

// Scheduled and session rows count for `today` only; first-run rows count from every date because the first run is
// a one-time catch-up. A malformed row is skipped and counted so a hand-edited ledger never blocks a run.
export function readTriageUsage(dataDir, today) {
  const usage = { scheduled: 0, session: 0, firstRun: 0, today: 0, stoppedToday: false, skipped: 0 };
  const file = join(dataDir, USAGE_FILE);
  if (!existsSync(file)) return usage;
  const all = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l !== '');
  // Only a real header line is dropped: a ledger reset by hand has none, and its first row is data.
  const lines = all[0] === USAGE_HEADER.join('\t') ? all.slice(1) : all;
  for (const text of lines) {
    const cells = text.split('\t');
    const [date, source, rawRows, outcome] = cells;
    const rows = WHOLE.test(rawRows ?? '') ? Number(rawRows) : NaN;
    if (cells.length < 4 || !isIsoDate(date) || !Number.isSafeInteger(rows) || !SOURCES.includes(source) || !OUTCOMES.includes(outcome)) {
      usage.skipped++;
    } else if (source === 'first-run') {
      usage.firstRun += rows;
    } else if (date === today) {
      usage[source] += rows;
      if (source === 'scheduled' && outcome === 'failed') usage.stoppedToday = true;
    }
  }
  usage.today = usage.scheduled + usage.session;
  return usage;
}

// Appends '- <line>' entries under '## <heading>' in the day's digest. The heading is written only when the digest's
// last '## ' heading differs, so consecutive chunk lines share one heading.
export function appendDigestLines({ dataDir, today, heading, lines }) {
  const file = join(dataDir, 'digest', `student-${today}.md`);
  mkdirSync(dirname(file), { recursive: true });
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const last = existing.match(/^## .*$/gm)?.at(-1);
  const top = existing ? '' : `# Student daily run ${today}\n`;
  const section = last === `## ${heading}` ? '' : `\n## ${heading}\n`;
  appendFileSync(file, `${top}${section}${lines.map((l) => `- ${l}`).join('\n')}\n`);
}
