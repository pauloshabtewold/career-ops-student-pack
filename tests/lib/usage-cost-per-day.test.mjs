// SYNTHETIC FIXTURE: placeholder companies, postings and cv text only.
// M-005 digest additions: the per-day token estimate (lib/usage-cost.mjs perDayEstimate, triage-budget.mjs status
// --per-day) and the Sunday skill-gap section the daily digest builds from saved job text of matched rows. Fake upstream
// only; no model call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PER_CALL, perDayEstimate } from '../../lib/usage-cost.mjs';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT, jobUrl, line, makeRoot, pipelineText, runScript } from '../helpers/script-harness.mjs';

const SUNDAY = '2026-11-22';
const MONDAY = '2026-11-23';

test('the per-day estimate adds triage, cover letters, outreach drafts and questions, labelled an estimate', () => {
  const day = perDayEstimate({ agent: 'claude', daily_target: 4, limits: { connect_per_day: 3 } });
  assert.equal(day.parts.covers, 4 * PER_CALL.cover);
  assert.equal(day.parts.outreach, 3 * PER_CALL.outreach);
  assert.equal(day.parts.questions, 2 * PER_CALL.question);
  assert.equal(day.tokens, day.parts.triage + day.parts.covers + day.parts.outreach + day.parts.questions);
  assert.equal(day.label, 'estimate');
  assert.equal(perDayEstimate({ agent: 'codex' }).agent, 'codex');
});

test('triage-budget.mjs status --per-day prints the per-day line labelled an estimate', () => {
  const r = makeRoot({ config: 'agent: claude\n' });
  try {
    const res = runScript('triage-budget', ['status', '--per-day'], r);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /^Per-day tokens \(estimate\): about [\d,]+ with claude \(triage [\d,]+, cover letters [\d,]+, outreach [\d,]+, questions [\d,]+\)$/m);
    assert.doesNotMatch(runScript('triage-budget', ['status'], r).stdout, /Per-day tokens/);
  } finally {
    r.cleanup();
  }
});

const posting = (skills) => ['Data Analyst Intern', '', 'Requirements:', ...skills.map((s) => `- Experience with ${s}`), ''].join('\n');

function runDaily(up, today) {
  const argv = [join(PACK_ROOT, 'scripts', 'daily.mjs'), '--root', up.root, '--data-dir', join(up.root, 'data'), '--today', today];
  const res = spawnSync(process.execPath, argv, { cwd: PACK_ROOT, encoding: 'utf8', timeout: 120000 });
  assert.equal(res.status, 0, res.stderr);
  return readFileSync(join(up.root, 'data', 'digest', `student-${today}.md`), 'utf8');
}

test('the Sunday digest lists a requirement seen in 3 matched postings and absent from cv.md; a weekday digest has no skill-gap section', () => {
  const up = createFakeUpstream();
  try {
    writeFileSync(join(up.root, 'config', 'student.yml'), 'timezone: America/Chicago\nautomation: scheduled-discovery\npresets: []\n');
    writeFileSync(join(up.root, 'cv.md'), '# Sam Placeholder\n\n## Skills\n\n- SQL\n- Excel\n');
    mkdirSync(join(up.root, 'data', 'jds'), { recursive: true });
    const skills = [['SQL', 'Tableau', 'Docker'], ['SQL', 'Tableau', 'Docker'], ['SQL', 'Tableau'], ['Tableau']];
    const processed = skills.map((s, i) => {
      writeFileSync(join(up.root, 'data', 'jds', `jd${i + 1}.txt`), posting(s));
      // The fourth row is below the matched floor, so its posting does not count.
      return line(jobUrl(i + 1), `Company ${i + 1} Example`, 'Data Analyst Intern', 'Remote', `triage=${i === 3 ? '3.0' : '4.5'}; jd=jd${i + 1}.txt`).replace('- [ ]', '- [x]');
    });
    writeFileSync(join(up.root, 'data', 'pipeline.md'), pipelineText({ processed }));
    const sunday = runDaily(up, SUNDAY);
    const section = sunday.slice(sunday.indexOf('## Skill gaps this week'));
    assert.ok(sunday.includes('## Skill gaps this week'), sunday);
    assert.match(section, /^- tableau \(in 3 matched postings\): publish one dashboard/m);
    assert.doesNotMatch(section, /docker|^- sql/im);
    assert.doesNotMatch(runDaily(up, MONDAY), /Skill gaps/);
  } finally {
    rmSync(up.root, { recursive: true, force: true });
  }
});
