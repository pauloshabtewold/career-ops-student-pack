import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const read = (rel) => readFileSync(join(PACK_ROOT, rel), 'utf8');
const interview = read('interview/interview.md');
const lines = interview.split('\n');
const section = (title) => {
  const start = lines.findIndex((l) => l.startsWith(`## ${title}`));
  assert.ok(start >= 0, `section ${title} exists`);
  let end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join('\n');
};
const dailyRun = read('modes/daily-run.md');
const agents = read('AGENTS.student.md');

// M-003-S2
test('M-003-S2 interview.md line 12 splits the student triage budget from fixed budget.mjs limits', () => {
  const l = lines[11];
  assert.match(l, /budget\.mjs/);
  assert.match(l, /tighten/i);
  assert.match(l, /triage budget/i);
  assert.match(l, /student's/);
  assert.match(l, /\b20\b/);
  assert.match(l, /\b60\b/);
  assert.match(l, /"all"/);
});

test('M-003-S2 Phase 4 limits paragraph names the triage budget as the student\'s and budget.mjs limits as fixed', () => {
  const p4 = section('Phase 4');
  const para = p4.split('\n').find((l) => l.startsWith('Below the limits table'));
  assert.ok(para, 'limits paragraph present');
  assert.match(para, /scripts\/budget\.mjs/);
  assert.match(para, /triage budget/i);
  assert.match(para, /student's/);
  assert.match(para, /fixed/);
  assert.match(para, /tighten/i);
});

test('M-003-S2 Phase 5 asks plan and both budgets and shows the triage-budget cost line', () => {
  const p5 = section('Phase 5');
  assert.match(p5, /triage budget/i);
  for (const plan of ['claude-pro', 'claude-max', 'claude-ultra', 'chatgpt-plus', 'chatgpt-pro', 'api', 'unknown']) {
    assert.ok(p5.includes(plan), `plan ${plan} listed`);
  }
  assert.match(p5, /first-run|first run/i);
  assert.match(p5, /node student\/scripts\/triage-budget\.mjs cost/);
  assert.match(p5, /--plan/);
  assert.match(p5, /--agent/);
  assert.match(p5, /`claude`/);
  assert.match(p5, /`codex`/);
  assert.match(p5, /\b20\b/);
  assert.match(p5, /\b60\b/);
});

test('M-003-S2 Phase 6 batches stop at the first-run budget and log with --first-run', () => {
  const p6 = section('Phase 6');
  assert.match(p6, /node student\/scripts\/triage-budget\.mjs log <n> --first-run/);
  assert.match(p6, /first-run budget/i);
  assert.match(p6, /triage-budget\.mjs set <n\|all> --first-run/);
  assert.doesNotMatch(p6, /two extra batches/);
});

// M-003-S3
test('M-003-S3 daily-run.md step 2 reads status, stops at the rows left and logs rows', () => {
  const step2 = dailyRun.split('\n').find((l) => /^2\. /.test(l));
  assert.ok(step2, 'step 2 present');
  assert.match(step2, /node student\/scripts\/triage-budget\.mjs status/);
  assert.match(step2, /rows left/i);
  assert.match(step2, /apply-triage\.mjs/);
  assert.match(step2, /node student\/scripts\/triage-budget\.mjs log <n>/);
  assert.doesNotMatch(step2, /`triage_daily` cap/);
  assert.match(dailyRun, /daily triage budget/i);
  assert.match(dailyRun, /cost line/i);
});

test('M-003-S3 AGENTS.student.md routes a raise through set then --confirm and keeps budget.mjs caps lower-only', () => {
  assert.match(agents, /the user can only lower caps/);
  assert.match(agents, /never edit `?triage_budget`? by hand/i);
  assert.match(agents, /triage-budget\.mjs status/);
  // W-023-A5-8: one sentence carries the whole consent order: set with the estimate shown, then --confirm only after a yes.
  const sentence = agents.split(/\.\s/).find((s) => s.includes('set <n|all>'));
  assert.ok(sentence, 'one sentence holds set <n|all>');
  assert.match(sentence, /set <n\|all>`[^]*show the printed estimate[^]*run it again with `--confirm` only after the student says yes$/);
  assert.ok(sentence.indexOf('estimate') < sentence.indexOf('--confirm'), 'the estimate comes before --confirm');
  assert.doesNotMatch(sentence, /--confirm[^]*estimate/);
});

test('W-023-A5-8 the consent pin rejects a sentence that confirms before the student says yes', () => {
  const bad = 'run `triage-budget.mjs set <n|all> --confirm` right away, then tell the student the estimate and ask if the student says yes to more';
  assert.doesNotMatch(bad, /set <n\|all>`[^]*show the printed estimate[^]*run it again with `--confirm` only after the student says yes$/);
});

test('M-003-S3 touched files carry no em dash or curly quote', () => {
  for (const [name, text] of [['interview.md', interview], ['daily-run.md', dailyRun], ['AGENTS.student.md', agents]]) {
    assert.doesNotMatch(text, /[\u2014\u2018\u2019\u201C\u201D]/, `${name} has no em dash or curly quote`);
  }
});
