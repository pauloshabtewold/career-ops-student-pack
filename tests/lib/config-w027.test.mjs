// W-027: config keys reviewer (on|off, default off) and research_cache_days (whole number of 1 or more, default 30).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, ConfigError } from '../../lib/config.mjs';
import { readFileSync } from 'node:fs';

const DEFAULTS = readFileSync(new URL('../../templates/student.defaults.yml', import.meta.url), 'utf8');

test('W-027-K1 defaults: reviewer off and a 30 day research cache', () => {
  const cfg = parseConfig('', DEFAULTS);
  assert.equal(cfg.reviewer, 'off');
  assert.equal(cfg.research_cache_days, 30);
});

test('W-027-K2 a student value overrides the default', () => {
  const cfg = parseConfig('reviewer: "on"\nresearch_cache_days: 7\n', DEFAULTS);
  assert.equal(cfg.reviewer, 'on');
  assert.equal(cfg.research_cache_days, 7);
});

test('W-027-K3 a bare on or off is read as a word, not a boolean', () => {
  assert.equal(parseConfig('reviewer: on\n', DEFAULTS).reviewer, 'on');
});

test('W-027-K4 bad values name the key', () => {
  for (const [yml, path] of [['reviewer: maybe\n', 'reviewer'], ['reviewer: true\n', 'reviewer'], ['research_cache_days: 0\n', 'research_cache_days'], ['research_cache_days: 2.5\n', 'research_cache_days'], ['research_cache_days: "30"\n', 'research_cache_days'], ['research_cache_days: -1\n', 'research_cache_days']]) {
    assert.throws(() => parseConfig(yml, DEFAULTS), (e) => e instanceof ConfigError && e.path === path, yml);
  }
});
