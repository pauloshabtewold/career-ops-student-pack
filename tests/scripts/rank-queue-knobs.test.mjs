// Covers M-003-S1..S14: rank-queue company caps, intern-only, one-track, hold= and reserved-slot rules via the CLI.
// All names are invented. Dates are relative to the harness TODAY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoot, runScript, line, pipelineText, jobUrl, TODAY } from '../helpers/script-harness.mjs';
import { shiftDate } from '../helpers/budget-harness.mjs';
import { serializeTsv } from '../../lib/tsv.mjs';
import { LOG_HEADER } from '../../lib/action-log.mjs';
import { parsePipeline } from '../../lib/pipeline-md.mjs';
import { rankQueue } from '../../scripts/rank-queue.mjs';

const BASE = 'daily_target: 10\nscore_floor: 3.0\nrank:\n  weights:\n    triage: 1\n';
const cfg = (extra = '') => `${BASE}${extra}`;
const row = (n, company, title, triage = '4.5', extra = '') => line(jobUrl(n), company, title, 'Remote', `triage=${triage}${extra ? `; ${extra}` : ''}`);
const APP_HEAD = '| # | Date | Company | Role | Score | Status | Notes |\n|---|------|---------|------|-------|--------|-------|\n';
const app = (n, company, role, status) => `| ${n} | 2026-10-01 | ${company} | ${role} | 4.5/5 | ${status} | |`;
const appsText = (...rows) => `# Applications\n\n${APP_HEAD}${rows.join('\n')}\n`;

function setup({ config, pending, apps, log }) {
  const r = makeRoot({ config });
  r.write('data/pipeline.md', pipelineText({ pending }));
  if (apps) r.write('data/applications.md', apps);
  if (log) r.write('data/action-log.tsv', serializeTsv([...LOG_HEADER], log));
  return r;
}
const submit = (company, date) => ({ ts: `${date}T10:00:00.000Z`, date, session: 's1', action: 'apply.submit', target: jobUrl(900), company, approval: 'user', detail: 'ok' });

function run(opts) {
  const r = setup(opts);
  try {
    const json = runScript('rank-queue', ['--json'], r);
    assert.equal(json.code, 0, json.stderr);
    const v = JSON.parse(json.stdout);
    const text = runScript('rank-queue', [], r);
    assert.equal(text.code, 0, text.stderr);
    return { urls: (Array.isArray(v) ? v : v.rows).map((x) => x.url), header: text.stdout.split('\n')[0] };
  } finally {
    r.cleanup();
  }
}
const BLOCKED = (n) => new RegExp(`, ${n} blocked by caps, track or reserved-slot rules$`);

// M-003-S1 keep
test('M-003-S1 the earlier-wave fixture prints the same picks and header with no new knob', () => {
  const config = 'daily_target: 10\nscore_floor: 3.0\nrank:\n  weights:\n    triage: 1\n    marquee: 5\n  marquee:\n    - Marquee Co\n';
  const out = run({
    config,
    pending: [
      row(1, 'Alpha Co', 'Intern 1', '4.9'),
      row(2, 'Alpha Co', 'Intern 2', '4.8'),
      row(3, 'Alpha Co', 'Intern 3', '4.7'),
      row(4, 'Beta Co', 'Intern 4', '4.0'),
      row(5, 'Marquee Co', 'Intern 5', '3.6'),
      row(6, 'Delta Co', 'Intern 6', '3.2'),
    ],
  });
  assert.deepEqual(out.urls, [jobUrl(5), jobUrl(1), jobUrl(2), jobUrl(4)]);
  assert.equal(out.header, 'Top 4 of 5 eligible (0 waiting on referral timing)');
});

