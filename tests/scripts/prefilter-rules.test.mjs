// prefilter({ pipelineText, applicationsText, config, preset, cycle }) -> 'TRIAGE: FAIL | url | 0.0/5 | Title pre-filter: <reason> (<title>)' lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefilter } from '../../scripts/prefilter.mjs';
import { line, pipelineText, jobUrl } from '../helpers/script-harness.mjs';

const PRESET = {
  early_career: 'intern|new grad|university|graduate',
  title_rules: { include: ['software|data|engineer'], exclude: ['sales', 'recruiter'], exclude_unless_citizen: ['security clearance'] },
  search_terms: [],
};
const INTERN_TRACKS = [{ kind: 'internship', graduation: '2028-05', resume_variant: 'intern-a' }];
const NEWGRAD_TRACKS = [{ kind: 'newgrad', graduation: '2027-05', resume_variant: 'grad-a' }];
const CYCLE = { today: '2026-10-29', phase: 'student', terms: [], newgrad_years: [2027], internship_years: [2027], experience_ceiling_years: 1 };

const run = (title, config, cycle = CYCLE) =>
  prefilter({ pipelineText: pipelineText({ pending: [line(jobUrl(1), 'Example Robotics', title)] }), applicationsText: '', config, preset: PRESET, cycle });
const reasonOf = (lines) => {
  assert.equal(lines.length, 1, JSON.stringify(lines));
  const m = /^TRIAGE: FAIL \| \S+ \| 0\.0\/5 \| Title pre-filter: (.+) \(.+\)$/.exec(lines[0]);
  assert.ok(m, `line shape: ${lines[0]}`);
  return m[1];
};

// M-001-S15 normal
test('M-001-S15 a New Grad title fails for a student with no newgrad track', () => {
  const lines = run('Software Engineer, New Grad', { dealbreakers: [], tracks: INTERN_TRACKS });
  assert.equal(reasonOf(lines), 'new-grad role and no new-grad track');
  assert.ok(lines[0].endsWith('(Software Engineer, New Grad)'));
});

test('M-001-S15 an intern title and a New Grad title with a newgrad track both pass', () => {
  assert.deepEqual(run('Software Engineer Intern', { dealbreakers: [], tracks: INTERN_TRACKS }), []);
  assert.deepEqual(run('Software Engineer, New Grad', { dealbreakers: [], tracks: NEWGRAD_TRACKS }), []);
});

// M-001-S23 normal
test('M-001-S23 a title naming a new-grad year outside cycle.newgrad_years fails with graduation year not in cycle', () => {
  const lines = run('Software Engineer, New Grad 2025', { dealbreakers: [], tracks: NEWGRAD_TRACKS });
  assert.equal(reasonOf(lines), 'graduation year not in cycle');
});

test('M-001-S23 a new-grad title naming a year in the cycle passes', () => {
  assert.deepEqual(run('Software Engineer, New Grad 2027', { dealbreakers: [], tracks: NEWGRAD_TRACKS }), []);
});

// M-001-S16 normal
test('M-001-S16 with us_citizen true a clearance-required title passes and with us_citizen absent it fails as an excluded title', () => {
  const title = 'Software Intern (Security Clearance Required)';
  assert.deepEqual(run(title, { dealbreakers: [], tracks: INTERN_TRACKS, us_citizen: true }), []);
  assert.equal(reasonOf(run(title, { dealbreakers: [], tracks: INTERN_TRACKS })), 'excluded title');
});

// M-001-S26 edge
test('M-001-S26 us_citizen false fails a clearance-required title exactly as when absent', () => {
  const title = 'Software Intern (Security Clearance Required)';
  const absent = run(title, { dealbreakers: [], tracks: INTERN_TRACKS });
  const falsy = run(title, { dealbreakers: [], tracks: INTERN_TRACKS, us_citizen: false });
  assert.equal(reasonOf(falsy), 'excluded title');
  assert.deepEqual(falsy, absent);
});

// W-023-A3-4: in nursing "Senior" names the student's school year, not seniority.
test('W-023-A3-4 Senior Nursing Student and Senior Nurse Intern titles pass the real nursing preset; Senior Nurse Manager and Senior Software Engineer still fail', async () => {
  const { loadMerged } = await import('../../lib/presets.mjs');
  const nursing = loadMerged(['nursing']);
  const runNursing = (title) =>
    prefilter({ pipelineText: pipelineText({ pending: [line(jobUrl(1), 'Example Health', title)] }), applicationsText: '', config: { dealbreakers: [], tracks: INTERN_TRACKS }, preset: nursing, cycle: CYCLE });
  assert.deepEqual(runNursing('Senior Nursing Student Extern'), []);
  assert.deepEqual(runNursing('Senior Nurse Intern - Summer 2027'), []);
  assert.equal(reasonOf(runNursing('Senior Nurse Manager')), 'above entry level');
  assert.equal(reasonOf(runNursing('Senior Software Engineer')), 'above entry level');
  assert.equal(reasonOf(runNursing('Senior Student Success Manager')), 'above entry level');
  assert.equal(reasonOf(runNursing('Senior Student Affairs Officer')), 'above entry level');
});
