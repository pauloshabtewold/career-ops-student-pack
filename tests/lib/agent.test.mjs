// Assumed: lib/agent.mjs exports AGENTS, CODEX_DISABLED_FEATURES, CODEX_EXTRA_FLAGS, AGENT_TIMEOUT_MS, signInHint,
// knownLocations(agent, { platform, home }), resolveAgentPath(agent, { env, platform, home, exists }), shellForm and
// quoteIf. resolveAgentPath = which(agent) ?? first existing known location ?? null. Real files in scratch directories
// stand in for a PATH install; exists is injected for the ChatGPT.app bundle paths.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { AGENTS, AGENT_TIMEOUT_MS, CODEX_DISABLED_FEATURES, CODEX_EXTRA_FLAGS, knownLocations, quoteIf, resolveAgentPath, shellForm, signInHint } from '../../lib/agent.mjs';

const BUNDLE = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const HOME = '/Users/sample';
const HOME_BUNDLE = join(HOME, 'Applications', 'ChatGPT.app', 'Contents', 'Resources', 'codex-cli', 'bin', 'codex');

function scratchBin({ codex = true } = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'agent-bin-'));
  const bin = join(tmp, 'bin');
  mkdirSync(bin);
  if (codex) {
    writeFileSync(join(bin, 'codex'), '#!/usr/bin/env node\nprocess.exit(0);\n');
    chmodSync(join(bin, 'codex'), 0o755);
    writeFileSync(join(bin, 'codex.cmd'), '@echo off\r\nexit /b 0\r\n');
  }
  return { bin, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}
const envOf = (bin) => ({ PATH: bin, PATHEXT: '.COM;.EXE;.BAT;.CMD' });

// M-002-S11
test('M-002-S11 resolveAgentPath returns the PATH match first even when the ChatGPT.app path exists', () => {
  const s = scratchBin();
  try {
    const hit = resolveAgentPath('codex', { env: envOf(s.bin), platform: process.platform, home: HOME, exists: () => true });
    assert.equal(dirname(hit), s.bin);
    assert.match(basename(hit).toLowerCase(), /^codex(\.cmd)?$/);
  } finally {
    s.cleanup();
  }
});

// M-002-S11
test('M-002-S11 on darwin without a PATH match it returns the /Applications bundle path, then the home bundle path, else null', () => {
  const s = scratchBin({ codex: false });
  try {
    const base = { env: envOf(s.bin), platform: 'darwin', home: HOME };
    assert.equal(resolveAgentPath('codex', { ...base, exists: (p) => p === BUNDLE || p === HOME_BUNDLE }), BUNDLE);
    assert.equal(resolveAgentPath('codex', { ...base, exists: (p) => p === HOME_BUNDLE }), HOME_BUNDLE);
    assert.equal(resolveAgentPath('codex', { ...base, exists: () => false }), null);
  } finally {
    s.cleanup();
  }
});

// M-002-S11
test('M-002-S11 on win32 and linux the ChatGPT.app paths are never used, even when they "exist"', () => {
  const s = scratchBin({ codex: false });
  try {
    for (const platform of ['win32', 'linux']) {
      assert.equal(resolveAgentPath('codex', { env: envOf(s.bin), platform, home: HOME, exists: () => true }), null, platform);
    }
    assert.equal(resolveAgentPath('claude', { env: envOf(s.bin), platform: 'darwin', home: HOME, exists: () => true }), null);
  } finally {
    s.cleanup();
  }
});

// M-002-S11
test('M-002-S11 knownLocations lists the two codex bundle paths on darwin and nothing elsewhere', () => {
  assert.deepEqual(knownLocations('codex', { platform: 'darwin', home: HOME }), [BUNDLE, HOME_BUNDLE]);
  assert.deepEqual(knownLocations('codex', { platform: 'win32', home: HOME }), []);
  assert.deepEqual(knownLocations('codex', { platform: 'linux', home: HOME }), []);
  assert.deepEqual(knownLocations('claude', { platform: 'darwin', home: HOME }), []);
});

// M-002-S4, M-002-S21
test('M-002-S4 the exported constants match the Codex call contract', () => {
  assert.deepEqual([...AGENTS], ['claude', 'codex']);
  assert.deepEqual([...CODEX_DISABLED_FEATURES], ['apps', 'plugins', 'browser_use', 'in_app_browser', 'computer_use', 'shell_tool', 'hooks']);
  assert.deepEqual([...CODEX_EXTRA_FLAGS], ['--ignore-user-config', '-c', 'web_search=disabled']);
  assert.equal(AGENT_TIMEOUT_MS, 15 * 60 * 1000);
});

// M-002-S6
test('M-002-S6 signInHint names the agent to run once in a terminal', () => {
  assert.equal(signInHint('claude'), 'run claude once in a terminal to sign in');
  assert.equal(signInHint('codex'), 'run codex once in a terminal to sign in');
});

// M-002-S9
test('M-002-S9 shellForm is true only for a .cmd or .bat path on win32 and quoteIf quotes only in shell form', () => {
  assert.equal(shellForm('C:\\npm\\codex.cmd', 'win32'), true);
  assert.equal(shellForm('C:\\npm\\codex.bat', 'win32'), true);
  assert.equal(shellForm('C:\\npm\\codex.exe', 'win32'), false);
  assert.equal(shellForm('/opt/sample/bin/codex.cmd', 'darwin'), false);
  assert.equal(quoteIf(true, 'C:\\Sample Student\\codex.cmd'), '"C:\\Sample Student\\codex.cmd"');
  assert.equal(quoteIf(false, '/opt/sample bin/codex'), '/opt/sample bin/codex');
});
