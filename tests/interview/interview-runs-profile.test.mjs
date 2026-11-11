// Assumed transcript format: turns start on a line beginning 'INTERVIEWER:' or 'STUDENT:' (optionally bold);
// part headings are '## Part X: ...' lines. Fixtures live in tests/fixtures/interview-runs/<set>/{transcript.md,answers.json}.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const SETS = ['cs', 'mis', 'finance', 'mechanical', 'nursing'];
const RUNS = join(PACK_ROOT, 'tests', 'fixtures', 'interview-runs');
const collapse = (t) => t.toLowerCase().replace(/\s+/g, ' ').trim();

// Keys of the application profile whose value is absent from the STUDENT and INTERVIEWER turns of Part C.
function profileProblems(transcript, profile) {
  const start = transcript.search(/^## Part C/m);
  const after = start < 0 ? '' : transcript.slice(start);
  const end = after.search(/^## Part D/m);
  const section = end < 0 ? after : after.slice(0, end);
  let turns = '';
  let inTurn = false;
  for (const line of section.split('\n')) {
    const turn = /^\s*(?:\*\*)?(?:INTERVIEWER|STUDENT)(?:\*\*)?\s*:(?:\*\*)?\s*(.*)$/.exec(line);
    if (turn) {
      inTurn = true;
      turns += `\n${turn[1]}`;
    } else if (/^#{1,6}\s/.test(line)) {
      inTurn = false;
    } else if (inTurn) {
      turns += `\n${line}`;
    }
  }
  const hay = collapse(turns);
  return Object.entries(flat(profile))
    .filter(([, v]) => !hay.includes(collapse(String(v))))
    .map(([k]) => k);
}

const flat = (p) => Object.fromEntries(Object.entries(p).flatMap(([k, v]) => (v && typeof v === 'object' ? Object.entries(v).map(([k2, v2]) => [`${k}.${k2}`, v2]) : [[k, v]])));

const transcriptOf = (k) => readFileSync(join(RUNS, k, 'transcript.md'), 'utf8');
const profileOf = (k) => JSON.parse(readFileSync(join(RUNS, k, 'answers.json'), 'utf8')).application_profile;

// M-004-S1
for (const k of SETS) {
  test(`M-004-S1 ${k}: transcript Part C holds every application_profile value`, () => {
    const profile = profileOf(k);
    assert.ok(profile && Object.keys(profile).length > 0, 'answers.json has an application_profile');
    assert.deepEqual(profileProblems(transcriptOf(k), profile), []);
  });
}

// M-004-S2
test('M-004-S2 values match case-insensitively with whitespace collapsed', () => {
  const t = [
    '## Part C: x',
    '',
    'INTERVIEWER: Start date?',
    '',
    'STUDENT: 2027-06, and the   UNIVERSITY',
    'CAREER   fair.',
    '',
    '## Part D: y',
    '',
  ].join('\n');
  assert.deepEqual(profileProblems(t, { start_date: '2027-06', how_did_you_hear: 'University career fair' }), []);
});

// M-004-S3
test('M-004-S3 reports how_did_you_hear missing from a synthetic transcript', () => {
  const t = [
    '## Part C: x',
    '',
    'INTERVIEWER: Start date?',
    '',
    'STUDENT: 2027-06.',
    '',
    '## Part D: y',
    '',
    'STUDENT: University career fair',
    '',
  ].join('\n');
  assert.deepEqual(profileProblems(t, { start_date: '2027-06', how_did_you_hear: 'University career fair' }), ['how_did_you_hear']);
});
