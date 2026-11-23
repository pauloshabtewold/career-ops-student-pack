// Keep: the triage ledger columns and the estimate cost lines as v0.11.0 writes them. Scratch data dir only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendTriageUsage } from '../../lib/triage-budget.mjs';
import { formatCostLine } from '../../lib/usage-cost.mjs';

// M-006-S8-osdr
test('M-006-S8-osdr keep: data/triage-usage.tsv columns and estimate lines stay unchanged', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-triage-keep-'));
  try {
    await appendTriageUsage(dir, { date: '2026-11-22', source: 'scheduled', rows: 20 });
    assert.equal(readFileSync(join(dir, 'triage-usage.tsv'), 'utf8'), 'date\tsource\trows\toutcome\n2026-11-22\tscheduled\t20\tok\n');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(
    formatCostLine({ agent: 'claude', rows: 20 }),
    'estimate: 20 rows in 1 call; 38,020 input and 1,500 output tokens; about $0.09 API-equivalent at Claude Sonnet 5.5 base rates, no cache discount; plan not set; read your share in /usage (Claude Code) or /status (Codex)',
  );
  assert.equal(
    formatCostLine({ agent: 'codex', plan: 'chatgpt-plus', rows: 45 }),
    'estimate: 45 rows in 3 calls; 83,805 input and 1,395 output tokens; about $0.18 API-equivalent at gpt-6.1-sol base rates, no cache discount; at least 1.9-20% of one 5-hour window (lower bound: one chunk counted as one message)',
  );
  assert.equal(
    formatCostLine({ agent: 'claude', plan: 'claude-pro', rows: 20, calibration: { pctPer100Rows: 4, window: '5-hour' } }),
    'estimate: 20 rows in 1 call; 38,020 input and 1,500 output tokens; about $0.09 API-equivalent at Claude Sonnet 5.5 base rates, no cache discount; not published (a five-hour and a weekly limit exist); read your share in /usage; your own measurement: about 0.8% of your 5-hour window',
  );
});
