// scripts/chrome.mjs CLI paths that never launch a browser: the slot gate, reuse of a live recorded instance, close on a
// stale state file and read with nothing running. A live instance is a fake DevTools HTTP server on 127.0.0.1 plus an
// idle node process this test starts and stops; no Chrome is started anywhere in this file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { delimiter, dirname, join } from 'node:path';
import { readState, writeState } from '../../scripts/chrome.mjs';
import { PACK_ROOT, makeRoot } from '../helpers/script-harness.mjs';
import { LOG_HEADER, TZ, row, run as runBudget } from '../helpers/budget-harness.mjs';
import { appendTsv, readTsv } from '../../lib/tsv.mjs';

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

// M-002 chrome.mjs fill and submit paths, still with no browser: fill runs through a fake CDP client and submit stops
// at the budget check. Fill plan shape (ruling): { batchId, item, url, company, role, track, score, fields: [{ selector,
// label, type, value }] }, stored for submit at data/fill-plans/<batchId>/<item>.json. Batch items (ruling):
// { company, role, score, preview, link }.
const LOCAL_TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const SUBMIT_BATCH = '2026-11-03-apply-1';

function fakeCdp({ captcha = false } = {}) {
  const calls = [];
  const send = async (method, params = {}, sessionId) => {
    calls.push({ method, params, sessionId });
    if (method === 'Target.getTargets') return { targetInfos: [] };
    if (method === 'Target.createTarget') return { targetId: 'T-fake-1' };
    if (method === 'Target.attachToTarget') return { sessionId: 'S-fake-1' };
    if (method === 'Page.navigate') return { frameId: 'F-fake-1' };
    if (method === 'Runtime.evaluate') {
      const expr = String(params.expression ?? '');
      if (/captcha/i.test(expr)) return { result: { type: 'boolean', value: captcha } };
      return { result: { type: 'object', value: { tag: 'input', tagName: 'INPUT', type: 'text', autocomplete: '', value: '' } } };
    }
    return {};
  };
  const waitFor = () => {
    const p = Promise.resolve({});
    p.cancel = () => {};
    return p;
  };
  return { send, waitFor, close: () => {}, opened: Promise.resolve(), calls };
}

async function outcomeOf(fn) {
  try {
    const r = await fn();
    if (typeof r === 'number') return { code: r, text: '' };
    return { code: r?.code ?? r?.exit, text: JSON.stringify(r ?? null) };
  } catch (err) {
    return { code: Number.isInteger(err?.exitCode) ? err.exitCode : 1, text: String(err?.message ?? err) };
  }
}

function submitPlan(r, item, over = {}) {
  const dir = join(r.data, 'fill-plans', SUBMIT_BATCH);
  mkdirSync(dir, { recursive: true });
  const plan = { batchId: SUBMIT_BATCH, item, url: `https://boards.greenhouse.io/examplerobotics/jobs/${2000 + item}`, company: 'Example Robotics', role: 'Software Engineering Intern', track: 'swe-intern', score: 4.2, fields: [], ...over };
  writeFileSync(join(dir, `${item}.json`), JSON.stringify(plan));
  return plan;
}

const pack = (r) => ({ root: r.root, dataDir: r.data });
const logRows = async (r) => (existsSync(join(r.data, 'action-log.tsv')) ? (await readTsv(join(r.data, 'action-log.tsv'))).rows : []);

