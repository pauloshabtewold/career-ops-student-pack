// scripts/chrome.mjs open and close against injected fakes: spawn, kill, process liveness, fetch and the clock are all
// fakes, so no Chrome or other browser starts and no real process is signalled.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PORT_WAIT_MS, main, readState, runSlotCommand, writeState } from '../../scripts/chrome.mjs';
import { makeRoot } from '../helpers/script-harness.mjs';

const FAKE_PID = 424242;
const FAKE_PORT = 45555;
const ok = async () => ({ ok: true });
const refused = async () => {
  throw new Error('fake connection refused');
};

function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, wait: async (ms) => void (t += Math.max(ms ?? 0, 1)) };
}

// A fake Chrome process: alive until it has received `diesOn` (or never when diesOn is null).
function fakeProcess({ diesOn = 'SIGTERM', pollsBeforeExit = 0 } = {}) {
  const signals = [];
  let polls = null;
  return {
    signals,
    kill: (pid, sig) => {
      assert.equal(pid, FAKE_PID, 'only the recorded PID is signalled');
      signals.push(sig);
      if (sig === diesOn || (diesOn === 'SIGTERM' && sig === 'SIGKILL')) polls ??= pollsBeforeExit;
    },
    isAlive: (pid) => {
      if (pid !== FAKE_PID) return false;
      if (polls === null) return true;
      if (polls > 0) {
        polls -= 1;
        return true;
      }
      return false;
    },
  };
}

async function run(argv, r, deps) {
  const lines = [];
  const code = await main([...argv, '--root', r.root, '--data-dir', r.data], { env: {}, say: (l) => lines.push(l), ...deps });
  return { code, out: lines.join('\n') };
}

test('S1 open stops the Chrome it spawned when no DevTools port appears and exits 7', async () => {
  const r = makeRoot();
  try {
    const proc = fakeProcess();
    let spawned = 0;
    const spawn = () => {
      spawned += 1;
      return { pid: FAKE_PID, unref() {} };
    };
    const { code, out } = await run(['open'], r, { findChrome: () => '/fake/chrome', spawn, ...proc, ...fakeClock(), fetchFn: refused });
    assert.equal(code, 7, out);
    assert.equal(spawned, 1);
    assert.deepEqual(proc.signals, ['SIGTERM']);
    assert.ok(out.includes(`stopped it (PID ${FAKE_PID})`), out);
    assert.equal(readState(r.data), null, 'no state file for a Chrome that never opened a port');
  } finally {
    r.cleanup();
  }
});

test('S2 open refuses a profile held by an unrecorded Chrome whose DevTools port answers, naming the profile', async () => {
  const r = makeRoot();
  try {
    const profile = join(r.data, 'chrome-automation');
    mkdirSync(profile, { recursive: true });
    writeFileSync(join(profile, 'DevToolsActivePort'), `${FAKE_PORT}\n/devtools/browser/fake\n`);
    let spawned = 0;
    const { code, out } = await run(['open'], r, { findChrome: () => '/fake/chrome', spawn: () => (spawned += 1), fetchFn: ok });
    assert.equal(code, 7, out);
    assert.equal(spawned, 0, 'nothing launched on a held profile');
    assert.ok(out.includes(profile), out);
    assert.ok(existsSync(join(profile, 'DevToolsActivePort')), 'the live instance keeps its port file');
  } finally {
    r.cleanup();
  }
});

test('S2 open refuses a profile whose SingletonLock names a live PID', { skip: process.platform === 'win32' && 'no SingletonLock on Windows' }, async () => {
  const r = makeRoot();
  try {
    const profile = join(r.data, 'chrome-automation');
    mkdirSync(profile, { recursive: true });
    symlinkSync(`fake-host-${FAKE_PID}`, join(profile, 'SingletonLock'));
    let spawned = 0;
    const { code, out } = await run(['open'], r, { findChrome: () => '/fake/chrome', spawn: () => (spawned += 1), isAlive: (p) => p === FAKE_PID, fetchFn: refused });
    assert.equal(code, 7, out);
    assert.equal(spawned, 0);
    assert.ok(out.includes(profile), out);
  } finally {
    r.cleanup();
  }
});

