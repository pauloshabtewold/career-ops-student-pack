// Assumed signature: isEligible(row, { cycle, titleRules: {include, exclude}, earlyCareer: string }) -> { ok, reason }
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isEligible } from '../../plugins/github-lists/_eligibility.mjs';
import { CYCLE, PRESET } from '../helpers/feed-harness.mjs';

const ctx = { cycle: CYCLE, titleRules: PRESET.title_rules, earlyCareer: PRESET.early_career };
const row = (o) => ({ company: 'Example Robotics', title: 'Software Engineer Intern - Summer 2027', location: 'Austin, TX', date: '2026-09-15', url: 'https://boards.greenhouse.io/examplerobotics/jobs/1', kind: 'internship', ...o });
const check = (o) => isEligible(row(o), ctx);

// M-003-S3
test('M-003-S3 internship with a cycle term and year is kept', () => {
  assert.equal(check({}).ok, true);
});

test('M-003-S3 internship for a term outside the cycle is dropped with a reason', () => {
  const r = check({ title: 'Software Engineer Intern - Fall 2026' });
  assert.equal(r.ok, false);
  assert.ok(r.reason && typeof r.reason === 'string');
});

test('M-003-S3 internship for the wrong year is dropped with a reason', () => {
  const r = check({ title: 'Software Engineer Intern - Summer 2028' });
  assert.equal(r.ok, false);
  assert.ok(r.reason);
});

test('M-003-S3 newgrad row is kept for a year in newgrad_years', () => {
  assert.equal(check({ kind: 'newgrad', title: 'Software Engineer, New Grad 2027' }).ok, true);
});

test('M-003-S3 newgrad row for another graduation year is dropped', () => {
  const r = check({ kind: 'newgrad', title: 'Software Engineer, New Grad 2025' });
  assert.equal(r.ok, false);
  assert.ok(r.reason);
});

test('M-003-S3 a title outside the include rules is dropped', () => {
  const r = check({ title: 'Marketing Intern - Summer 2027' });
  assert.equal(r.ok, false);
  assert.ok(r.reason);
});

test('M-003-S3 a title matching an exclude rule is dropped with a reason', () => {
  const r = check({ title: 'Sales Engineer Intern - Summer 2027' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /exclude/i);
});

test('M-003-S3 a title that is not early-career is dropped', () => {
  const r = check({ title: 'Software Engineer II - Summer 2027' });
  assert.equal(r.ok, false);
  assert.ok(r.reason);
});

test('M-003-S3 senior, staff, lead and manager titles are dropped as senior', () => {
  for (const title of ['Senior Software Engineer Intern - Summer 2027', 'Staff Software Engineer, New Grad 2027', 'Lead Data Engineer Intern - Summer 2027', 'Engineering Manager Intern - Summer 2027']) {
    const r = check({ title, kind: title.includes('New Grad') ? 'newgrad' : 'internship' });
    assert.equal(r.ok, false, title);
    assert.match(r.reason, /senior/i, title);
  }
});

test('M-003-S3 PhD-only roles are dropped with a PhD reason', () => {
  const r = check({ title: 'Research Software Intern (PhD) - Summer 2027' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /phd/i);
});

test('M-003-S3 term words are also read from the date field', () => {
  assert.equal(check({ title: 'Software Engineer Intern 2027', date: 'Summer 2027' }).ok, true);
});
