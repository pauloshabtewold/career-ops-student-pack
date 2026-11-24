// M-007 fix round 14: automation Chrome launched under a HOME with no login keychain (live tests and e2e use a temp
// HOME) gets --use-mock-keychain and --password-store=basic, so macOS shows no "A keychain cannot be found to store
// Chrome Safe Storage" popup. A HOME whose Library/Keychains exists keeps the normal keychain, and other platforms never
// get the flags. Pure launchArgs checks plus one open through injected fakes; no Chrome starts. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchArgs, main } from '../../scripts/chrome.mjs';
import { makeRoot } from '../helpers/script-harness.mjs';

const PROFILE = '/fake/data/chrome-automation';
const TEMP_HOME = '/fake/tmp-home';
const MOCK = ['--use-mock-keychain', '--password-store=basic'];
const keychainAt = (present) => (p) => present && p === join(TEMP_HOME, 'Library', 'Keychains');
const mockFlags = (args) => args.filter((a) => MOCK.includes(a));

test('F14-1 darwin with no Library/Keychains under HOME adds both mock keychain flags', () => {
  const args = launchArgs(PROFILE, { platform: 'darwin', env: { HOME: TEMP_HOME }, keychainExists: keychainAt(false) });
  assert.deepEqual(mockFlags(args), MOCK);
});

test('F14-2 darwin with Library/Keychains under HOME adds neither flag', () => {
  const args = launchArgs(PROFILE, { platform: 'darwin', env: { HOME: TEMP_HOME }, keychainExists: keychainAt(true) });
  assert.deepEqual(mockFlags(args), []);
});

test('F14-3 linux and win32 never get the flags, keychain dir or not', () => {
  for (const platform of ['linux', 'win32']) {
    const args = launchArgs(PROFILE, { platform, env: { HOME: TEMP_HOME }, keychainExists: keychainAt(false) });
    assert.deepEqual(mockFlags(args), [], platform);
  }
});

test('F14-4 the headless flag is unaffected by the keychain rule', () => {
  for (const present of [true, false]) {
    for (const headless of [true, false]) {
      const args = launchArgs(PROFILE, { headless, platform: 'darwin', env: { HOME: TEMP_HOME }, keychainExists: keychainAt(present) });
      assert.equal(args.includes('--headless=new'), headless, `headless ${headless} keychain ${present}`);
      assert.ok(args.includes(`--user-data-dir=${PROFILE}`));
      assert.ok(args.includes('--remote-debugging-address=127.0.0.1'));
    }
  }
});

test('F14-5 open passes the caller env HOME and platform to the keychain rule', async () => {
  const r = makeRoot();
  try {
    const seen = [];
    const spawn = (bin, args) => {
      seen.push(args);
      const profile = args.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
      writeFileSync(join(profile, 'DevToolsActivePort'), '45555\n/devtools/browser/fake\n');
      return { pid: 424242, unref() {} };
    };
    const deps = { env: { HOME: TEMP_HOME }, platform: 'darwin', keychainExists: keychainAt(false), say: () => {}, findChrome: () => '/fake/chrome', spawn, isAlive: (p) => p === 424242, fetchFn: async () => ({ ok: true }) };
    const code = await main(['open', '--headless', '--root', r.root, '--data-dir', r.data], deps);
    assert.equal(code, 0);
    assert.equal(seen.length, 1);
    assert.deepEqual(mockFlags(seen[0]), MOCK);
    assert.ok(seen[0].includes('--headless=new'));
  } finally {
    r.cleanup();
  }
});
