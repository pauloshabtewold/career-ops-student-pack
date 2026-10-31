// Assumed: lib/usage-cost.mjs exports the frozen measurement data and the estimate functions named in the milestone
// interface. Expected token totals are literals worked out from the 2026-10-30 measurement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, PLAN_IDS, PRICES, estimateUsage, formatCostLine } from '../../lib/usage-cost.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} is not near ${expected}`);
const line = (plan, extra = {}) => formatCostLine({ agent: plan.startsWith('chatgpt') ? 'codex' : 'claude', plan, rows: 20, ...extra });

// M-001-S2
test('M-001-S2 estimateUsage gives claude 20 rows as 1 call with 34560 input and 2080 output tokens', () => {
  const e = estimateUsage({ agent: 'claude', rows: 20 });
  assert.equal(e.calls, 1);
  assert.equal(e.inputTokens, 34560);
  assert.equal(e.outputTokens, 2080);
  assert.equal(e.model, 'sonnet');
  near(e.usd, 0.08992);
});

// M-001-S2
test('M-001-S2 estimateUsage gives codex 250 rows as 13 calls with 406400 input and 7750 output tokens', () => {
  const e = estimateUsage({ agent: 'codex', rows: 250 });
  assert.equal(e.calls, 13);
  assert.equal(e.inputTokens, 406400);
  assert.equal(e.outputTokens, 7750);
  near(e.usd, 0.8903);
});

// M-001-S15
test('M-001-S15 estimateUsage boundaries: 0 rows is 0 calls and 0 tokens, 20 rows is 1 call, 21 rows is 2 calls', () => {
  for (const agent of ['claude', 'codex']) {
    const zero = estimateUsage({ agent, rows: 0 });
    assert.equal(zero.calls, 0);
    assert.equal(zero.inputTokens, 0);
    assert.equal(zero.outputTokens, 0);
    assert.equal(estimateUsage({ agent, rows: 20 }).calls, 1);
    assert.equal(estimateUsage({ agent, rows: 21 }).calls, 2);
  }
  assert.equal(estimateUsage({ agent: 'claude', rows: 21 }).inputTokens, 2 * 3600 + 21 * 1548);
  assert.equal(estimateUsage({ agent: 'claude', rows: 21 }).outputTokens, 21 * 104);
});

// M-001-S8
test('M-001-S8 estimateUsage rejects a negative or non-integer row count and names it', () => {
  assert.throws(() => estimateUsage({ agent: 'claude', rows: -1 }), /-1/);
  assert.throws(() => estimateUsage({ agent: 'claude', rows: 2.5 }), /2\.5/);
  assert.throws(() => estimateUsage({ agent: 'codex', rows: -7 }), /-7/);
});

// W-023-A5-2
test('W-023-A5-2 formatCostLine prints the exact tokens and dollars, and the premium tier changes the dollars and adds the label', () => {
  const api = formatCostLine({ agent: 'claude', plan: 'api', rows: 20 });
  assert.ok(api.includes('20 rows in 1 call; 34,560 input and 2,080 output tokens; about $0.09 API-equivalent at Claude Sonnet 5.5 base rates'), api);
  const premium = formatCostLine({ agent: 'claude', plan: 'api', rows: 150, spendTier: 'premium' });
  assert.ok(premium.includes('150 rows in 8 calls; 261,000 input and 15,600 output tokens; about $1.36 API-equivalent at Claude Opus 5.5 base rates'), premium);
  assert.ok(premium.endsWith('tokens measured at the standard tier'), premium);
  assert.ok(formatCostLine({ agent: 'claude', plan: 'api', rows: 150 }).includes('about $0.68 API-equivalent at Claude Sonnet 5.5 base rates'));
});

// M-001-S2
test('M-001-S2 formatCostLine for every plan id starts with "estimate:" and contains the word estimate', () => {
  for (const plan of PLAN_IDS) {
    const text = line(plan);
    assert.ok(text.startsWith('estimate:'), text);
    assert.match(text, /estimate/);
    assert.equal(text.includes('\n'), false);
  }
});

// M-001-S2
test('M-001-S2 chatgpt-plus shows an at-least percent range of one 5-hour window', () => {
  const text = formatCostLine({ agent: 'codex', plan: 'chatgpt-plus', rows: 250 });
  assert.match(text, /at least/);
  assert.match(text, /lower bound/);
  assert.match(text, /5-hour window/);
  const m = /(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)%/.exec(text);
  assert.ok(m, text);
  assert.ok(Math.abs(Number(m[1]) - 8.125) < 1, text);
  assert.ok(Math.abs(Number(m[2]) - 86.67) < 1, text);
  assert.doesNotMatch(text, /not published/);
});

