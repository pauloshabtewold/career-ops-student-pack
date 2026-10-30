// M-001-S9 keep: the literal values and tighten directions of every CEILINGS key except triage_daily, taken from base a698221.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { CEILINGS } from '../../scripts/budget.mjs';
import { PACK_ROOT } from '../helpers/budget-harness.mjs';

const SNAPSHOT = {
  connect_per_day: {value:20,tighten:'down'},
  connect_per_rolling_7d: {value:100,tighten:'down'},
  pending_invites_max: {value:200,tighten:'down'},
  message_per_day: {value:10,tighten:'down'},
  profile_view_per_day: {value:60,tighten:'down'},
  search_page_per_session: {value:8,tighten:'down'},
  gap_min_s: {value:45,tighten:'up'},
  gap_max_s: {value:120,tighten:'down'},
  window_start: {value:"08:00",tighten:'up'},
  window_end: {value:"22:00",tighten:'down'},
  contacts_per_company: {value:3,tighten:'down'},
  nudge_per_target: {value:1,tighten:'down'},
  nudge_min_days: {value:5,tighten:'up'},
  notes_free_per_rolling_7d: {value:2,tighten:'down'},
  note_len_free: {value:200,tighten:'down'},
  note_len_premium: {value:300,tighten:'down'},
  opener_len: {value:299,tighten:'down'},
  invite_withdraw_days: {value:21,tighten:'down'},
  rounds_per_day: {value:1,tighten:'down'},
  submit_per_day: {value:10,tighten:'down'},
  first_week_submit_per_session: {value:3,tighten:'down'},
  first_week_days: {value:7,tighten:'down'},
  batch_size: {value:3,tighten:'down'},
  score_floor: {value:3.5,tighten:'up'},
  per_company_per_day: {value:2,tighten:'down'},
  jd_browser_per_session: {value:10,tighten:'down'},
  tracks_per_company: {value:1,tighten:'down'},
  pages_per_search_per_session: {value:4,tighten:'down'},
  run_lock_hours: {value:12,tighten:'down'},
  apply_session_lock_hours: {value:6,tighten:'down'},
  snapshots_kept: {value:7,tighten:'down'},
  inbox_lookback_days: {value:2,tighten:'down'},
  notifications_per_run: {value:5,tighten:'down'},
  triage_audit_weekly: {value:20,tighten:'down'},
  liveness_batch: {value:50,tighten:'down'},
  triage_tier_min: {value:'standard',tighten:'up'},
  request_gap_ms: {value:1200,tighten:'up'},
  crawl_delay_cap_s: {value:5,tighten:'up'},
  backoff_ms_per_attempt: {value:3000,tighten:'up'},
  pages_per_site_search: {value:5,tighten:'down'},
  aggregator_in_flight: {value:4,tighten:'down'},
  github_discovery_period: {value:'monthly',tighten:'up'},
  github_new_trials_per_run: {value:3,tighten:'down'},
  github_min_active_per_kind: {value:2,tighten:'up'},
  github_push_window_days: {value:14,tighten:'down'},
  github_retire_days: {value:30,tighten:'down'},
  github_failed_parses: {value:3,tighten:'down'},
  never_fetch_hosts: {value:['linkedin.com'],tighten:'up'},
};

// M-001-S9
test('M-001-S9 every CEILINGS key other than triage_daily keeps its value and tighten direction', () => {
  const actual = Object.fromEntries(Object.entries(CEILINGS).filter(([k]) => k !== 'triage_daily').map(([k, e]) => [k, { value: e.value, tighten: e.tighten }]));
  assert.deepEqual(actual, SNAPSHOT);
  assert.ok('triage_tier_min' in CEILINGS);
  assert.ok('triage_audit_weekly' in CEILINGS);
});

// M-001-S10 keep
test('M-001-S10 node scripts/compat-hash.mjs --check reports that budgetSha256 matches scripts/budget.mjs', () => {
  const out = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'compat-hash.mjs'), '--check'], { cwd: PACK_ROOT, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /budgetSha256 matches scripts\/budget\.mjs/);
});
