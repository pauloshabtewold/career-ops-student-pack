// Connect defaults and the raise clamp: a fresh config/student.yml gets connect_per_day 15 and connect_per_rolling_7d 80
// under limits from templates/student.defaults.yml, budget.mjs enforces them, the daily digest and weeklySent() show the
// weekly sent count, and a raise above the budget.mjs ceiling is clamped to it with a budget.clamp action-log row.
// Scratch roots and a fake upstream only; fake companies and targets.
// Rulings: the connect defaults live under limits with the budget.mjs ceiling names; weeklySent returns a number; the
// digest line that carries the weekly count names outreach, connects or sent and the week; the clamp log is the
// budget.clamp row (detail connect_per_day=<asked>;ceiling=<ceiling>) the budget CLI writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadStudentConfig } from '../../lib/config.mjs';
import { appendTsv } from '../../lib/tsv.mjs';
import { weeklySent } from '../../lib/outreach-state.mjs';
import { evaluate } from '../../scripts/budget.mjs';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { DAY, LOG_HEADER, PACK_ROOT, at, shiftDate, liRow, many, makePack, readLog } from '../helpers/budget-harness.mjs';
import { line, pipelineText, jobUrl } from '../helpers/script-harness.mjs';
import { ACME, approve, connectCheck, out } from '../helpers/outreach-harness.mjs';

const APPS = '# Applications\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n| 1 | 2026-03-01 | Example Robotics | Data Intern | 4.2/5 | Applied | no | none | |\n';
const NOW = at(DAY, 15, 0);
const rng = () => 0.5;
const connects = (n, day = DAY) => many(n, (i) => liRow({ ts: at(day, 8, 30 + i * 10), action: 'linkedin.connect', target: `ex-${day}-${i}`, company: `Example Co ${day}-${i}` }));
const connectArgs = { target: 'ex-new', company: 'Example Robotics', pending: 50 };
const week = () => [...connects(2, shiftDate(DAY, -1)), ...connects(2, shiftDate(DAY, -3)), ...connects(2, shiftDate(DAY, -9))];

function runDaily(up, today) {
  const argv = [join(PACK_ROOT, 'scripts', 'daily.mjs'), '--root', up.root, '--data-dir', join(up.root, 'data'), '--today', today];
  const r = spawnSync(process.execPath, argv, { cwd: PACK_ROOT, encoding: 'utf8', timeout: 120000 });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// M-004-S4-osdr
test('M-004-S4-osdr a fresh config defaults to 15 connects a day and 80 a week and the digest shows the weekly count', async () => {
  const p = await makePack();
  try {
    const cfg = await loadStudentConfig({ root: p.root });
    assert.equal(cfg.limits.connect_per_day, 15);
    assert.equal(cfg.limits.connect_per_rolling_7d, 80);
    const ev = (history) => evaluate({ action: 'linkedin.connect', args: connectArgs, history, config: cfg, session: 's1', now: NOW, rng }).status;
    assert.equal(ev(connects(14)), 'ok');
    assert.equal(ev(connects(15)), 'refused', 'the fifteenth connect today is the default stop');
    const days = [1, 2, 3, 4, 5, 6].flatMap((n) => connects(14, shiftDate(DAY, -n)));
    assert.equal(ev(days.slice(0, 79)), 'ok');
    assert.equal(ev(days.slice(0, 80)), 'refused', '80 in the rolling 7 days is the default stop');
  } finally {
    p.cleanup();
  }

  assert.equal(weeklySent(week(), at(DAY, 12).getTime()), 4, 'four connects in the rolling 7 days; the two older ones do not count');

  const up = createFakeUpstream();
  try {
    writeFileSync(join(up.root, 'config', 'student.yml'), 'timezone: America/Chicago\nautomation: scheduled-discovery\npresets: []\n');
    writeFileSync(join(up.root, 'data', 'applications.md'), APPS);
    writeFileSync(join(up.root, 'data', 'pipeline.md'), pipelineText({ pending: [line(jobUrl(1), 'Example Robotics', 'Data Intern', 'Remote', 'triage=4.0')] }));
    await appendTsv(join(up.root, 'data', 'action-log.tsv'), LOG_HEADER, week());
    const res = runDaily(up, DAY);
    assert.equal(res.code, 0, res.stderr);
    const digest = readFileSync(join(up.root, 'data', 'digest', `student-${DAY}.md`), 'utf8');
    const weekLine = digest.split('\n').find((l) => /outreach|connect|sent/i.test(l) && /week|7 days|7-day/i.test(l));
    assert.ok(weekLine, `the digest has a weekly outreach line:\n${digest}`);
    assert.match(weekLine, /(^|\D)4(\D|$)/, `the weekly line shows 4 sent: ${weekLine}`);
  } finally {
    rmSync(up.root, { recursive: true, force: true });
  }
});

// M-004-S5-osdr
test('M-004-S5-osdr a student raising the daily connect limit to 25 is clamped to 20 with the clamp logged', async () => {
  const raised = await makePack({ config: 'limits:\n  connect_per_day: 18\n' });
  const over = await makePack({ config: 'limits:\n  connect_per_day: 25\n' });
  try {
    assert.equal((await loadStudentConfig({ root: raised.root })).limits.connect_per_day, 18, 'a raise up to the ceiling is kept');
    assert.equal((await loadStudentConfig({ root: over.root })).limits.connect_per_day, 20, 'a raise past the ceiling is clamped to it');

    approve(over);
    const r = connectCheck(over, 'ex-new', ACME, 1);
    assert.equal(r.code, 0, out(r));
    const clamp = (await readLog(over)).find((row) => row.action === 'budget.clamp' && row.target === 'connect_per_day');
    assert.ok(clamp, 'the clamp is logged');
    assert.match(clamp.detail, /connect_per_day=25/);
    assert.match(clamp.detail, /ceiling=20/);
  } finally {
    raised.cleanup();
    over.cleanup();
  }
});