test('S2 two opens at once launch one Chrome; the second reuses the first one', async () => {
  const r = makeRoot();
  try {
    let spawned = 0;
    const spawn = (bin, args) => {
      spawned += 1;
      const profile = args.find((a) => a.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
      writeFileSync(join(profile, 'DevToolsActivePort'), `${FAKE_PORT}\n/devtools/browser/fake\n`);
      return { pid: FAKE_PID, unref() {} };
    };
    const deps = { findChrome: () => '/fake/chrome', spawn, isAlive: (p) => p === FAKE_PID, fetchFn: ok };
    const [a, b] = await Promise.all([run(['open'], r, deps), run(['open'], r, deps)]);
    assert.equal(a.code, 0, a.out);
    assert.equal(b.code, 0, b.out);
    assert.equal(spawned, 1, 'only one launch');
    assert.equal(readState(r.data).pid, FAKE_PID);
    assert.equal(existsSync(join(r.data, '.chrome-automation.lock')), false, 'lock released');
  } finally {
    r.cleanup();
  }
});

test('close waits for the recorded Chrome to exit before removing the state file', async () => {
  const r = makeRoot();
  try {
    writeState(r.data, { pid: FAKE_PID, port: FAKE_PORT });
    const proc = fakeProcess({ pollsBeforeExit: 5 });
    let stateWhenGone = null;
    const isAlive = (pid) => {
      const alive = proc.isAlive(pid);
      if (!alive && proc.signals.length) stateWhenGone ??= existsSync(join(r.data, '.chrome-automation'));
      return alive;
    };
    const { code, out } = await run(['close'], r, { kill: proc.kill, isAlive, ...fakeClock(), fetchFn: ok });
    assert.equal(code, 0, out);
    assert.deepEqual(proc.signals, ['SIGTERM']);
    assert.equal(stateWhenGone, true, 'state file still present when the PID was seen gone');
    assert.equal(readState(r.data), null, 'state removed after exit');
  } finally {
    r.cleanup();
  }
});

test('close sends SIGKILL when the recorded Chrome ignores SIGTERM for the exit wait', async () => {
  const r = makeRoot();
  try {
    writeState(r.data, { pid: FAKE_PID, port: FAKE_PORT });
    const proc = fakeProcess({ diesOn: 'SIGKILL' });
    // platform pinned: on win32 the fallback is taskkill /T (tests/scripts/chrome-close-win.test.mjs)
    const { code, out } = await run(['close'], r, { ...proc, ...fakeClock(), fetchFn: ok, platform: 'darwin' });
    assert.equal(code, 0, out);
    assert.deepEqual(proc.signals, ['SIGTERM', 'SIGKILL']);
    assert.equal(readState(r.data), null);
  } finally {
    r.cleanup();
  }
});

test('close keeps the state file and exits 1 when the recorded Chrome never exits', async () => {
  const r = makeRoot();
  try {
    writeState(r.data, { pid: FAKE_PID, port: FAKE_PORT });
    const proc = fakeProcess({ diesOn: null });
    const { code, out } = await run(['close'], r, { ...proc, ...fakeClock(), fetchFn: ok });
    assert.equal(code, 1, out);
    assert.equal(readState(r.data).pid, FAKE_PID, 'state kept so a later close can still stop it');
  } finally {
    r.cleanup();
  }
});

test('S2 close stops a recorded Chrome whose port is silent when the profile SingletonLock names its PID', { skip: process.platform === 'win32' && 'no SingletonLock on Windows' }, async () => {
  const r = makeRoot();
  try {
    const profile = join(r.data, 'chrome-automation');
    mkdirSync(profile, { recursive: true });
    symlinkSync(`fake-host-${FAKE_PID}`, join(profile, 'SingletonLock'));
    writeState(r.data, { pid: FAKE_PID, port: FAKE_PORT, profile });
    const proc = fakeProcess();
    const { code, out } = await run(['close'], r, { ...proc, ...fakeClock(), fetchFn: refused });
    assert.equal(code, 0, out);
    assert.deepEqual(proc.signals, ['SIGTERM']);
    assert.equal(readState(r.data), null);
  } finally {
    r.cleanup();
  }
});

test('N1 a slot command that cannot start reports its spawn error code', () => {
  assert.equal(runSlotCommand('missing-slot-cmd', { run: () => ({ error: Object.assign(new Error('x'), { code: 'ENOENT' }) }) }), 'ENOENT');
  assert.equal(runSlotCommand('slot', { run: () => ({ status: 3 }) }), 3);
});

test('open waits 45 seconds for the DevTools port by default and says so; deps.portWaitMs overrides it', async () => {
  assert.equal(PORT_WAIT_MS, 45 * 1000);
  for (const [portWaitMs, seconds] of [[undefined, 45], [5000, 5]]) {
    const r = makeRoot();
    try {
      const clock = fakeClock();
      const start = clock.now();
      const deps = { findChrome: () => '/fake/chrome', spawn: () => ({ pid: FAKE_PID, unref() {} }), ...fakeProcess(), ...clock, fetchFn: refused };
      if (portWaitMs) deps.portWaitMs = portWaitMs;
      const { code, out } = await run(['open'], r, deps);
      assert.equal(code, 7, out);
      assert.ok(out.includes(`within ${seconds} seconds`), out);
      assert.ok(clock.now() - start >= seconds * 1000, 'waited the full port wait');
    } finally {
      r.cleanup();
    }
  }
});