// M-001-S2
test('M-001-S2 claude-pro, claude-max, claude-ultra and chatgpt-pro say not published and print no percent range', () => {
  for (const plan of ['claude-pro', 'claude-max', 'claude-ultra', 'chatgpt-pro']) {
    const text = line(plan);
    assert.match(text, /not published/, text);
    assert.doesNotMatch(text, /at least/, text);
    assert.doesNotMatch(text, /\d%/, text);
  }
});

// M-001-S2
test('M-001-S2 a claude plan points to /usage and a codex plan points to /status', () => {
  assert.match(line('claude-max'), /\/usage/);
  assert.match(line('chatgpt-pro'), /\/status/);
});

// M-001-S2
test('M-001-S2 the api and unknown plans print no percent range', () => {
  for (const plan of ['api', 'unknown']) assert.doesNotMatch(line(plan), /at least/);
});

// M-001-S2
test('M-001-S2 every plan id has a PLANS entry and every PLANS entry carries a source url accessed 2026-10-30', () => {
  assert.deepEqual(Object.keys(PLANS).sort(), [...PLAN_IDS].sort());
  for (const [id, plan] of Object.entries(PLANS)) {
    assert.ok(Array.isArray(plan.sources) && plan.sources.length > 0, id);
    for (const s of plan.sources) {
      assert.match(s.url, /^https:\/\//, id);
      assert.equal(s.accessed, '2026-10-30', id);
    }
  }
});

// M-001-S2
test('M-001-S2 every PRICES entry carries an https source and the access date 2026-10-30', () => {
  assert.ok(Object.keys(PRICES).length >= 3);
  for (const key of ['sonnet', 'opus', 'gpt-6.1-sol']) assert.ok(PRICES[key], key);
  for (const [id, price] of Object.entries(PRICES)) {
    const text = JSON.stringify(price);
    assert.match(text, /https:\/\//, id);
    assert.match(text, /2026-10-30/, id);
  }
});

// M-001-S5
test('M-001-S5 a calibration of 4 percent per 100 rows over a 5-hour window adds a 200-row line of about 8%', () => {
  const text = formatCostLine({ agent: 'claude', plan: 'claude-pro', rows: 200, calibration: { pctPer100Rows: 4, window: '5-hour' } });
  assert.match(text, /your own measurement: about 8% of your 5-hour window/);
});

// W-024-A5-11
test('W-024-A5-11 a calibration of 4 percent per 100 rows over a weekly window adds a 200-row line of about 8% of the weekly limit', () => {
  const text = formatCostLine({ agent: 'claude', plan: 'claude-pro', rows: 200, calibration: { pctPer100Rows: 4, window: 'weekly' } });
  assert.match(text, /your own measurement: about 8% of your weekly limit/);
  assert.doesNotMatch(text, /5-hour window/);
});

// M-001-S5
test('M-001-S5 without a calibration the line has no own-measurement part', () => {
  assert.doesNotMatch(formatCostLine({ agent: 'claude', plan: 'claude-pro', rows: 200 }), /your own measurement/);
  assert.doesNotMatch(formatCostLine({ agent: 'claude', plan: 'claude-pro', rows: 200, calibration: null }), /your own measurement/);
});

// M-001-S12
test('M-001-S12 premium prices the sonnet-measured claude counts at opus rates', () => {
  const e = estimateUsage({ agent: 'claude', rows: 20, spendTier: 'premium' });
  assert.equal(e.calls, 1);
  assert.equal(e.inputTokens, 34560);
  assert.equal(e.outputTokens, 2080);
  assert.equal(e.model, 'opus');
  near(e.usd, 0.17984);
});

// M-001-S12
test('M-001-S12 premium codex keeps the medium-effort counts', () => {
  const std = estimateUsage({ agent: 'codex', rows: 250 });
  const prem = estimateUsage({ agent: 'codex', rows: 250, spendTier: 'premium' });
  assert.equal(prem.inputTokens, std.inputTokens);
  assert.equal(prem.outputTokens, std.outputTokens);
});

// M-001-S12
test('M-001-S12 the premium line says tokens measured at the standard tier and the standard line does not', () => {
  assert.match(line('claude-pro', { spendTier: 'premium' }), /tokens measured at the standard tier/);
  assert.match(formatCostLine({ agent: 'codex', plan: 'chatgpt-plus', rows: 20, spendTier: 'premium' }), /tokens measured at the standard tier/);
  assert.doesNotMatch(line('claude-pro'), /tokens measured at the standard tier/);
  assert.doesNotMatch(line('claude-pro', { spendTier: 'standard' }), /tokens measured at the standard tier/);
});
