// Chrome spike e2e: the automation profile opens, reads a local page and closes, and a launchd-like minimal environment
// still reaches it. Every Chrome test asks tests/helpers/chrome-harness.mjs first and skips without a browser slot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT_ENV, alive, gate, openChrome, runChromeCli, stopAll } from '../helpers/chrome-harness.mjs';
import { PACK_ROOT, makeRoot } from '../helpers/script-harness.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const WAIT_BOUND_MS = 15000;
const POLL_MS = 100;

async function pagesServer(text) {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html><head><title>spike</title></head><body><p>${text}</p></body></html>`);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/spike`, close: () => new Promise((r) => server.close(r)) };
}

async function waitFor(condition, what) {
  const deadline = Date.now() + WAIT_BOUND_MS;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  assert.fail(`timed out waiting for ${what}`);
}

// M-001-S1-osdr
test('M-001-S1-osdr [e2e] chrome.mjs opens the automation profile', async (t) => {
  const reason = await gate();
  if (reason) return t.skip(reason);
  const r = makeRoot();
  const text = `Spike page ${randomBytes(6).toString('hex')}`;
  const page = await pagesServer(text);
  try {
    const open = await openChrome({ root: r.root, dataDir: r.data });
    if (open.skip) return t.skip(open.skip);
    assert.equal(open.code, 0, open.stdout + open.stderr);
    assert.ok(open.stdout.includes(`chrome: ready ${join(r.data, 'chrome-automation')}`), open.stdout);

    const read = await runChromeCli(['read', page.url], { root: r.root, dataDir: r.data });
    assert.equal(read.code, 0, read.stdout + read.stderr);
    assert.ok(read.stdout.includes(text), read.stdout);

    const pid = open.state.pid;
    const close = await runChromeCli(['close'], { root: r.root, dataDir: r.data });
    assert.equal(close.code, 0, close.stdout + close.stderr);
    await waitFor(() => !alive(pid), `recorded Chrome PID ${pid} to exit`);
  } finally {
    await stopAll({ root: r.root, dataDir: r.data });
    await page.close();
    r.cleanup();
  }
});

// M-001-S17-osdr
test('M-001-S17-osdr [e2e] a plain node process with a launchd-like environment reaches the profile', async (t) => {
  const reason = await gate();
  if (reason) return t.skip(reason);
  const r = makeRoot();
  try {
    const open = await openChrome({ root: r.root, dataDir: r.data });
    if (open.skip) return t.skip(open.skip);
    assert.equal(open.code, 0, open.stdout + open.stderr);

    const status = await new Promise((resolve) => {
      const child = spawn(process.execPath, [join(PACK_ROOT, 'scripts', 'chrome.mjs'), 'status', '--json', '--root', r.root, '--data-dir', r.data], {
        cwd: PACK_ROOT,
        env: { HOME: r.root, PATH: '/usr/bin:/bin' },
      });
      let stdout = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.on('close', (code) => resolve({ code, stdout }));
    });
    assert.equal(status.code, 0, status.stdout);
    const body = JSON.parse(status.stdout);
    assert.ok(body.reachable === 'yes' || body.reachable === true, status.stdout);
    assert.equal(body.port, open.state.port);
  } finally {
    await stopAll({ root: r.root, dataDir: r.data });
    r.cleanup();
  }
});

// M-001-S15-osdr
test('M-001-S15-osdr the Chrome e2e harness skips outside CI with the reason no browser slot command configured', () => {
  const emptyRoot = mkdtempSync(join(tmpdir(), 'chrome-e2e-noslot-'));
  try {
    const env = { ...process.env, [ROOT_ENV]: emptyRoot };
    delete env.CI;
    delete env.BROWSER_SLOT_CMD;
    delete env.NODE_TEST_CONTEXT; // Node refuses a nested node --test run while this is inherited
    const out = spawnSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=M-001-S1-osdr', THIS_FILE], { cwd: PACK_ROOT, env, encoding: 'utf8', timeout: 60000 });
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /# SKIP no browser slot command configured/);
  } finally {
    rmSync(emptyRoot, { recursive: true, force: true });
  }
});
