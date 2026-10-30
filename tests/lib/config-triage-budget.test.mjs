// Assumed: parseConfig(text, defaultsText) validates triage_budget and plan; ConfigError.path names the failing key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError, parseConfig } from '../../lib/config.mjs';
import { PLAN_IDS } from '../../lib/usage-cost.mjs';
import { PACK_ROOT } from '../helpers/budget-harness.mjs';

const rejects = (yml, path) =>
  assert.throws(
    () => parseConfig(yml, ''),
    (e) => {
      assert.ok(e instanceof ConfigError, String(e));
      assert.equal(e.path, path);
      return true;
    },
  );

// M-001-S7
test('M-001-S7 parseConfig accepts triage_budget daily 0, 150 and "all" and first_run values', () => {
  assert.equal(parseConfig('triage_budget:\n  daily: 0\n', '').triage_budget.daily, 0);
  assert.equal(parseConfig('triage_budget:\n  daily: 150\n', '').triage_budget.daily, 150);
  assert.equal(parseConfig('triage_budget:\n  daily: all\n', '').triage_budget.daily, 'all');
  assert.equal(parseConfig('triage_budget:\n  first_run: 100\n', '').triage_budget.first_run, 100);
  assert.equal(parseConfig('triage_budget:\n  first_run: all\n', '').triage_budget.first_run, 'all');
});

// M-001-S7
test('M-001-S7 parseConfig accepts every plan id and a calibration', () => {
  for (const id of PLAN_IDS) assert.equal(parseConfig(`plan: ${id}\n`, '').plan, id);
  const c = parseConfig('triage_budget:\n  measured_pct_per_100_rows: 4\n  measured_window: weekly\n', '');
  assert.equal(c.triage_budget.measured_pct_per_100_rows, 4);
  assert.equal(c.triage_budget.measured_window, 'weekly');
});

// M-001-S7
test('M-001-S7 parseConfig rejects triage_budget.daily -1, 2.5 and "lots" with the key as path', () => {
  rejects('triage_budget:\n  daily: -1\n', 'triage_budget.daily');
  rejects('triage_budget:\n  daily: 2.5\n', 'triage_budget.daily');
  rejects('triage_budget:\n  daily: lots\n', 'triage_budget.daily');
  assert.throws(() => parseConfig('triage_budget:\n  daily: lots\n', ''), /expected a whole number of 0 or more, or "all"/);
});

// M-001-S7
test('M-001-S7 parseConfig rejects a bad first_run, a bad calibration and plan "gold" with the key as path', () => {
  rejects('triage_budget:\n  first_run: -5\n', 'triage_budget.first_run');
  rejects('triage_budget:\n  first_run: 1.5\n', 'triage_budget.first_run');
  rejects('triage_budget:\n  first_run: many\n', 'triage_budget.first_run');
  rejects('triage_budget:\n  measured_pct_per_100_rows: 0\n', 'triage_budget.measured_pct_per_100_rows');
  rejects('triage_budget:\n  measured_window: daily\n', 'triage_budget.measured_window');
  rejects('plan: gold\n', 'plan');
});

// M-001-S7
test('M-001-S7 an older limits.triage_daily still parses', () => {
  assert.equal(parseConfig('limits:\n  triage_daily: 50\n', '').limits.triage_daily, 50);
});

// M-001-S1
test('M-001-S1 the shipped defaults file sets an empty triage_budget and plan unknown', () => {
  const defaults = readFileSync(join(PACK_ROOT, 'templates', 'student.defaults.yml'), 'utf8');
  const c = parseConfig('', defaults);
  assert.deepEqual(c.triage_budget, {});
  assert.equal(c.plan, 'unknown');
});
