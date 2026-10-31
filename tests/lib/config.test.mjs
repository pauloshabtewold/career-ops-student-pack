import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