// M-003-S2
test('M-003-S2 cap 3 with 2 applied lists exactly 1 of 3 eligible Acme rows', () => {
  const out = run({
    config: cfg('  company_caps:\n    Acme: 3\n'),
    pending: [row(1, 'Acme', 'Intern A', '4.9'), row(2, 'Acme', 'Intern B', '4.8'), row(3, 'Acme', 'Intern C', '4.7')],
    apps: appsText(app(1, 'Acme', 'Intern X', 'Applied'), app(2, 'Acme', 'Intern Y', 'Interview')),
  });
  assert.deepEqual(out.urls, [jobUrl(1)]);
});

// M-003-S3
test('M-004-S11 M-003-S3 cap 2 with 2 applied lists no Acme row and the header reports 3 blocked', () => {
  const out = run({
    config: cfg('  company_caps:\n    Acme: 2\n'),
    pending: [row(1, 'Acme', 'Intern A', '4.9'), row(2, 'Acme', 'Intern B', '4.8'), row(3, 'Acme', 'Intern C', '4.7'), row(4, 'Globex', 'Intern D', '4.0')],
    apps: appsText(app(1, 'Acme', 'Intern X', 'Applied'), app(2, 'Acme', 'Intern Y', 'Applied')),
  });
  assert.deepEqual(out.urls, [jobUrl(4)]);
  assert.match(out.header, BLOCKED(3));
});

// M-003-S4
test('M-003-S4 Rejected and Evaluated rows do not count toward the cap', () => {
  const out = run({
    config: cfg('  company_caps:\n    Acme: 2\n'),
    pending: [row(1, 'Acme', 'Intern A', '4.9'), row(2, 'Acme', 'Intern B', '4.8'), row(3, 'Acme', 'Intern C', '4.7')],
    apps: appsText(app(1, 'Acme', 'Intern X', 'Rejected'), app(2, 'Acme', 'Intern Y', 'Evaluated')),
  });
  assert.deepEqual(out.urls, [jobUrl(1), jobUrl(2)]);
});

// M-003-S4
test('M-003-S4 a logged apply.submit counts toward the cap when the only tracker row is Rejected', () => {
  const out = run({
    config: cfg('  company_caps:\n    Globex: 1\n'),
    pending: [row(1, 'Globex', 'Intern A', '4.9'), row(2, 'Globex', 'Intern B', '4.8'), row(3, 'Initech', 'Intern C', '4.0')],
    apps: appsText(app(1, 'Globex', 'Intern X', 'Rejected')),
    log: [submit('Globex', shiftDate(TODAY, -7))],
  });
  assert.deepEqual(out.urls, [jobUrl(3)]);
  assert.match(out.header, BLOCKED(2));
});

// M-003-S5
test('M-003-S5 cap 10 with nothing applied still lists at most 2 Acme rows', () => {
  const out = run({
    config: cfg('  company_caps:\n    Acme: 10\n'),
    pending: [1, 2, 3, 4].map((n) => row(n, 'Acme', `Intern ${n}`, `4.${10 - n}`)),
  });
  assert.deepEqual(out.urls, [jobUrl(1), jobUrl(2)]);
});

// M-003-S6
test('M-003-S6 intern_only Globex blocks a Software Engineer row and lists the intern row', () => {
  const out = run({
    config: cfg('  intern_only:\n    - Globex\n'),
    pending: [row(1, 'Globex', 'Software Engineer', '4.9'), row(2, 'Globex', 'Software Engineering Intern', '4.5')],
  });
  assert.deepEqual(out.urls, [jobUrl(2)]);
  assert.match(out.header, BLOCKED(1));
});

// M-003-S7
test('M-003-S7 one_track_per_company true blocks the other track, false lists both', () => {
  const pending = [row(1, 'Initech', 'Software Engineer', '4.9'), row(2, 'Initech', 'Software Engineering Co-op', '4.5')];
  const apps = appsText(app(1, 'Initech', 'Software Engineering Intern', 'Applied'));
  const on = run({ config: cfg('  one_track_per_company: true\n'), pending, apps });
  assert.deepEqual(on.urls, [jobUrl(2)]);
  assert.match(on.header, BLOCKED(1));
  const off = run({ config: cfg('  one_track_per_company: false\n'), pending, apps });
  assert.deepEqual(off.urls, [jobUrl(1), jobUrl(2)]);
});

