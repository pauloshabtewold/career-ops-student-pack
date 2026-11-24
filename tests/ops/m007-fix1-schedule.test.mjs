// M-007 fix round 1, M-2: setup-flow runs the schedule probe after the schedule step and records chrome_in_schedule no
// when the probe could not answer, and scheduled.mjs runs the autopilot on a default (unset) config once onboarding is
// complete. The probe, the resume build, Chrome and every scheduled child are injected fakes: no scheduler job, browser
// or agent starts. Fake person only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import * as yaml from 'js-yaml';
import { writeConfigKey } from '../../lib/config.mjs';
import { runsAutopilot, scheduledRun } from '../../scripts/scheduled.mjs';
import { scheduleStep, setupFlow } from '../../scripts/setup-flow.mjs';
import { PACK_ROOT, makeRoot } from '../helpers/script-harness.mjs';

const CV = '# Jordan Testwell\n\njordan.testwell@example.com | 555-0100\n\n## Skills\nPython, SQL\n';

function install(extra = '') {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-schedule-'));
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), `timezone: America/Chicago\nonboarding:\n  complete: true\n${extra}`);
  writeFileSync(join(root, 'config', 'profile.yml'), 'candidate:\n  full_name: "Jordan Testwell"\n');
  writeFileSync(join(root, 'cv.md'), CV);
  const dataDir = join(root, 'data');
  return { root, dataDir, paths: { root, dataDir }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const configOf = (r) => yaml.load(readFileSync(join(r.root, 'config', 'student.yml'), 'utf8'));

// Every step but the schedule is done; schedule(root) stands in for the default schedule step (readJob and the probe).
function deps(r, schedule) {
  const lines = [];
  return {
    lines,
    deps: {
      buildResume: async () => {
        const out = join(r.dataDir, 'resume');
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, 'resume.html'), '<html><body><h1>Jordan Testwell</h1></body></html>');
        writeFileSync(join(out, 'resume.pdf'), '%PDF-1.4\n%%EOF\n');
        return { html: join(out, 'resume.html'), pdf: join(out, 'resume.pdf') };
      },
      atsCheck: async () => ({ ok: true, problems: [] }),
      chrome: async () => ({ code: 0 }),
      schedule,
      say: (l) => lines.push(String(l)),
    },
  };
}

const run = (r, d) => setupFlow({ paths: r.paths, flags: { signedIn: 'LinkedIn,Gmail,Handshake', slotCmd: '' }, today: '2026-11-03', deps: d.deps });

test('M-2 scheduleStep runs the probe only after a schedule is installed and only while chrome_in_schedule is unset', async () => {
  const probes = [];
  const runProbe = async () => (probes.push(1), { code: 0, stdout: 'schedule-probe: chrome_in_schedule yes (probe file said reachable yes)\n', stderr: '' });
  assert.deepEqual(await scheduleStep({ config: {}, readJob: async () => null, runProbe }), { code: 1, probe: null });
  assert.equal(probes.length, 0, 'no schedule, no probe');
  assert.deepEqual(await scheduleStep({ config: { chrome_in_schedule: 'unset' }, readJob: async () => ({ label: 'x' }), runProbe }), { code: 0, probe: 'schedule-probe: chrome_in_schedule yes (probe file said reachable yes)' });
  assert.equal(probes.length, 1);
  for (const value of ['yes', 'no']) assert.deepEqual(await scheduleStep({ config: { chrome_in_schedule: value }, readJob: async () => ({ label: 'x' }), runProbe }), { code: 0, probe: null });
  assert.equal(probes.length, 1, 'a recorded answer is never probed again');
});

test('M-2 setup-flow records chrome_in_schedule no when the probe could not answer, never leaving it unset', async () => {
  const r = install();
  try {
    // The probe ran but wrote nothing (Linux, a timeout or Chrome closed).
    const d = deps(r, async () => ({ code: 0, probe: 'schedule-probe: chrome_in_schedule unset (the automation Chrome was not open; run chrome.mjs open, then the probe again)' }));
    const res = await run(r, d);
    assert.equal(res.state.schedule, true);
    assert.equal(configOf(r).chrome_in_schedule, 'no');
    assert.ok(d.lines.some((l) => /chrome_in_schedule is no/.test(l)), d.lines.join('\n'));
    assert.ok(d.lines.some((l) => l.startsWith('setup: schedule-probe:')), 'the probe line is shown');
  } finally {
    r.cleanup();
  }
});

test('M-2 setup-flow keeps the yes the probe recorded', async () => {
  const r = install();
  try {
    const d = deps(r, async () => {
      writeConfigKey({ root: r.root }, 'chrome_in_schedule', 'yes');
      return { code: 0, probe: 'schedule-probe: chrome_in_schedule yes (probe file said reachable yes)' };
    });
    await run(r, d);
    assert.equal(configOf(r).chrome_in_schedule, 'yes');
    assert.ok(!d.lines.some((l) => /chrome_in_schedule is no/.test(l)), d.lines.join('\n'));
  } finally {
    r.cleanup();
  }
});

test('M-2 setup-flow writes nothing while the schedule is not installed', async () => {
  const r = install();
  try {
    await run(r, deps(r, async () => ({ code: 1, probe: null })));
    assert.equal('chrome_in_schedule' in configOf(r), false);
  } finally {
    r.cleanup();
  }
});

test('M-2 scheduledRun on a default config calls autopilot.mjs once onboarding is complete, and not before', async () => {
  const names = async (config) => {
    const r = makeRoot({ config });
    const calls = [];
    try {
      await scheduledRun({ root: r.root, packRoot: PACK_ROOT, passThrough: [], dataDir: r.data, runner: (cmd, args) => (calls.push(basename(String(args[0]))), ''), out: () => {} });
      return calls;
    } finally {
      r.cleanup();
    }
  };
  assert.ok((await names('automation: scheduled-discovery\nonboarding:\n  complete: true\n')).includes('autopilot.mjs'));
  assert.ok(!(await names('automation: scheduled-discovery\n')).includes('autopilot.mjs'));
  assert.ok(!(await names('automation: manual\nonboarding:\n  complete: true\n')).includes('autopilot.mjs'));
  assert.equal(runsAutopilot({ automation: 'scheduled-discovery', chrome_in_schedule: 'no' }), true);
  assert.equal(runsAutopilot(null), false);
});
