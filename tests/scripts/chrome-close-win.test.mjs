// close on Windows: after the exit wait runs out, the whole Chrome process tree is ended with taskkill /T, because
// process.kill leaves the children that hold the profile files open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopChrome } from '../../scripts/chrome.mjs';

function fakeClock() {
  let t = 0;
  return { now: () => t, wait: async (ms) => { t += ms; } };
}

test('stopChrome on win32 ends the process tree with taskkill /T /F after the exit wait', async () => {
  const calls = [];
  let alive = true;
  const ok = await stopChrome(4242, {
    ...fakeClock(),
    platform: 'win32',
    kill: () => {},
    isAlive: () => alive,
    run: (cmd, args) => { calls.push([cmd, ...args]); alive = false; return { status: 0 }; },
  });
  assert.equal(ok, true);
  assert.deepEqual(calls, [['taskkill', '/PID', '4242', '/T', '/F']]);
});

test('stopChrome off Windows never runs taskkill', async () => {
  const signals = [];
  let alive = true;
  const ok = await stopChrome(4242, {
    ...fakeClock(),
    platform: 'darwin',
    kill: (_pid, sig) => { signals.push(sig); if (sig === 'SIGKILL') alive = false; },
    isAlive: () => alive,
    run: () => assert.fail('taskkill must not run'),
  });
  assert.equal(ok, true);
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
});
