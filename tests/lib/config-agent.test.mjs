import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadStudentConfig, ConfigError } from '../../lib/config.mjs';

async function load(yml) {
  const root = mkdtempSync(join(tmpdir(), 'pack-cfg-agent-'));
  try {
    mkdirSync(join(root, 'config'));
    writeFileSync(join(root, 'config', 'student.yml'), yml);
    return await loadStudentConfig({ root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// M-002-S1
test('M-002-S1 agent codex loads as codex, claude loads as claude, and an absent key loads as claude', async () => {
  assert.equal((await load('agent: codex\n')).agent, 'codex');
  assert.equal((await load('agent: claude\n')).agent, 'claude');
  assert.equal((await load('daily_target: 20\n')).agent, 'claude');
  assert.equal((await load('')).agent, 'claude');
});

// M-002-S2
test('M-002-S2 agent gemini throws a ConfigError whose path is agent', async () => {
  // Positive control: the base schema rejects any agent key, so the rejection alone proves nothing.
  assert.equal((await load('agent: codex\n')).agent, 'codex');
  await assert.rejects(
    load('agent: gemini\n'),
    (e) => e instanceof ConfigError && e.path === 'agent',
  );
});
