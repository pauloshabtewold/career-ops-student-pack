import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { loadPreset, loadMerged } from '../../lib/presets.mjs';
import { isEligible } from '../../plugins/github-lists/_eligibility.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';
import { CYCLE } from '../helpers/feed-harness.mjs';

const ID = 'nursing';

function check(title, preset = loadPreset(ID)) {
  const row = { company: 'Example Health', title, location: 'Boston, MA', date: '2026-10-15', url: 'https://example.org/jobs/1', kind: 'newgrad' };
  return isEligible(row, { cycle: { ...CYCLE, newgrad_years: [2027, 2028] }, titleRules: preset.title_rules, earlyCareer: preset.early_career });
}

test('W-020-S1 nursing validates with 50 to 150 seed employers, each exactly name and careers_url over https', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, ID);
  assert.equal(p.name, 'Nursing');
  assert.ok(p.seed_employers.length >= 50 && p.seed_employers.length <= 150, `${p.seed_employers.length} seeds`);
  for (const [i, e] of p.seed_employers.entries()) {
    assert.deepEqual(Object.keys(e).sort(), ['careers_url', 'name'], `seed ${i}`);
    assert.match(e.careers_url, /^https:\/\//, `seed ${i}`);
  }
});

test('W-020-S2 seed names are unique case-insensitively and careers_url values are unique', () => {
  const seen = { name: new Set(), url: new Set() };
  for (const e of loadPreset(ID).seed_employers) {
    assert.ok(!seen.name.has(e.name.toLowerCase()), `duplicate name ${e.name}`);
    assert.ok(!seen.url.has(e.careers_url), `duplicate url ${e.careers_url}`);
    seen.name.add(e.name.toLowerCase());
    seen.url.add(e.careers_url);
  }
});

test('W-020-S3 nursing is semi-automated with an honest note and no github_lists', () => {
  const p = loadPreset(ID);
  assert.equal(p.coverage.level, 'semi-automated');
  assert.match(p.coverage.note, /not seen|cannot read/i);
  assert.deepEqual(p.sources.github_lists, []);
  assert.deepEqual(p.employer_policies ?? [], []);
  assert.ok(p.search_terms.length >= 4);
  assert.ok(p.archetypes.length >= 3);
});

test('W-020-S4 residency, new grad, graduate nurse and extern titles are eligible', () => {
  for (const t of ['New Grad Registered Nurse, Medical Surgical', 'Nurse Residency Program, Intensive Care', 'Graduate Registered Nurse - Emergency', 'Nurse Extern, Summer', 'Student Nurse Intern', 'Nurse Technician I', 'Patient Care Technician (Student)', 'RN Transition to Practice Program']) {
    const r = check(t);
    assert.equal(r.ok, true, `${t}: ${r.reason}`);
  }
});

test('W-020-S5 senior, manager, travel, practitioner and and LPN titles are not eligible', () => {
  for (const t of ['Senior Registered Nurse Residency Lead', 'Nurse Manager, New Grad Program', 'Travel Nurse Extern', 'Nurse Practitioner Residency', 'CRNA Residency', 'LPN New Grad', 'Staffing Agency Nurse Intern']) {
    assert.equal(check(t).ok, false, t);
  }
});

test('W-020-S6 non-nursing titles are not eligible', () => {
  for (const t of ['Software Engineer Intern', 'Audit Associate', 'Marketing Intern']) assert.equal(check(t).ok, false, t);
});

test('W-020-S7 nursing merged with byo-employer-list keeps the nursing seeds and calendar', () => {
  const m = loadMerged([ID, 'byo-employer-list']);
  assert.equal(m.seed_employers.length, loadPreset(ID).seed_employers.length);
  assert.equal(m.coverage.level, 'semi-automated');
});

test('W-020-S8 the nursing resume fixture is proposed as nursing, not the fallback', () => {
  const file = join(PACK_ROOT, 'tests', 'fixtures', 'resumes', 'nursing.md');
  const out = spawnSync(process.execPath, [join(PACK_ROOT, 'interview', 'detect-field.mjs'), file, '--json'], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 30000 });
  assert.equal(out.status, 0, out.stderr);
  const res = JSON.parse(out.stdout);
  assert.equal(res.pick, ID);
  assert.ok(res.ranked[0].score >= 2);
});
