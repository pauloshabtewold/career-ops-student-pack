import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { AnswersError, applyAnswers, buildConfig, validateAgainst } from '../../interview/apply-answers.mjs';
import { parseConfig } from '../../lib/config.mjs';
import { PLAN_IDS } from '../../lib/usage-cost.mjs';
import { PACK_ROOT, TODAY } from '../helpers/script-harness.mjs';

const answersOf = (k, extra = {}) => ({ ...JSON.parse(readFileSync(join(PACK_ROOT, 'tests', 'fixtures', 'answers', `${k}.json`), 'utf8')), ...extra });
const defaultsText = () => readFileSync(join(PACK_ROOT, 'templates', 'student.defaults.yml'), 'utf8');

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'pack-tb-ia-'));
  for (const d of ['config', 'data', 'modes']) mkdirSync(join(root, d));
  writeFileSync(join(root, 'cv.md'), '# Jordan Testwell\n\nSkills: Python, Java, SQL\n');
  return root;
}
const studentYml = (root) => join(root, 'config', 'student.yml');
const written = (root) => yaml.load(readFileSync(studentYml(root), 'utf8'));

// M-003-S1
test('M-003-S1 triage_budget daily 150, first_run all and plan claude-max are written and parse', async () => {
  const root = scratch();
  try {
    await applyAnswers({ answers: answersOf('cs', { triage_budget: { daily: 150, first_run: 'all' }, plan: 'claude-max' }), root, today: TODAY });
    const text = readFileSync(studentYml(root), 'utf8');
    const raw = yaml.load(text);
    assert.equal(raw.triage_budget.daily, 150);
    assert.equal(raw.triage_budget.first_run, 'all');
    assert.equal(raw.plan, 'claude-max');
    const cfg = parseConfig(text, defaultsText());
    assert.equal(cfg.triage_budget.daily, 150);
    assert.equal(cfg.triage_budget.first_run, 'all');
    assert.equal(cfg.plan, 'claude-max');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// M-003-S4
test('M-003-S4 answers without triage_budget and plan write plan unknown and no triage_budget values', async () => {
  const root = scratch();
  try {
    await applyAnswers({ answers: answersOf('cs'), root, today: TODAY });
    const raw = written(root);
    assert.equal(raw.plan, 'unknown');
    const tb = raw.triage_budget ?? {};
    assert.equal(tb.daily, undefined);
    assert.equal(tb.first_run, undefined);
    const cfg = parseConfig(readFileSync(studentYml(root), 'utf8'), defaultsText());
    assert.equal(cfg.plan, 'unknown');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// M-003-S5
test('M-003-S5 limits.triage_daily without triage_budget is written as triage_budget.daily', async () => {
  const root = scratch();
  try {
    const base = answersOf('cs');
    await applyAnswers({ answers: { ...base, limits: { ...(base.limits ?? {}), triage_daily: 50 } }, root, today: TODAY });
    const raw = written(root);
    assert.equal(raw.triage_budget.daily, 50);
    assert.equal(raw.limits?.triage_daily, undefined);
    const cfg = buildConfig({ ...base, limits: { triage_daily: 50 } });
    assert.equal(cfg.triage_budget.daily, 50);
    assert.equal(cfg.limits?.triage_daily, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// M-003-S6
for (const [label, extra, pathPart] of [
  ['daily -1', { triage_budget: { daily: -1 } }, 'triage_budget.daily'],
  ['daily "many"', { triage_budget: { daily: 'many' } }, 'triage_budget.daily'],
  ['first_run 1.5', { triage_budget: { first_run: 1.5 } }, 'triage_budget.first_run'],
  ['plan "gold"', { plan: 'gold' }, 'plan'],
]) {
  test(`M-003-S6 ${label} throws AnswersError naming the path and writes no file`, async () => {
    const root = scratch();
    try {
      await assert.rejects(
        applyAnswers({ answers: answersOf('cs', extra), root, today: TODAY }),
        (err) => err instanceof AnswersError && err.problems.some((p) => p.includes(pathPart)),
      );
      assert.equal(existsSync(studentYml(root)), false, 'no student.yml');
      assert.equal(existsSync(join(root, 'data', 'student-cycle.json')), false, 'no cycle file');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test('M-003-S6 every PLAN_IDS value is accepted', async () => {
  for (const plan of PLAN_IDS) {
    const root = scratch();
    try {
      await applyAnswers({ answers: answersOf('cs', { plan }), root, today: TODAY });
      assert.equal(written(root).plan, plan);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

// M-003-S7
test('M-003-S7 validateAgainst anyOf: one error naming the path on no match, none on a match', () => {
  const schema = { anyOf: [{ type: 'integer', minimum: 0 }, { enum: ['all'] }] };
  assert.deepEqual(validateAgainst(schema, 5, '$.x'), []);
  assert.deepEqual(validateAgainst(schema, 0, '$.x'), []);
  assert.deepEqual(validateAgainst(schema, 'all', '$.x'), []);
  for (const bad of [-1, 'many', 1.5, null]) {
    const errs = validateAgainst(schema, bad, '$.x');
    assert.equal(errs.length, 1, `one error for ${JSON.stringify(bad)}`);
    assert.match(errs[0], /^\$\.x:/);
    assert.match(errs[0], /must match one of the allowed forms/);
  }
});

// M-003-S8
test('M-003-S8 limits.connect_per_day 50 is still written as 20 and reported clamped', async () => {
  const root = scratch();
  try {
    const base = answersOf('cs');
    const res = await applyAnswers({ answers: { ...base, limits: { connect_per_day: 50 } }, root, today: TODAY });
    assert.equal(written(root).limits.connect_per_day, 20);
    assert.ok(res.clamped.includes('connect_per_day'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
