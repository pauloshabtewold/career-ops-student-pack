// W-024 A3-5: non-nursing clinical trainee and staff titles are filtered by the real nursing preset before paid triage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMerged } from '../../lib/presets.mjs';
import { prefilter } from '../../scripts/prefilter.mjs';
import { line, pipelineText, jobUrl } from '../helpers/script-harness.mjs';

const CYCLE = { today: '2026-10-29', phase: 'student', terms: [], newgrad_years: [2027], internship_years: [2027], experience_ceiling_years: 1 };
const CONFIG = { dealbreakers: [], tracks: [{ kind: 'newgrad', graduation: '2027-05', resume_variant: 'grad-a' }] };

const kept = (title) =>
  prefilter({ pipelineText: pipelineText({ pending: [line(jobUrl(1), 'Example Health', title)] }), applicationsText: '', config: CONFIG, preset: loadMerged(['nursing']), cycle: CYCLE }).length === 0;

test('W-024-A35 pharmacy, physician, social work and staff program titles are filtered', () => {
  for (const t of ['PGY1 Pharmacy Residency', 'Clinical Pharmacy Resident', 'Clinical Social Work Intern', 'Nurse Residency Program Specialist', 'PGY2 Resident Physician', 'Resident Physician, Internal Medicine', 'Physician Assistant Fellow', 'Nurse Residency Program Coordinator']) {
    assert.equal(kept(t), false, t);
  }
});

test('W-024-A35 real nursing trainee titles still pass', () => {
  for (const t of ['Clinical Nurse Extern', 'RN Residency Program', 'Graduate Nurse Residency', 'Senior Nursing Student Extern', 'Patient Care Tech', 'New Grad Registered Nurse', 'Registered Nurse - Physician Practice, New Grad', 'New Grad RN, Physician Clinic']) {
    assert.equal(kept(t), true, t);
  }
});
