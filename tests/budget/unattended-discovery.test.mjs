import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CEILINGS } from '../../scripts/budget.mjs';
import { ceilingEntry } from '../helpers/budget-harness.mjs';

const get = (name) => {
  const e = ceilingEntry(CEILINGS, name);
  assert.ok(e, `CEILINGS has an entry for ${name}`);
  return e;
};

const UNATTENDED = {
  run_lock_hours: 12,
  apply_session_lock_hours: 6,
  snapshots_kept: 7,
  inbox_lookback_days: 2,
  notifications_per_run: 5,
  triage_audit_weekly: 20,
  liveness_batch: 50,
  triage_tier_min: 'standard',
};

const DISCOVERY = {
  request_gap_ms: 1200,
  crawl_delay_cap_s: 5,
  backoff_ms_per_attempt: 3000,
  pages_per_site_search: 5,
  aggregator_in_flight: 4,
  github_discovery_period: 'monthly',
  github_new_trials_per_run: 3,
  github_min_active_per_kind: 2,
  github_push_window_days: 14,
  github_retire_days: 30,
  github_failed_parses: 3,
};

// M-002-S16
test('M-002-S16 unattended ceilings equal the design values', () => {
  for (const [name, value] of Object.entries(UNATTENDED)) assert.deepEqual(get(name).value, value, name);
});

test('M-002-S16 discovery ceilings equal the design values', () => {
  for (const [name, value] of Object.entries(DISCOVERY)) assert.deepEqual(get(name).value, value, name);
  assert.deepEqual(get('never_fetch_hosts').value, ['linkedin.com']);
});

test('M-002-S16 every entry carries a tighten direction of down or up', () => {
  for (const [name, entry] of Object.entries(CEILINGS)) {
    assert.ok(['down', 'up'].includes(entry.tighten), `${name} tighten`);
    assert.ok('value' in entry, `${name} value`);
  }
});

test('M-002-S16 minimum-style ceilings tighten upward', () => {
  for (const name of ['request_gap_ms', 'crawl_delay_cap_s', 'backoff_ms_per_attempt', 'github_min_active_per_kind', 'gap_min_s', 'nudge_min_days', 'score_floor', 'window_start']) {
    assert.equal(get(name).tighten, 'up', name);
  }
});

test('M-002-S16 maximum-style counts tighten downward', () => {
  for (const name of ['connect_per_day', 'connect_per_rolling_7d', 'pending_invites_max', 'message_per_day', 'profile_view_per_day', 'search_page_per_session', 'gap_max_s', 'window_end', 'contacts_per_company', 'submit_per_day', 'batch_size', 'per_company_per_day', 'jd_browser_per_session', 'pages_per_search_per_session', 'pages_per_site_search', 'aggregator_in_flight', 'notifications_per_run']) {
    assert.equal(get(name).tighten, 'down', name);
  }
});

test('M-002-S16 LinkedIn and application ceilings equal the design values', () => {
  const expected = {
    connect_per_day: 20,
    connect_per_rolling_7d: 100,
    pending_invites_max: 200,
    message_per_day: 10,
    profile_view_per_day: 60,
    search_page_per_session: 8,
    gap_min_s: 45,
    gap_max_s: 120,
    window_start: '08:00',
    window_end: '22:00',
    contacts_per_company: 3,
    nudge_per_target: 1,
    nudge_min_days: 5,
    notes_free_per_rolling_7d: 2,
    note_len_free: 200,
    note_len_premium: 300,
    opener_len: 299,
    invite_withdraw_days: 21,
    rounds_per_day: 1,
    submit_per_day: 10,
    first_week_submit_per_session: 3,
    first_week_days: 7,
    batch_size: 3,
    score_floor: 3.5,
    per_company_per_day: 2,
    jd_browser_per_session: 10,
    tracks_per_company: 1,
    pages_per_search_per_session: 4,
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(get(name).value, value, name);
});

test('M-002-S16 the table is frozen', () => {
  assert.ok(Object.isFrozen(CEILINGS));
  assert.throws(() => {
    CEILINGS.connect_per_day = { value: 999, unit: 'count', tighten: 'down' };
  }, TypeError);
  assert.throws(() => {
    get('connect_per_day').value = 999;
  }, TypeError);
  assert.equal(get('connect_per_day').value, 20);
});
