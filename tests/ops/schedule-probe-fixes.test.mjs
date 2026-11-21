// tools/schedule-probe.mjs fixes against fakes: a fake scheduler, a fake clock, a fake process object for signals and a
// fake run() for schtasks. No launchd or Task Scheduler job is installed and no browser starts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { EVIDENCE_FILE, main, probe, systemScheduler } from '../../tools/schedule-probe.mjs';
import { writeState } from '../../scripts/chrome.mjs';
import { makeRoot } from '../helpers/script-harness.mjs';

function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, wait: async (ms) => void (t += Math.max(ms ?? 0, 1)) };
}

function fakeScheduler(writes, installed = true) {
  const log = [];
  return {
    log,
    install({ out }) {
      log.push('install');
      if (writes) writeFileSync(out, JSON.stringify(writes));
      return installed;
    },
    remove() {
      log.push('remove');
    },
  };
}

const configOf = (r) => yaml.load(r.read('config/student.yml'));
const runProbe = (r, scheduler, extra = {}) => probe({ root: r.root, dataDir: r.data, scheduler, ...fakeClock(), today: '2026-11-03', say: () => {}, ...extra });

test('S4 the Windows task runs a wrapper in the data folder so /TR stays within 261 characters', () => {
  const r = makeRoot();
  try {
    const dataDir = join(r.root, 'First Last', 'OneDrive', 'Documents', 'career-ops', 'data');
    mkdirSync(dataDir, { recursive: true });
    const calls = [];
    const scheduler = systemScheduler({ platform: 'win32', run: (cmd, args) => (calls.push({ cmd, args }), { code: 0 }) });
    const root = 'C:\\Users\\First Last\\OneDrive\\Documents\\career-ops';
    const out = join(dataDir, '.chrome-probe.json');
    const packRoot = `${root}\\student`;
    assert.equal(scheduler.install({ nodePath: 'C:\\Program Files\\nodejs\\node.exe', packRoot, out, root, dataDir }), true);
    const args = calls[0].args;
    const tr = args[args.indexOf('/TR') + 1];
    assert.ok(tr.length <= 261, `/TR is ${tr.length} characters`);
    const wrapper = join(dataDir, '.chrome-probe.cmd');
    assert.equal(tr, `"${wrapper}"`);
    const body = readFileSync(wrapper, 'utf8');
    for (const part of ['node.exe', 'schedule-probe.mjs', 'child', out, root, dataDir]) assert.ok(body.includes(part), body);
    scheduler.remove();
    assert.equal(existsSync(wrapper), false, 'remove deletes the wrapper');
    assert.equal(calls[1].args[0], '/Delete');
  } finally {
    r.cleanup();
  }
});

test('S5 the evidence line goes to the data folder log, not a pack file', async () => {
  const r = makeRoot();
  try {
    const packRoot = join(r.root, 'student');
    mkdirSync(join(packRoot, 'docs'), { recursive: true });
    writeFileSync(join(packRoot, 'docs', 'chrome-spike.md'), '# Chrome spike\n');
    const value = await runProbe(r, fakeScheduler({ reachable: 'yes', chrome_open: 'yes' }), { packRoot });
    assert.equal(value, 'yes');
    assert.equal(readFileSync(join(packRoot, 'docs', 'chrome-spike.md'), 'utf8'), '# Chrome spike\n', 'pack doc untouched');
    const log = readFileSync(join(r.data, EVIDENCE_FILE), 'utf8');
    assert.ok(log.includes('2026-11-03') && log.includes('chrome_in_schedule yes'), log);
  } finally {
    r.cleanup();
  }
});

test('S6 SIGINT during the wait removes the job before exiting, and the handlers are gone afterwards', async () => {
  const r = makeRoot();
  try {
    const proc = new EventEmitter();
    const exits = [];
    proc.exit = (code) => exits.push({ code, log: [...scheduler.log] });
    const scheduler = fakeScheduler(null);
    const clock = fakeClock();
    let first = true;
    const wait = async (ms) => {
      if (first) {
        first = false;
        proc.emit('SIGINT', 'SIGINT');
      }
      await clock.wait(ms);
    };
    await runProbe(r, scheduler, { proc, now: clock.now, wait });
    assert.equal(exits.length, 1);
    assert.equal(exits[0].code, 130);
    assert.deepEqual(exits[0].log, ['install', 'remove'], 'job removed before exit');
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) assert.equal(proc.listenerCount(sig), 0, sig);
  } finally {
    r.cleanup();
  }
});

test('S7 Chrome not open leaves chrome_in_schedule unset; open but unreachable records no', async () => {
  const r = makeRoot();
  try {
    assert.equal(await runProbe(r, fakeScheduler({ reachable: 'no', chrome_open: 'no' })), 'unset');
    assert.equal('chrome_in_schedule' in configOf(r), false);
    assert.ok(readFileSync(join(r.data, EVIDENCE_FILE), 'utf8').includes('was not open'));
    assert.equal(await runProbe(r, fakeScheduler({ reachable: 'no', chrome_open: 'yes' })), 'no');
    assert.equal(configOf(r).chrome_in_schedule, 'no');
  } finally {
    r.cleanup();
  }
});

test('S4 a job that cannot be installed leaves chrome_in_schedule unset', async () => {
  const r = makeRoot();
  try {
    const scheduler = fakeScheduler(null, false);
    assert.equal(await runProbe(r, scheduler), 'unset');
    assert.equal('chrome_in_schedule' in configOf(r), false);
    assert.deepEqual(scheduler.log, ['install', 'remove']);
  } finally {
    r.cleanup();
  }
});

test('S7 the scheduled child records chrome_open from the recorded PID', async () => {
  const r = makeRoot();
  const idle = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    const out = join(r.data, '.chrome-probe.json');
    await main(['child', '--out', out, '--root', r.root, '--data-dir', r.data]);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { reachable: 'no', port: null, profile: null, chrome_open: 'no' });
    writeState(r.data, { pid: idle.pid, port: 1 });
    await main(['child', '--out', out, '--root', r.root, '--data-dir', r.data]);
    const res = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(res.reachable, 'no');
    assert.equal(res.chrome_open, 'yes');
  } finally {
    idle.kill();
    r.cleanup();
  }
});
