// Covers M-003-S1..S9: rank-queue hold= and reserved-slot parsing (CLI runs), effort scoring and metro matching (in-process).
// All names are invented. Dates are relative to the harness TODAY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoot, runScript, line, pipelineText, jobUrl, TODAY } from '../helpers/script-harness.mjs';
import { shiftDate } from '../helpers/budget-harness.mjs';
import { parsePipeline } from '../../lib/pipeline-md.mjs';
import { rankQueue } from '../../scripts/rank-queue.mjs';

const TOMORROW = shiftDate(TODAY, 1);
const BASE = 'daily_target: 10\nscore_floor: 3.0\nrank:\n  weights:\n    triage: 1\n';
const row = (n, company, title, triage = '4.5', extra = '') => line(jobUrl(n), company, title, 'Remote', `triage=${triage}${extra ? `; ${extra}` : ''}`);

function runCli(pending) {
  const r = makeRoot({ config: BASE });
  r.write('data/pipeline.md', pipelineText({ pending }));
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

function rank(pendingLines, rankCfg) {
  const config = { daily_target: 10, score_floor: 3.0, rank: rankCfg };
  if (rankCfg === undefined) delete config.rank;
  return rankQueue({ doc: parsePipeline(pipelineText({ pending: pendingLines })), config, today: TODAY });
}
const scoreOf = (res, n) => res.picks.find((p) => p.url === jobUrl(n)).score;
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} !== ${b}`);
const at = (n, company, url, location, extra = '') => line(url, company, `Intern ${n}`, location, `triage=4.5${extra ? `; ${extra}` : ''}`);

// M-003-S1
test('M-003-S1 hold=<tomorrow> (waiting on recruiter) is held and counted, hold=<today> (note) is listed', () => {
  const out = runCli([
    row(1, 'Acme', 'Intern A', '4.9', `hold=${TOMORROW} (waiting on recruiter)`),
    row(2, 'Globex', 'Intern B', '4.5', `hold=${TODAY} (note)`),
  ]);
  assert.deepEqual(out.urls, [jobUrl(2)]);
  assert.match(out.header, /\(1 waiting/);
});

// M-003-S2
test('M-003-S2 hold=<tomorrow>x and hold=soon do not hold the row', () => {
  const out = runCli([row(1, 'Acme', 'Intern A', '4.9', `hold=${TOMORROW}x`), row(2, 'Globex', 'Intern B', '4.5', 'hold=soon')]);
  assert.deepEqual(out.urls, [jobUrl(1), jobUrl(2)]);
  assert.match(out.header, /\(0 waiting/);
});

// M-003-S3
test('M-003-S3 a reserved-slot (last cap slot) row is listed and the other Acme Pending rows are blocked', () => {
  const out = runCli([
    row(1, 'Acme', 'Intern A', '4.9'),
    row(2, 'Acme', 'Intern B', '4.0', 'reserved-slot (last cap slot)'),
    row(3, 'Acme', 'Intern C', '4.8'),
  ]);
  assert.deepEqual(out.urls, [jobUrl(2)]);
  assert.match(out.header, /, 2 blocked by caps, track or reserved-slot rules$/);
});

// M-003-S4
test('M-003-S4 a reserved-slots key does not reserve the company', () => {
  const out = runCli([row(1, 'Acme', 'Intern A', '4.9'), row(2, 'Acme', 'Intern B', '4.0', 'reserved-slots'), row(3, 'Acme', 'Intern C', '4.8')]);
  assert.deepEqual(out.urls, [jobUrl(1), jobUrl(3)]);
  assert.doesNotMatch(out.header, /blocked/);
});

// M-003-S5
test('M-003-S5 with rank.weights unset a prebuilt=yes row and a plain row of equal triage score the same', () => {
  const res = rank([row(1, 'Acme', 'Intern A', '4.5', 'prebuilt=yes'), row(2, 'Globex', 'Intern B', '4.5')], undefined);
  assert.equal(res.picks.length, 2);
  assert.equal(scoreOf(res, 1), scoreOf(res, 2));
});

// M-003-S6
test('M-003-S6 weights triage 1 and effort 10 give prebuilt +10, greenhouse host +8, example.com host +5', () => {
  const res = rank(
    [
      row(1, 'Acme', 'Intern A', '4.5', 'prebuilt=yes'),
      at(2, 'Globex', 'https://boards.greenhouse.io/globex/jobs/2', 'Remote'),
      at(3, 'Initech', 'https://jobs.example.com/initech/3', 'Remote'),
    ],
    { weights: { triage: 1, effort: 10 } },
  );
  const byCompany = Object.fromEntries(res.picks.map((p) => [p.company, p.score]));
  near(byCompany.Acme, 4.5 + 10);
  near(byCompany.Globex, 4.5 + 8);
  near(byCompany.Initech, 4.5 + 5);
});

// M-003-S7
test('M-003-S7 easy_apply_hosts [workday] gives a workday-host row 0.8 and a greenhouse-host row 0.5', () => {
  const res = rank(
    [
      at(1, 'Acme', 'https://acme.wd5.myworkday.com/en-US/careers/job/1', 'Remote'),
      at(2, 'Globex', 'https://boards.greenhouse.io/globex/jobs/2', 'Remote'),
    ],
    { weights: { effort: 1 }, easy_apply_hosts: ['workday'] },
  );
  const byCompany = Object.fromEntries(res.picks.map((p) => [p.company, p.score]));
  near(byCompany.Acme, 0.8);
  near(byCompany.Globex, 0.5);
});

// M-003-S8
test('M-003-S8 metro_match word does not match LA inside Atlanta GA but matches LA, substring matches both', () => {
  const pending = [at(1, 'Acme', jobUrl(1), 'Atlanta GA'), at(2, 'Globex', jobUrl(2), 'LA')];
  const word = rank(pending, { weights: { metro: 1 }, metros: ['LA'], metro_match: 'word' });
  near(scoreOf(word, 1), 0);
  near(scoreOf(word, 2), 1);
  const sub = rank(pending, { weights: { metro: 1 }, metros: ['LA'], metro_match: 'substring' });
  near(scoreOf(sub, 1), 1);
  near(scoreOf(sub, 2), 1);
});

// M-003-S9
test('M-003-S9 in word mode metro a.b is literal so location axb does not match', () => {
  const pending = [at(1, 'Acme', jobUrl(1), 'axb'), at(2, 'Globex', jobUrl(2), 'a.b')];
  const res = rank(pending, { weights: { metro: 1 }, metros: ['a.b'], metro_match: 'word' });
  near(scoreOf(res, 1), 0);
  near(scoreOf(res, 2), 1);
});
