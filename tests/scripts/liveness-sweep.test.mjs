// Assumed: scripts/liveness-sweep.mjs exports async sweep({ dataDir, root, config, runner, today, dryRun, limit }).
// runner(argv, { cwd }) -> { code, stdout } receives the argv after node:
// ['check-liveness.mjs', '--no-fallback', '--no-record', '--file', <tmp file of urls, one per line>].
// Its stdout has one '<active|expired|uncertain> <company> <url>' line per url. Expired rows are applied through
// apply-triage into Skipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sweep } from '../../scripts/liveness-sweep.mjs';
import { makeRoot, line, pipelineText, urlsOf, jobUrl, TODAY } from '../helpers/script-harness.mjs';

const CONFIG = { score_floor: 3.5 };
const eligible = Array.from({ length: 120 }, (_, i) => i + 1);
const status = (n) => (n % 10 === 0 ? 'expired' : n % 7 === 0 ? 'uncertain' : 'active');
const expiredOf = (ns) => ns.filter((n) => status(n) === 'expired').map(jobUrl);

function stubRunner() {
  const calls = [];
  const runner = async (argv, opts) => {
    const file = argv[argv.indexOf('--file') + 1];
    const urls = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    calls.push({ argv, cwd: opts.cwd, urls });
    const lines = urls.map((u) => `${status(Number(u.split('/').pop()))} Example Robotics ${u}`);
    return { code: 0, stdout: `${lines.join('\n')}\n` };
  };
  return { runner, calls };
}

function setup() {
  const r = makeRoot();
  const pending = [
    ...eligible.map((n) => line(jobUrl(n), 'Example Robotics', `Role ${n}`, 'Remote', 'triage=4.0')),
    line(jobUrl(500), 'Example Robotics', 'Low score', 'Remote', 'triage=2.0'),
    line('https://www.linkedin.com/jobs/view/12345', 'Example Robotics', 'Linkedin role', 'Remote', 'triage=4.5'),
    '- [ ] needs-url | Example Robotics | No url role | Remote | note: triage=4.5',
  ];
  r.write('data/pipeline.md', pipelineText({ pending }));
  return r;
}

// M-004-S13
test('M-004-S13 calls check-liveness with --no-fallback in batches of at most 50 from the root', async () => {
  const r = setup();
  try {
    const { runner, calls } = stubRunner();
    await sweep({ dataDir: r.data, root: r.root, config: CONFIG, runner, today: TODAY });
    assert.deepEqual(calls.map((c) => c.urls.length), [50, 50, 20]);
    for (const c of calls) {
      assert.ok(c.argv.includes('check-liveness.mjs'));
      assert.ok(c.argv.includes('--no-fallback'));
      assert.ok(c.argv.includes('--no-record'));
      assert.equal(c.cwd, r.root);
    }
    const checked = calls.flatMap((c) => c.urls).sort();
    assert.deepEqual(checked, eligible.map(jobUrl).sort());
  } finally {
    r.cleanup();
  }
});

// M-004-S13
test('M-004-S13 moves only expired rows to Skipped and keeps active and uncertain rows', async () => {
  const r = setup();
  try {
    const { runner } = stubRunner();
    await sweep({ dataDir: r.data, root: r.root, config: CONFIG, runner, today: TODAY });
    const text = r.read('data/pipeline.md');
    assert.deepEqual(urlsOf(text, 'Skipped').sort(), expiredOf(eligible).sort());
    const pending = urlsOf(text, 'Pending');
    assert.equal(pending.length, 120 - expiredOf(eligible).length + 2);
    assert.ok(pending.includes(jobUrl(7)), 'uncertain row stays');
    assert.ok(pending.includes(jobUrl(500)));
    assert.ok(pending.includes('https://www.linkedin.com/jobs/view/12345'));
    assert.match(text, /needs-url \| Example Robotics/);
  } finally {
    r.cleanup();
  }
});

// M-004-S13
test('M-004-S13 dry run checks but leaves pipeline.md untouched, and limit caps the rows checked', async () => {
  const r = setup();
  try {
    const before = r.read('data/pipeline.md');
    const dry = stubRunner();
    await sweep({ dataDir: r.data, root: r.root, config: CONFIG, runner: dry.runner, today: TODAY, dryRun: true });
    assert.equal(r.read('data/pipeline.md'), before);
    const lim = stubRunner();
    await sweep({ dataDir: r.data, root: r.root, config: CONFIG, runner: lim.runner, today: TODAY, dryRun: true, limit: 30 });
    assert.equal(lim.calls.flatMap((c) => c.urls).length, 30);
  } finally {
    r.cleanup();
  }
});
