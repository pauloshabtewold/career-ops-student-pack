// scripts/chrome.mjs CLI paths that never launch a browser: the slot gate, reuse of a live recorded instance, close on a
// stale state file and read with nothing running. A live instance is a fake DevTools HTTP server on 127.0.0.1 plus an
// idle node process this test starts and stops; no Chrome is started anywhere in this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { delimiter, dirname, join } from 'node:path';
import { readState, writeState } from '../../scripts/chrome.mjs';
import { PACK_ROOT, makeRoot } from '../helpers/script-harness.mjs';

const CHROME = join(PACK_ROOT, 'scripts', 'chrome.mjs');
const NODE_DIR = dirname(process.execPath);
const WAITING = 'chrome: waiting for a browser slot';
const NO_SLOT = 'chrome: no browser slot command set';
const CLI_TIMEOUT_MS = 30000;

// The parent environment without any slot command or CI flag, with this node first on PATH.
function cleanEnv(extra = {}) {
  const env = { ...process.env };
  delete env.BROWSER_SLOT_CMD;
  delete env.CI;
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = [NODE_DIR, env[pathKey]].filter(Boolean).join(delimiter);
  return { ...env, ...extra };
}

// Async so a fake server in this process can answer while the CLI runs.
function runChrome(args, r, { env = cleanEnv() } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CHROME, ...args, '--root', r.root, '--data-dir', r.data], { cwd: PACK_ROOT, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// A slot hook as a node script; it leaves a marker file so a test can tell it ran.
function slotScript(r, name, exitCode) {
  const marker = join(r.root, `${name}.ran`);
  const file = join(r.root, `${name}.mjs`);
  writeFileSync(file, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'ran');\nprocess.exit(${exitCode});\n`);
  return { command: `node ${file.replace(/\\/g, '/')}`, marker };
}

async function fakeDevtools() {
  const server = createServer((req, res) => {
    if (!req.url.startsWith('/json')) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const { port } = server.address();
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ Browser: 'Chrome/130.0.0.0', 'Protocol-Version': '1.3', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fake-instance` }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

async function closedPort() {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  await new Promise((r) => server.close(r));
  return port;
}

const idleProcess = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'ignore' });
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const launched = (r) => existsSync(join(r.data, '.chrome-automation')) || existsSync(join(r.data, 'chrome-automation'));

// M-001-S6-osdr
test('M-001-S6-osdr BROWSER_SLOT_CMD exiting 1 makes chrome.mjs open print the waiting line and exit 4 without launching', async () => {
  const r = makeRoot();
  try {
    const slot = slotScript(r, 'slot-busy', 1);
    const out = await runChrome(['open'], r, { env: cleanEnv({ BROWSER_SLOT_CMD: slot.command }) });
    assert.equal(out.code, 4, out.stdout + out.stderr);
    assert.ok(out.stdout.includes(`${WAITING} (hook exit 1)`), out.stdout);
    assert.equal(launched(r), false, 'no state file and no profile folder');
  } finally {
    r.cleanup();
  }
});

// M-001-S12-osdr
test('M-001-S12-osdr a slot command exiting 2 makes chrome.mjs open print the waiting line and exit 4 without launching', async () => {
  const r = makeRoot();
  try {
    const slot = slotScript(r, 'slot-unreadable', 2);
    const out = await runChrome(['open'], r, { env: cleanEnv({ BROWSER_SLOT_CMD: slot.command }) });
    assert.equal(out.code, 4, out.stdout + out.stderr);
    assert.ok(out.stdout.includes(`${WAITING} (hook exit 2)`), out.stdout);
    assert.equal(launched(r), false, 'no state file and no profile folder');
  } finally {
    r.cleanup();
  }
});

// M-001-S13-osdr
test('M-001-S13-osdr config browser.slot_cmd exiting 1 stops chrome.mjs open run with only HOME and PATH, exit 4 without launching', async () => {
  const r = makeRoot();
  try {
    const slot = slotScript(r, 'slot-config', 1);
    r.write('config/student.yml', `timezone: America/Chicago\nbrowser:\n  slot_cmd: ${JSON.stringify(slot.command)}\n`);
    const env = { HOME: r.root, PATH: [NODE_DIR, '/usr/bin', '/bin'].join(delimiter) };
    const out = await runChrome(['open'], r, { env });
    assert.equal(out.code, 4, out.stdout + out.stderr);
    assert.ok(existsSync(slot.marker), 'the configured slot command ran');
    assert.ok(out.stdout.includes(WAITING), out.stdout);
    assert.equal(launched(r), false, 'no state file and no profile folder');
  } finally {
    r.cleanup();
  }
});

// M-001-S4-osdr
test('M-001-S4-osdr chrome.mjs open with a live recorded instance reuses it and launches no second Chrome', async () => {
  const r = makeRoot();
  const devtools = await fakeDevtools();
  const idle = idleProcess();
  try {
    writeState(r.data, { port: devtools.port, pid: idle.pid });
    const slot = slotScript(r, 'slot-free', 0);
    const out = await runChrome(['open'], r, { env: cleanEnv({ BROWSER_SLOT_CMD: slot.command }) });
    assert.equal(out.code, 0, out.stdout + out.stderr);
    const state = readState(r.data);
    assert.equal(state.pid, idle.pid, 'the recorded instance is kept');
    assert.equal(state.port, devtools.port);
    assert.equal(existsSync(join(r.data, 'chrome-automation')), false, 'no profile folder from a new launch');
  } finally {
    idle.kill();
    await devtools.close();
    r.cleanup();
  }
});

// M-001-S14-osdr
test('M-001-S14-osdr with no slot command in the environment or config chrome.mjs open prints the no-slot line', async () => {
  const r = makeRoot();
  const devtools = await fakeDevtools();
  const idle = idleProcess();
  try {
    writeState(r.data, { port: devtools.port, pid: idle.pid });
    const out = await runChrome(['open'], r);
    assert.equal(out.code, 0, out.stdout + out.stderr);
    assert.ok(out.stdout.includes(NO_SLOT), out.stdout);
    assert.equal(readState(r.data).pid, idle.pid, 'the live instance is reused, nothing launched');
  } finally {
    idle.kill();
    await devtools.close();
    r.cleanup();
  }
});

// M-001-S21-osdr
test('M-001-S21-osdr chrome.mjs close with a live recorded PID whose port does not answer kills nothing and removes the state file', async () => {
  const r = makeRoot();
  const idle = idleProcess();
  try {
    writeState(r.data, { port: await closedPort(), pid: idle.pid });
    assert.ok(existsSync(join(r.data, '.chrome-automation')));
    await runChrome(['close'], r);
    assert.equal(alive(idle.pid), true, 'the recorded PID was not killed');
    assert.equal(existsSync(join(r.data, '.chrome-automation')), false, 'stale state file removed');
  } finally {
    idle.kill();
    r.cleanup();
  }
});

// M-001-S23-osdr
test('M-001-S23-osdr chrome.mjs read with no automation Chrome running exits 7 and never 5', async () => {
  const r = makeRoot();
  try {
    const out = await runChrome(['read', `http://127.0.0.1:${await closedPort()}/page`], r);
    assert.notEqual(out.code, 5, out.stdout + out.stderr);
    assert.equal(out.code, 7, out.stdout + out.stderr);
  } finally {
    r.cleanup();
  }
});
