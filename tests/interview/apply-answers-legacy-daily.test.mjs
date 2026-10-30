import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildConfig } from '../../interview/apply-answers.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const answers = (extra) => ({ ...JSON.parse(readFileSync(join(PACK_ROOT, 'tests', 'fixtures', 'answers', 'cs.json'), 'utf8')), ...extra });

// M-003-S5 edge: legacy daily kept when triage_budget sets only first_run
test('M-003-S5 legacy limits.triage_daily survives a triage_budget with only first_run', () => {
  const cfg = buildConfig(answers({ limits: { triage_daily: 30 }, triage_budget: { first_run: 'all' } }));
  assert.equal(cfg.triage_budget.daily, 30);
  assert.equal(cfg.triage_budget.first_run, 'all');
});
