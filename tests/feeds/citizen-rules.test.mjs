// github-lists: kind newgrad rows in the student phase, and exclude_unless_citizen title rules via ctx.config.us_citizen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { isEligible } from '../../plugins/github-lists/_eligibility.mjs';
import plugin from '../../plugins/github-lists/index.mjs';
import * as H from '../helpers/feed-harness.mjs';

const row = (o) => ({ company: 'Example Robotics', title: 'Software Engineer, New Grad 2027', location: 'Austin, TX', date: '2026-09-15', url: 'https://boards.greenhouse.io/examplerobotics/jobs/1', kind: 'newgrad', ...o });

// M-001-S24 error
test('M-001-S24 a kind newgrad row fails in the student phase when newgrad_years is empty', () => {
  const cycle = { ...H.CYCLE, phase: 'student', newgrad_years: [] };
  const r = isEligible(row({}), { cycle, titleRules: H.PRESET.title_rules, earlyCareer: H.PRESET.early_career });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no new-grad year in the cycle');
});

test('M-001-S24 a kind newgrad row in the student phase passes the year check when the cycle names its year', () => {
  const cycle = { ...H.CYCLE, phase: 'student', newgrad_years: [2027] };
  assert.equal(isEligible(row({}), { cycle, titleRules: H.PRESET.title_rules, earlyCareer: H.PRESET.early_career }).ok, true);
});

const RAW = 'https://raw.githubusercontent.com/example-org/';
const LIST = JSON.stringify([
  { company_name: 'Example Robotics', title: 'Software Intern (Security Clearance Required) - Summer 2027', locations: ['Austin, TX'], url: 'https://boards.greenhouse.io/examplerobotics/jobs/301', date_posted: 1758000000, active: true, is_visible: true },
  { company_name: 'Sample Labs', title: 'Data Intern - Summer 2027', locations: ['Remote'], url: 'https://jobs.lever.co/samplelabs/bbb-222', date_posted: 1758000000, active: true, is_visible: true },
]);
const PRESET = { ...H.PRESET, title_rules: { ...H.PRESET.title_rules, exclude_unless_citizen: ['clearance'] } };

async function ingestWith(config) {
  const s = H.scratch();
  try {
    H.writeJson(join(s.data, 'student-github-sources.json'), { sources: [{ name: 'list-a', repo: 'example-org/list-a', path: 'listings.json', format: 'simplify-json', kind: 'internship', status: 'active' }] });
    H.writeJson(join(s.data, 'student-cycle.json'), H.CYCLE);
    const stub = H.stubFetch([[(u) => u.startsWith(`${RAW}list-a/`), () => H.text(LIST, 200)]]);
    const ctx = { dataRoot: s.data, fetch: stub.fetch, sleep: H.sleeper().sleep, today: H.TODAY, dryRun: false, preset: PRESET, config };
    return (await plugin.ingest(ctx)).map((j) => j.title);
  } finally {
    s.cleanup();
  }
}

// M-001-S25 normal
test('M-001-S25 the plugin drops a clearance-required title with us_citizen absent and keeps it with us_citizen true', async () => {
  const absent = await ingestWith({});
  assert.deepEqual(absent, ['Data Intern - Summer 2027']);
  const citizen = await ingestWith({ us_citizen: true });
  assert.deepEqual(citizen.sort(), ['Data Intern - Summer 2027', 'Software Intern (Security Clearance Required) - Summer 2027']);
});
