// tools/schedule-probe.mjs with a fake scheduler and a fake clock: no launchd or Task Scheduler job is installed and the
// 90-second wait passes instantly. Config and the spike doc live in a scratch root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { probe } from '../../tools/schedule-probe.mjs';
import { makeRoot } from '../helpers/script-harness.mjs';

const TODAY = '2026-11-03';
const SPIKE_HEAD = '# Chrome spike\n\nExisting line kept.\n';

// Each wait(ms) moves the fake clock forward by ms, so polling to the 90-second bound returns at once.
function fakeClock() {
  let t = 1_000_000;
  return { now: () => t, wait: async (ms) => void (t += Math.max(ms ?? 0, 1)) };
}

// writes: the probe output the scheduled job would leave, or null for a job that never wrote it.
function fakeScheduler(writes) {
  const log = [];
  return {
    log,
    install({ nodePath, packRoot, out }) {
      log.push('install');
      if (writes) writeFileSync(out, JSON.stringify(writes));
      return true;
    },
    remove() {
      log.push('remove');
    },
  };
}

async function runProbe(r, scheduler) {
  const spikeDoc = join(r.root, 'chrome-spike.md');
  writeFileSync(spikeDoc, SPIKE_HEAD);
  const clock = fakeClock();
  const value = await probe({ root: r.root, dataDir: r.data, scheduler, now: clock.now, wait: clock.wait, spikeDoc, today: TODAY, say: () => {} });
  const config = yaml.load(r.read('config/student.yml'));
  const added = readFileSync(spikeDoc, 'utf8').slice(SPIKE_HEAD.length).split('\n').filter(Boolean);
  return { value, config, added };
}

async function reachableCase() {
  const r = makeRoot();
  try {
    writeFileSync(join(r.data, '.chrome-probe.json'), JSON.stringify({ reachable: 'no' }));
    const scheduler = fakeScheduler({ reachable: 'yes', port: 49152 });
    const { value, config, added } = await runProbe(r, scheduler);
    assert.equal(value, 'yes');
    assert.equal(config.chrome_in_schedule, 'yes');
    assert.equal(config.timezone, 'America/Chicago', 'other config keys kept');
    assert.equal(added.length, 1, added.join('\n'));
    for (const part of [TODAY, 'career-ops.chrome-probe', 'chrome_in_schedule yes']) assert.ok(added[0].includes(part), added[0]);
    assert.deepEqual(scheduler.log, ['install', 'remove']);
  } finally {
    r.cleanup();
  }
}

async function missingFileCase() {
  const r = makeRoot();
  try {
    // A stale reachable file from an earlier run must not count for this one.
    writeFileSync(join(r.data, '.chrome-probe.json'), JSON.stringify({ reachable: 'yes' }));
    const scheduler = fakeScheduler(null);
    const { value, config, added } = await runProbe(r, scheduler);
    assert.equal(value, 'no');
    assert.equal(config.chrome_in_schedule, 'no');
    assert.equal(existsSync(join(r.data, '.chrome-probe.json')), false, 'the old probe file was removed');
    assert.equal(added.length, 1, added.join('\n'));
    for (const part of [TODAY, 'career-ops.chrome-probe', 'chrome_in_schedule no']) assert.ok(added[0].includes(part), added[0]);
    assert.deepEqual(scheduler.log, ['install', 'remove']);
  } finally {
    r.cleanup();
  }
}

async function installThrowsCase() {
  const r = makeRoot();
  try {
    const scheduler = fakeScheduler(null);
    scheduler.install = () => {
      scheduler.log.push('install');
      throw new Error('fake scheduler refused the job');
    };
    let value;
    let config;
    try {
      ({ value, config } = await runProbe(r, scheduler));
    } catch {
      config = yaml.load(r.read('config/student.yml'));
    }
    assert.ok(scheduler.log.includes('remove'), 'remove runs on every exit path');
    if (value !== undefined) assert.equal(value, 'no');
    assert.notEqual(config.chrome_in_schedule, 'yes');
  } finally {
    r.cleanup();
  }
}

// M-001-S18-osdr
test('M-001-S18-osdr schedule-probe with a fake scheduler writes chrome_in_schedule yes and the evidence line when the probe file says reachable and no when it is missing after the wait, removing the job each time', async () => {
  await reachableCase();
  await missingFileCase();
  await installThrowsCase();
});