// M-002-S38-osdr
test('M-002-S38-osdr chrome.mjs fill on a page with a CAPTCHA widget exits 6 and the job moves from the unapproved batch items to its finish-yourself list', async () => {
  const { fillPlan } = await import('../../scripts/chrome.mjs');
  const { writeBatches, listBatches } = await import('../../lib/batch-file.mjs');
  const r = makeRoot();
  try {
    const link = (n) => `https://boards.greenhouse.io/examplerobotics/jobs/${3000 + n}`;
    writeBatches(r.data, {
      date: '2026-11-03',
      kind: 'apply',
      items: [1, 2, 3].map((n) => ({ company: `Example Co ${n}`, role: 'Data Intern', score: 4.1, preview: `Fake preview ${n}.`, link: link(n) })),
    });
    const ids = listBatches(r.data).map((b) => (typeof b === 'string' ? b : b.id));
    assert.equal(ids.length, 1);
    const plan = { batchId: ids[0], item: 2, url: link(2), company: 'Example Co 2', role: 'Data Intern', fields: [{ selector: '#email', label: 'Email', type: 'text', value: 'casey.sample@example.com' }] };
    const client = fakeCdp({ captcha: true });
    const res = await outcomeOf(() => fillPlan(client, plan, { dataDir: r.data }));
    assert.equal(res.code, 6, res.text);
    assert.ok(!client.calls.some((c) => c.method.startsWith('Input.') || String(c.params.expression ?? '').includes('casey.sample@example.com')), 'nothing typed');

    const text = readFileSync(join(r.data, 'batches', `${ids[0]}.md`), 'utf8');
    const lines = text.split('\n');
    const head = lines.findIndex((l) => /finish/i.test(l) && /^#+\s/.test(l));
    assert.ok(head >= 0, text);
    const numbered = lines.slice(0, head).filter((l) => /^\s*\d+[.)]\s/.test(l));
    assert.ok(lines.slice(head).some((l) => l.includes(link(2))), `finish-yourself list holds the job link:\n${text}`);
    assert.ok(!numbered.some((l) => l.includes(link(2))), `the job left the numbered items:\n${text}`);
    assert.equal(numbered.length, 2, text);
    assert.ok(numbered.some((l) => l.includes(link(1))) && numbered.some((l) => l.includes(link(3))), text);
  } finally {
    r.cleanup();
  }
});

// M-002-S39-osdr
test('M-002-S39-osdr chrome.mjs submit passes a budget.mjs check exit 5 through as exit 5 and prints the budget line while a check exit 4 stays 4', async () => {
  const { budgetExit, EXIT } = await import('../../scripts/chrome.mjs');
  assert.equal(typeof budgetExit, 'function', 'chrome.mjs exports budgetExit');
  assert.equal(budgetExit(4), 4);
  assert.equal(budgetExit(5), 5);
  assert.equal(budgetExit(3), 3);
  assert.equal(budgetExit(2), 3);
  assert.equal(budgetExit(1), 3);
  assert.equal(EXIT.captcha, 6);

  const r = makeRoot();
  try {
    const earlier = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    await appendTsv(join(r.data, 'action-log.tsv'), LOG_HEADER, [
      row({ ts: earlier, action: 'apply.submit', target: 'ex-old', company: 'Example Robotics', session: 's0', detail: 'track=ml-newgrad' }),
    ]);
    const approved = runBudget(pack(r), ['log', 'batch.approve', '--batch-id', SUBMIT_BATCH, '--items', '1,2', '--approval', 'approve all'], { today: LOCAL_TODAY });
    assert.equal(approved.code, 0, approved.stdout + approved.stderr);
    submitPlan(r, 1);
    const before = (await logRows(r)).length;
    const out = await runChrome(['submit', '--batch-id', SUBMIT_BATCH, '--item', '1'], r);
    assert.equal(out.code, 5, out.stdout + out.stderr);
    assert.match(out.stdout + out.stderr, /ml-newgrad/, 'the budget line naming the existing track is printed');
    assert.equal((await logRows(r)).length, before, 'nothing logged, nothing clicked');
  } finally {
    r.cleanup();
  }
});

// M-002-S40-osdr
test('M-002-S40-osdr a second submit of an item whose apply.pending row was logged exits 3 because that row counts as used', async () => {
  const r = makeRoot();
  try {
    const approved = runBudget(pack(r), ['log', 'batch.approve', '--batch-id', SUBMIT_BATCH, '--items', '1,2', '--approval', 'approve all'], { today: LOCAL_TODAY });
    assert.equal(approved.code, 0, approved.stdout + approved.stderr);
    const pend = runBudget(pack(r), ['log', 'apply.pending', '--batch-id', SUBMIT_BATCH, '--item', '1', '--target', 'ex-new', '--company', 'Example Robotics'], { today: LOCAL_TODAY });
    assert.equal(pend.code, 0, pend.stdout + pend.stderr);
    submitPlan(r, 1);
    const before = await logRows(r);
    const out = await runChrome(['submit', '--batch-id', SUBMIT_BATCH, '--item', '1'], r);
    assert.equal(out.code, 3, out.stdout + out.stderr);
    const after = await logRows(r);
    assert.equal(after.length, before.length, 'no second apply.pending and no apply.submit row');
    assert.ok(!after.some((x) => x.action === 'apply.submit'));
  } finally {
    r.cleanup();
  }
});