// M-003-S8
test('M-003-S8 hold= after today is held and counted, hold= today is listed', () => {
  const out = run({
    config: cfg(),
    pending: [row(1, 'Acme', 'Intern A', '4.9', `hold=${shiftDate(TODAY, 1)}`), row(2, 'Globex', 'Intern B', '4.5', `hold=${TODAY}`)],
  });
  assert.deepEqual(out.urls, [jobUrl(2)]);
  assert.match(out.header, /\(1 waiting/);
});

// M-003-S9
test('M-003-S9 a hold= value that is not a date does not hold the row', () => {
  const out = run({ config: cfg(), pending: [row(1, 'Acme', 'Intern A', '4.9', 'hold=soon')] });
  assert.deepEqual(out.urls, [jobUrl(1)]);
  assert.match(out.header, /\(0 waiting/);
});

// M-003-S10
test('M-003-S10 the reserved-slot row is listed and other Acme Pending rows are blocked', () => {
  const out = run({
    config: cfg(),
    pending: [row(1, 'Acme', 'Intern A', '4.9'), row(2, 'Acme', 'Intern B', '4.0', 'reserved-slot'), row(3, 'Acme', 'Intern C', '4.8')],
  });
  assert.deepEqual(out.urls, [jobUrl(2)]);
  assert.match(out.header, BLOCKED(2));
});

// M-003-S11
test('M-003-S11 ignore_words international folds Acme International into Acme', () => {
  const out = run({
    config: cfg('  ignore_words:\n    - international\n'),
    pending: [row(1, 'Acme International', 'Intern A', '4.9'), row(2, 'Acme', 'Intern B', '4.8'), row(3, 'Acme International', 'Intern C', '4.7'), row(4, 'Acme', 'Intern D', '4.6')],
  });
  assert.deepEqual(out.urls, [jobUrl(1), jobUrl(2)]);
});

// M-003-S12
test('M-003-S12 a cap on a parent applies to rows under an alias name', () => {
  const out = run({
    config: cfg('  parent_companies:\n    Vandelay:\n      - Kramerica\n  company_caps:\n    Vandelay: 1\n'),
    pending: [row(1, 'Kramerica', 'Intern A', '4.9'), row(2, 'Kramerica', 'Intern B', '4.8')],
  });
  assert.deepEqual(out.urls, [jobUrl(1)]);
});

// M-003-S13
test('M-003-S13 with no blocking rule rankQueue returns blocked 0 and the header has no blocked phrase', () => {
  const text = pipelineText({ pending: [row(1, 'Acme', 'Intern A', '4.9'), row(2, 'Globex', 'Intern B', '4.5')] });
  const res = rankQueue({ doc: parsePipeline(text), config: { daily_target: 10, score_floor: 3.0, rank: { weights: { triage: 1 } } }, today: TODAY });
  assert.equal(res.blocked, 0);
  const out = run({ config: cfg(), pending: [row(1, 'Acme', 'Intern A', '4.9')] });
  assert.doesNotMatch(out.header, /blocked/);
});

// M-003-S14
test('M-003-S14 cap 1 with one logged submit and no tracker row blocks every Acme row', () => {
  const out = run({
    config: cfg('  company_caps:\n    Acme: 1\n'),
    pending: [row(1, 'Acme', 'Intern A', '4.9'), row(2, 'Acme', 'Intern B', '4.8'), row(3, 'Globex', 'Intern C', '4.0')],
    log: [submit('Acme', shiftDate(TODAY, -3))],
  });
  assert.deepEqual(out.urls, [jobUrl(3)]);
  assert.match(out.header, BLOCKED(2));
});
