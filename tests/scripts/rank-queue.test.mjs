// Assumed CLI: node scripts/rank-queue.mjs --json --root R --data-dir D --today T [--n N]. Output is a JSON array
// (or an object with rows) of rows with url, best first. Config rank.weights keys: triage (multiplies the triage
// score) and marquee (added when the company is in rank.marquee). data/contacts.tsv columns: date, company, name,
// stage (connect | referral-ask). Posting age comes from a posted~<N>d token. Connections.csv is optional.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRoot, runScript, line, pipelineText, jobUrl } from '../helpers/script-harness.mjs';
import { serializeTsv } from '../../lib/tsv.mjs';

const CONFIG = 'daily_target: 10\nscore_floor: 3.0\nrank:\n  weights:\n    triage: 1\n    marquee: 5\n  marquee:\n    - Marquee Co\n';
const row = (n, company, score, extra = '') => line(jobUrl(n), company, `Intern ${n}`, 'Remote', `triage=${score}${extra ? `; ${extra}` : ''}`);
const contact = (date, company, stage) => ({ date, company, name: 'Pat Example', stage });
const CONTACT_HEADER = ['date', 'company', 'name', 'stage'];

function setup(pending, contacts = []) {
  const r = makeRoot({ config: CONFIG });
  r.write('data/pipeline.md', pipelineText({ pending }));
  if (contacts.length) r.write('data/contacts.tsv', serializeTsv(CONTACT_HEADER, contacts));
  return r;
}
const rank = (r, extra = []) => {
  const out = runScript('rank-queue', ['--json', ...extra], r);
  assert.equal(out.code, 0, out.stderr);
  const v = JSON.parse(out.stdout);
  return (Array.isArray(v) ? v : v.rows).map((x) => x.url);
};

// M-004-S11
test('M-004-S11 orders by configured weights, at most 2 per company, none below the effective floor', () => {
  const r = setup([
    row(1, 'Alpha Co', '4.9'),
    row(2, 'Alpha Co', '4.8'),
    row(3, 'Alpha Co', '4.7'),
    row(4, 'Beta Co', '4.0'),
    row(5, 'Marquee Co', '3.6'),
    row(6, 'Delta Co', '3.2'),
  ]);
  try {
    assert.deepEqual(rank(r), [jobUrl(5), jobUrl(1), jobUrl(2), jobUrl(4)]);
  } finally {
    r.cleanup();
  }
});

// M-004-S11
test('M-004-S11 ties break by url and --n caps the list', () => {
  const r = setup([row(12, 'Beta Co', '4.0'), row(11, 'Gamma Co', '4.0'), row(13, 'Delta Co', '4.0')]);
  try {
    assert.deepEqual(rank(r), [jobUrl(11), jobUrl(12), jobUrl(13)]);
    assert.deepEqual(rank(r, ['--n', '2']), [jobUrl(11), jobUrl(12)]);
  } finally {
    r.cleanup();
  }
});

// M-004-S12
test('M-002-S10 M-004-S12 a connect under 5 days old holds the company unless the posting is over 14 days old', () => {
  const r = setup(
    [
      row(1, 'Hold Co', '4.5', 'posted~3d'),
      row(2, 'Late Co', '4.4', 'posted~20d'),
      row(3, 'Free Co', '4.0', 'posted~3d'),
      row(4, 'Aged Co', '4.2', 'posted~3d'),
      row(5, 'Ask Co', '4.6', 'posted~3d'),
    ],
    [
      contact('2026-10-24', 'Hold Co', 'connect'),
      contact('2026-10-24', 'Late Co', 'connect'),
      contact('2026-10-20', 'Aged Co', 'connect'),
      contact('2026-10-26', 'Ask Co', 'referral-ask'),
    ],
  );
  try {
    assert.deepEqual(rank(r), [jobUrl(2), jobUrl(4), jobUrl(3)]);
  } finally {
    r.cleanup();
  }
});

// M-004-S11
test('M-004-S11 rank-queue is read-only', () => {
  const r = setup([row(1, 'Alpha Co', '4.9')]);
  try {
    const before = r.read('data/pipeline.md');
    rank(r);
    assert.equal(r.read('data/pipeline.md'), before);
    assert.deepEqual(r.list('data'), ['pipeline.md']);
  } finally {
    r.cleanup();
  }
});
