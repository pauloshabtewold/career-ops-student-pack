import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeCycle } from '../../scripts/cycle.mjs';

const CAL = {
  rollover_month: 7,
  lead_months: 12,
  terms: [
    { name: 'Spring', start_month: 1 },
    { name: 'Summer', start_month: 6 },
    { name: 'Fall', start_month: 8 },
  ],
};
const TODAY = '2026-10-29';

// M-001-S13 normal
test('M-001-S13 an internship-only student graduating 2028-05 gets newgrad_years []', () => {
  const c = computeCycle({ tracks: [{ kind: 'internship', graduation: '2028-05', resume_variant: 'intern-a' }], calendar: CAL, today: TODAY, experienceYears: 0 });
  assert.deepEqual(c.newgrad_years, []);
});

test('M-001-S13 a coop-only student gets newgrad_years []', () => {
  const c = computeCycle({ tracks: [{ kind: 'coop', graduation: '2027-12', resume_variant: 'coop-a' }], calendar: CAL, today: TODAY, experienceYears: 0 });
  assert.deepEqual(c.newgrad_years, []);
});

// M-001-S14 keep
test('M-001-S14 a newgrad track graduating 2027-05 on 2026-10-29 gets newgrad_years [2027]', () => {
  const c = computeCycle({ tracks: [{ kind: 'newgrad', graduation: '2027-05', resume_variant: 'grad-a' }], calendar: CAL, today: TODAY, experienceYears: 0 });
  assert.deepEqual(c.newgrad_years, [2027]);
});
