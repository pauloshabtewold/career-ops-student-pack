import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStudentConfig, ConfigError } from '../../lib/config.mjs';

function rootWith(yml) {
  const root = mkdtempSync(join(tmpdir(), 'pack-knobs-'));
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), yml);
  return root;
}
function deepFrozen(o) {
  if (o === null || typeof o !== 'object') return true;
  return Object.isFrozen(o) && Object.values(o).every(deepFrozen);
}
async function load(yml) {
  const root = rootWith(yml);
  try {
    return await loadStudentConfig({ root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
async function rejectsWith(yml, path, message) {
  await assert.rejects(
    () => load(yml),
    (e) => {
      assert.ok(e instanceof ConfigError);
      if (path !== undefined) assert.equal(e.path, path);
      if (message !== undefined) assert.match(e.message, message);
      return true;
    },
  );
}

// M-001-S1
// M-001-S8 keep: these knob tests stay green alongside the parsing knobs.
test('M-001-S1 empty student.yml loads audit and rank knob defaults', async () => {
  const cfg = await load('');
  assert.deepEqual([...cfg.audit.exclude_reasons], []);
  assert.equal(cfg.audit.require_triage, false);
  assert.equal(cfg.audit.keyword_match, 'word');
  assert.deepEqual({ ...cfg.rank.company_caps }, {});
  assert.deepEqual([...cfg.rank.intern_only], []);
  assert.equal(cfg.rank.one_track_per_company, false);
  assert.deepEqual([...cfg.rank.ignore_words], []);
});

// M-001-S2
test('M-001-S2 full valid knob set loads exactly and is deep-frozen', async () => {
  const cfg = await load(
    [
      'audit:',
      '  exclude_reasons:',
      '    - "^visa"',
      '    - "relocat(e|ion)"',
      '  require_triage: true',
      '  keyword_match: substring',
      'rank:',
      '  company_caps:',
      '    Acme: 3',
      '  intern_only:',
      '    - Globex',
      '  one_track_per_company: true',
      '  ignore_words:',
      '    - international',
      '',
    ].join('\n'),
  );
  assert.deepEqual([...cfg.audit.exclude_reasons], ['^visa', 'relocat(e|ion)']);
  assert.equal(cfg.audit.require_triage, true);
  assert.equal(cfg.audit.keyword_match, 'substring');
  assert.deepEqual({ ...cfg.rank.company_caps }, { Acme: 3 });
  assert.deepEqual([...cfg.rank.intern_only], ['Globex']);
  assert.equal(cfg.rank.one_track_per_company, true);
  assert.deepEqual([...cfg.rank.ignore_words], ['international']);
  assert.ok(deepFrozen(cfg));
});

// M-001-S3
test('M-001-S3 keyword_match fuzzy throws ConfigError at audit.keyword_match', async () => {
  await rejectsWith('audit:\n  keyword_match: fuzzy\n', 'audit.keyword_match');
});

// M-001-S4
test('M-001-S4 uncompilable exclude_reasons pattern throws at audit.exclude_reasons[0]', async () => {
  await rejectsWith('audit:\n  exclude_reasons:\n    - "(unclosed"\n', 'audit.exclude_reasons[0]');
});

// M-001-S5
test('M-001-S5 negative company cap throws at rank.company_caps.Acme', async () => {
  await rejectsWith('rank:\n  company_caps:\n    Acme: -1\n', 'rank.company_caps.Acme');
});

test('M-001-S5 fractional company cap throws at rank.company_caps.Acme', async () => {
  await rejectsWith('rank:\n  company_caps:\n    Acme: 1.5\n', 'rank.company_caps.Acme');
});

// M-001-S6
test('M-001-S6 unknown audit key throws ConfigError unknown key', async () => {
  await rejectsWith('audit:\n  foo: 1\n', undefined, /unknown key/);
});

// M-001-S7
test('M-001-S7 multi-word ignore word throws at rank.ignore_words[0]', async () => {
  await rejectsWith('rank:\n  ignore_words:\n    - two words\n', 'rank.ignore_words[0]');
});

// M-001-S9
test('M-001-S9 keep: student.yml without audit or rank block keeps pre-existing values', async () => {
  const cfg = await load('daily_target: 20\nswitches:\n  outreach: drafts\n');
  assert.equal(cfg.daily_target, 20);
  assert.equal(cfg.switches.outreach, 'drafts');
  assert.equal(cfg.switches.handshake, 'on');
  assert.equal(cfg.switches.submission, 'agent');
  assert.equal(cfg.spend_tier, 'standard');
  assert.equal(cfg.score_floor, 3.5);
  assert.equal(cfg.linkedin_tier, 'free');
  assert.equal(cfg.automation, 'manual');
  assert.equal(cfg.onboarding.complete, false);
  assert.ok(deepFrozen(cfg));
});
