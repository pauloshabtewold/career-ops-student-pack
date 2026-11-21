import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadStudentConfig, ConfigError } from '../../lib/config.mjs';

function rootWith(yml) {
  const root = mkdtempSync(join(tmpdir(), 'pack-cfg-'));
  if (yml !== null) {
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config', 'student.yml'), yml);
  }
  return root;
}
function deepFrozen(o) {
  if (o === null || typeof o !== 'object') return true;
  return Object.isFrozen(o) && Object.values(o).every(deepFrozen);
}

// M-001-S7
test('M-001-S7 subset merges over defaults and result is frozen', async () => {
  const root = rootWith('daily_target: 20\nswitches:\n  outreach: drafts\n');
  try {
    const cfg = await loadStudentConfig({ root });
    assert.equal(cfg.daily_target, 20);
    assert.equal(cfg.switches.outreach, 'drafts');
    assert.equal(cfg.switches.handshake, 'on');
    assert.equal(cfg.switches.submission, 'user');
    assert.equal(cfg.spend_tier, 'standard');
    assert.equal(cfg.score_floor, 3.5);
    assert.equal(cfg.linkedin_tier, 'free');
    assert.equal(cfg.automation, 'manual');
    assert.equal(cfg.onboarding.complete, false);
    assert.ok(deepFrozen(cfg));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('empty file yields pure defaults', async () => {
  const root = rootWith('');
  try {
    const cfg = await loadStudentConfig({ root });
    assert.equal(cfg.daily_target, 10);
    assert.equal(cfg.mailbox.backend, 'connector');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing file returns null', async () => {
  const root = rootWith(null);
  try {
    assert.equal(await loadStudentConfig({ root }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// M-001-S8
test('M-001-S8 enum violation throws ConfigError naming the key path', async () => {
  const root = rootWith('switches:\n  outreach: maybe\n');
  try {
    await assert.rejects(
      async () => loadStudentConfig({ root }),
      (e) => e instanceof ConfigError && e.message.includes('switches.outreach'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('unknown top-level key and economy spend tier are rejected', async () => {
  for (const [yml, key] of [['bogus_key: 1\n', 'bogus_key'], ['spend_tier: economy\n', 'spend_tier']]) {
    const root = rootWith(yml);
    try {
      await assert.rejects(
        async () => loadStudentConfig({ root }),
        (e) => e instanceof ConfigError && e.message.includes(key),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

// M-002-S15-cdel
test('M-002-S15-cdel mailbox.schedule accepts on and off', async () => {
  for (const value of ['on', 'off']) {
    const root = rootWith(`mailbox:\n  backend: connector\n  schedule: ${value}\n`);
    try {
      const cfg = await loadStudentConfig({ root });
      assert.equal(cfg.mailbox.schedule, value);
      assert.equal(cfg.mailbox.backend, 'connector');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('extra check: any other mailbox.schedule value throws ConfigError naming mailbox.schedule', async () => {
  for (const value of ['maybe', 'true', '"yes"', 'daily']) {
    const root = rootWith(`mailbox:\n  schedule: ${value}\n`);
    try {
      await assert.rejects(loadStudentConfig({ root }), (e) => e instanceof ConfigError && e.message.includes('mailbox.schedule'), value);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('extra check: the shipped defaults hold mailbox.schedule off', async () => {
  const defaults = readFileSync(fileURLToPath(new URL('../../templates/student.defaults.yml', import.meta.url)), 'utf8');
  assert.match(defaults, /^mailbox:\n(?:[ \t]+.*\n)*?[ \t]+schedule: "off"/m);
  const root = rootWith('timezone: America/Chicago\n');
  try {
    assert.equal((await loadStudentConfig({ root })).mailbox.schedule, 'off');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Every key the student config accepted before the Chrome keys, each set to a valid non-default value.
const EXISTING_KEYS_YML = `onboarding:
  complete: true
presets: [software-cs]
tracks:
  - kind: internship
    graduation: 2027-05
    resume_variant: main
experience_years: 1
us_citizen: true
timezone: America/New_York
locations: [Remote, Example City]
switches:
  outreach: drafts
  handshake: "off"
  submission: agent
automation: scheduled-discovery-plus-triage
agent: codex
spend_tier: premium
daily_target: 15
score_floor: 3.8
linkedin_tier: premium
reviewer: "on"
research_cache_days: 14
limits:
  linkedin_connects: 5
triage_budget:
  daily: 30
  first_run: all
  measured_pct_per_100_rows: 1.5
  measured_window: weekly
plan: claude-pro
resume_variants:
  - name: main
    track: software
    graduation: 2027-05
    page_limit: 1
mailbox:
  backend: paste
  schedule: "on"
schedule:
  time: "07:30"
rank:
  weights:
    fit: 2
  metros: [Example Metro]
  marquee: [Example Corp]
  parent_companies:
    Example Sub: Example Corp
  company_caps:
    Example Corp: 0
  intern_only: [Example Labs]
  one_track_per_company: true
  ignore_words: [senior]
  easy_apply_hosts: [greenhouse, example.com]
  contacts_format: status-notes
  metro_match: substring
  hold_on_pending_connect: false
dealbreakers: ["unpaid"]
judgment_keywords: [clearance]
audit:
  exclude_reasons: ["^title"]
  require_triage: true
  keyword_match: substring
  duplicate_reason: last
`;

// M-001-S20-osdr
test('M-001-S20-osdr lib/config.mjs still accepts every existing student config key and the parity fixture still matches', async () => {
  const root = rootWith(EXISTING_KEYS_YML);
  try {
    const cfg = await loadStudentConfig({ root });
    assert.equal(cfg.onboarding.complete, true);
    assert.deepEqual(cfg.presets, ['software-cs']);
    assert.deepEqual(cfg.tracks, [{ kind: 'internship', graduation: '2027-05', resume_variant: 'main' }]);
    assert.equal(cfg.experience_years, 1);
    assert.equal(cfg.us_citizen, true);
    assert.equal(cfg.timezone, 'America/New_York');
    assert.deepEqual(cfg.locations, ['Remote', 'Example City']);
    assert.deepEqual({ ...cfg.switches }, { outreach: 'drafts', handshake: 'off', submission: 'agent' });
    assert.equal(cfg.automation, 'scheduled-discovery-plus-triage');
    assert.equal(cfg.agent, 'codex');
    assert.equal(cfg.spend_tier, 'premium');
    assert.equal(cfg.daily_target, 15);
    assert.equal(cfg.score_floor, 3.8);
    assert.equal(cfg.linkedin_tier, 'premium');
    assert.equal(cfg.reviewer, 'on');
    assert.equal(cfg.research_cache_days, 14);
    assert.equal(cfg.limits.linkedin_connects, 5);
    assert.deepEqual({ ...cfg.triage_budget }, { daily: 30, first_run: 'all', measured_pct_per_100_rows: 1.5, measured_window: 'weekly' });
    assert.equal(cfg.plan, 'claude-pro');
    assert.equal(cfg.resume_variants[0].page_limit, 1);
    assert.deepEqual({ ...cfg.mailbox }, { backend: 'paste', schedule: 'on' });
    assert.equal(cfg.schedule.time, '07:30');
    assert.equal(cfg.rank.weights.fit, 2);
    assert.equal(cfg.rank.parent_companies['Example Sub'], 'Example Corp');
    assert.equal(cfg.rank.company_caps['Example Corp'], 0);
    assert.equal(cfg.rank.one_track_per_company, true);
    assert.deepEqual([...cfg.rank.easy_apply_hosts], ['greenhouse', 'example.com']);
    assert.equal(cfg.rank.contacts_format, 'status-notes');
    assert.equal(cfg.rank.metro_match, 'substring');
    assert.equal(cfg.rank.hold_on_pending_connect, false);
    assert.deepEqual([...cfg.dealbreakers], ['unpaid']);
    assert.deepEqual([...cfg.judgment_keywords], ['clearance']);
    assert.deepEqual({ ...cfg.audit, exclude_reasons: [...cfg.audit.exclude_reasons] }, { exclude_reasons: ['^title'], require_triage: true, keyword_match: 'substring', duplicate_reason: 'last' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  for (const [yml, key] of [['switches:\n  outreach: maybe\n', 'switches.outreach'], ['rank:\n  metro_match: fuzzy\n', 'rank.metro_match'], ['no_such_key: 1\n', 'no_such_key']]) {
    const bad = rootWith(yml);
    try {
      await assert.rejects(loadStudentConfig({ root: bad }), (err) => err instanceof ConfigError && err.path === key);
    } finally {
      rmSync(bad, { recursive: true, force: true });
    }
  }
  const fixture = readFileSync(fileURLToPath(new URL('../fixtures/parity/student.yml', import.meta.url)), 'utf8');
  const fixtureRoot = rootWith(fixture);
  try {
    const cfg = await loadStudentConfig({ root: fixtureRoot });
    assert.ok(cfg.presets.includes('software-cs'), 'the parity fixture still loads with its presets');
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
