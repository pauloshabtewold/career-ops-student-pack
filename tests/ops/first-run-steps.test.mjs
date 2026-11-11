// first-run.mjs --queue --step <name>: each ingest step is its own command, and the scan works through the companies in
// slices so no command runs near a 10-minute limit. The first run of upstream scan.mjs on a real 84-company portals.yml
// took about 16 minutes in one piece.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { firstRun } from '../../scripts/first-run.mjs';
import { sliceScan } from '../../lib/ingest.mjs';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT, TODAY, pipelineText } from '../helpers/script-harness.mjs';

const NAMES = ['Alpha Works', 'Beta Labs', 'Gamma Co', 'Delta Inc'];

function setup(names = NAMES) {
  const up = createFakeUpstream();
  writeFileSync(join(up.root, 'config', 'student.yml'), 'timezone: America/Chicago\npresets: []\n');
  writeFileSync(join(up.root, 'data', 'pipeline.md'), pipelineText({}));
  const yml = ['tracked_companies:', ...names.flatMap((n) => [`  - name: ${n}`, `    careers_url: https://job-boards.greenhouse.io/${n.split(' ')[0].toLowerCase()}`, '    enabled: true'])].join('\n');
  writeFileSync(join(up.root, 'portals.yml'), `${yml}\n`);
  return { up, data: join(up.root, 'data'), cleanup: () => rmSync(up.root, { recursive: true, force: true }) };
}

// A fake clock: every upstream call advances it by cost(name) ms.
function slicer(s, cost, extra = {}) {
  let t = 0;
  const calls = [];
  const upstream = (script, args, opts) => {
    calls.push({ script, args, timeout: opts?.timeout });
    t += cost(args[1]);
    if (extra.fail?.(args[1], calls.filter((c) => c.args[1] === args[1]).length)) throw Object.assign(new Error('boom'), extra.error ?? { status: 1 });
    return '';
  };
  const run = (opts = {}) => sliceScan({ root: s.up.root, dataDir: s.data, upstream, today: TODAY, now: () => t, ...opts });
  return { calls, run };
}

test('the scan step stops starting companies when the slice budget is spent and the next call continues from there', () => {
  const s = setup();
  try {
    const sl = slicer(s, () => 100_000);
    const first = sl.run({ budgetMs: 250_000 });
    assert.match(first, /^scan partial: 3 of 4 companies done, 1 left; run the same command again/);
    assert.deepEqual(sl.calls.map((c) => c.args), NAMES.slice(0, 3).map((n) => ['--company', n]));
    const second = sl.run({ budgetMs: 250_000 });
    assert.match(second, /^scan complete: 4 companies/);
    assert.deepEqual(sl.calls.slice(3).map((c) => c.args[1]), ['Delta Inc']);
    assert.ok(sl.calls.every((c) => c.timeout <= 250_000 && c.timeout >= 90_000), JSON.stringify(sl.calls.map((c) => c.timeout)));
  } finally {
    s.cleanup();
  }
});

test('a company that is cut off or fails twice is left to the daily run and the slice goes on', () => {
  const s = setup();
  try {
    const sl = slicer(s, () => 1000, { fail: (n) => n === 'Beta Labs', error: { code: 'ETIMEDOUT' } });
    const out = sl.run();
    assert.match(out, /^scan complete: 4 companies; 1 not finished \(Beta Labs\), left to the daily run/);
    assert.equal(sl.calls.filter((c) => c.args[1] === 'Beta Labs').length, 1, 'a cut-off company is not retried');
    const s2 = slicer(s, () => 1000, { fail: (n) => n === 'Gamma Co' });
    const out2 = s2.run({ reset: true });
    assert.equal(s2.calls.filter((c) => c.args[1] === 'Gamma Co').length, 2, 'a plain failure is retried once');
    assert.match(out2, /1 not finished \(Gamma Co\)/);
  } finally {
    s.cleanup();
  }
});

test('--queue --step runs only the named step; github-lists starts a fresh scan pass and view runs no step', async () => {
  const s = setup();
  try {
    const ran = [];
    const runner = (cmd, args) => { ran.push(basename(args[0]) + ' ' + args.slice(1).join(' ')); return ''; };
    const out = [];
    const go = (step) => firstRun({ root: s.up.root, dataDir: s.data, packRoot: PACK_ROOT, today: TODAY, queue: true, step, runner, out: (l) => out.push(String(l)) });
    await go('github-lists');
    assert.deepEqual(ran, ['plugins.mjs run github-lists']);
    ran.length = 0;
    await go('scan');
    assert.equal(ran.length, 4);
    assert.ok(ran.every((r) => r.startsWith('scan.mjs --company ')), ran.join('\n'));
    assert.ok(out.some((l) => /^first-run: scan ok \(scan complete: 4 companies\)$/.test(l)), out.join('\n'));
    assert.ok(existsSync(join(s.data, 'student-first-scan.json')));
    ran.length = 0;
    await go('github-lists');
    assert.ok(!existsSync(join(s.data, 'student-first-scan.json')), 'github-lists resets the pass');
    ran.length = 0;
    out.length = 0;
    await go('view');
    assert.deepEqual(ran, []);
    assert.ok(out.some((l) => l.startsWith('queue: ')), out.join('\n'));
  } finally {
    s.cleanup();
  }
});

test('--step without --queue and an unknown step are usage errors', () => {
  const s = setup();
  try {
    for (const args of [['--step', 'scan'], ['--queue', '--step', 'nope']]) {
      const r = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'first-run.mjs'), '--root', s.up.root, '--data-dir', s.data, '--today', TODAY, ...args], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 60000 });
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stderr, /--step/);
    }
  } finally {
    s.cleanup();
  }
});
