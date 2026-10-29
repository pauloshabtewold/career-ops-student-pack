import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStudentConfig, ConfigError } from '../../lib/config.mjs';

function rootWith(yml) {
  const root = mkdtempSync(join(tmpdir(), 'pack-pknobs-'));
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), yml);
  return root;
}
async function load(yml) {
  const root = rootWith(yml);
  try {
    return await loadStudentConfig({ root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
async function rejectsAt(yml, path) {
  await assert.rejects(
    () => load(yml),
    (e) => {
      assert.ok(e instanceof ConfigError);
      assert.equal(e.path, path);
      return true;
    },
  );
}

// M-001-S1
test('M-001-S1 empty student.yml loads the parsing knob defaults', async () => {
  const cfg = await load('');
  assert.equal(cfg.audit.duplicate_reason, 'first');
  assert.deepEqual([...cfg.rank.easy_apply_hosts], ['greenhouse', 'ashby', 'lever']);
  assert.equal(cfg.rank.contacts_format, 'stage');
  assert.equal(cfg.rank.metro_match, 'word');
  assert.equal(cfg.rank.hold_on_pending_connect, true);
});

// M-001-S2
test('M-001-S2 configured parsing knobs load exactly', async () => {
  const cfg = await load(
    [
      'audit:',
      '  duplicate_reason: last',
      'rank:',
      '  contacts_format: status-notes',
      '  metro_match: substring',
      '  hold_on_pending_connect: false',
      '  easy_apply_hosts:',
      '    - workday',
      '  weights:',
      '    effort: 2',
      '',
    ].join('\n'),
  );
  assert.equal(cfg.audit.duplicate_reason, 'last');
  assert.equal(cfg.rank.contacts_format, 'status-notes');
  assert.equal(cfg.rank.metro_match, 'substring');
  assert.equal(cfg.rank.hold_on_pending_connect, false);
  assert.deepEqual([...cfg.rank.easy_apply_hosts], ['workday']);
  assert.equal(cfg.rank.weights.effort, 2);
});

// M-001-S3
test('M-001-S3 duplicate_reason middle throws at audit.duplicate_reason', async () => {
  await rejectsAt('audit:\n  duplicate_reason: middle\n', 'audit.duplicate_reason');
});

// M-001-S4
test('M-001-S4 contacts_format csv throws at rank.contacts_format', async () => {
  await rejectsAt('rank:\n  contacts_format: csv\n', 'rank.contacts_format');
});

// M-001-S4
test('M-001-S4 metro_match fuzzy throws at rank.metro_match', async () => {
  await rejectsAt('rank:\n  metro_match: fuzzy\n', 'rank.metro_match');
});

// M-001-S5
test('M-001-S5 hold_on_pending_connect given the string no throws at rank.hold_on_pending_connect', async () => {
  await rejectsAt('rank:\n  hold_on_pending_connect: "no"\n', 'rank.hold_on_pending_connect');
});

// M-001-S5
test('M-001-S5 easy_apply_hosts entry jobs/x throws at rank.easy_apply_hosts[0]', async () => {
  await rejectsAt('rank:\n  easy_apply_hosts:\n    - jobs/x\n', 'rank.easy_apply_hosts[0]');
});
