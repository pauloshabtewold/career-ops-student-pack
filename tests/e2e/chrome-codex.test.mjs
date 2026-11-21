// Codex reach: Codex, found the way the pack finds it, runs chrome.mjs read on the mock ATS form and its output holds the
// form text. Skips name the missing piece: the codex binary, CAREER_OPS_AGENT_E2E, or a browser slot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { AGENT_TIMEOUT_MS, resolveAgentPath } from '../../lib/agent.mjs';
import { gate, openChrome, stopAll } from '../helpers/chrome-harness.mjs';
import { PACK_ROOT, makeRoot } from '../helpers/script-harness.mjs';

function runCodex(codex, prompt) {
  return new Promise((resolve) => {
    const child = spawn(codex, ['exec', '--skip-git-repo-check', '--sandbox', 'danger-full-access', prompt], { cwd: PACK_ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), AGENT_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// M-001-S16-osdr
test('M-001-S16-osdr [e2e] Codex reads a page through chrome.mjs', async (t) => {
  const codex = resolveAgentPath('codex');
  if (!codex) return t.skip('codex binary not resolved by resolveAgentPath');
  if (process.env.CAREER_OPS_AGENT_E2E !== '1') return t.skip('CAREER_OPS_AGENT_E2E is unset');
  const reason = await gate();
  if (reason) return t.skip(reason);

  const r = makeRoot();
  // Ships with M-002, so it loads only once every skip above has passed.
  const { startMockAts } = await import('../helpers/mock-ats-server.mjs');
  const ats = await startMockAts();
  try {
    const open = await openChrome({ root: r.root, dataDir: r.data });
    if (open.skip) return t.skip(open.skip);
    assert.equal(open.code, 0, open.stdout + open.stderr);

    const command = `node scripts/chrome.mjs read ${ats.url} --root ${r.root} --data-dir ${r.data}`;
    const out = await runCodex(codex, `Run this exact shell command from the current folder and print its full output unchanged:\n${command}`);
    const firstLine = String(ats.formText).split('\n').map((l) => l.trim()).find(Boolean);
    assert.ok(firstLine, 'mock form text is not empty');
    assert.ok(out.stdout.includes(firstLine), out.stdout + out.stderr);
  } finally {
    await stopAll({ root: r.root, dataDir: r.data });
    await ats.close();
    r.cleanup();
  }
});
