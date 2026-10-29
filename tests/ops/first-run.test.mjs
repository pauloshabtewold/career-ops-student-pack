// Assumed: scripts/first-run.mjs exports firstRun({ root, dataDir, packRoot, today, shown, runner, out }) and runs as a CLI
// `first-run.mjs [--root R] [--data-dir D] [--today D] [--n 20]`. out(line) receives every printed line. Upstream scripts go
// through runner; the fake upstream stubs record their argv. The wrapper runner below records the step order and then
// lets the real runner execute, so pack scripts work on the scratch data dir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { firstRun } from '../../scripts/first-run.mjs';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT, TODAY, jobUrl, line, pipelineText } from '../helpers/script-harness.mjs';
import { defaultRunner } from '../../lib/upstream.mjs';

function setup(pending) {
  const up = createFakeUpstream();
  writeFileSync(join(up.root, 'config', 'student.yml'), 'timezone: America/Chicago\npresets: []\n');
  writeFileSync(join(up.root, 'data', 'pipeline.md'), pipelineText({ pending }));
  writeFileSync(join(up.root, 'data', 'pipeline.staging.md'), '');
  writeFileSync(join(up.root, 'data', 'applications.md'), '# Applications\n');
  return { up, data: join(up.root, 'data'), cleanup: () => rmSync(up.root, { recursive: true, force: true }) };
}

const rows = (n, src, from = 1) => Array.from({ length: n }, (_, i) => line(jobUrl(from + i), 'Example Robotics', `Data Intern ${from + i}`, 'Remote', `src=${src}; imported=2026-10-27`));

async function report(s, shown) {
  const order = [];
  const out = [];
  const runner = (cmd, args, opts) => {
    order.push(basename(args[0]) + (args[1] === 'run' ? `:${args[2]}` : ''));
    return defaultRunner(cmd, args, opts);
  };
  await firstRun({ root: s.up.root, dataDir: s.data, packRoot: PACK_ROOT, today: TODAY, ...(shown ? { shown } : {}), runner, out: (l) => out.push(String(l)) });
  return { order, out, text: out.join('\n') };
}

const cli = (s, extra = []) => spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'first-run.mjs'), '--root', s.up.root, '--data-dir', s.data, '--today', TODAY, ...extra], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 120000 });

// M-002-S1
test('M-002-S1 runs github-lists, scan, merge-post and prefilter in order and prints counts per source plus the untriaged rows', async () => {
  const s = setup([...rows(3, 'handshake'), ...rows(2, 'github-lists', 4)]);
  try {
    const { order, text } = await report(s);
    const at = (name) => order.findIndex((o) => o.startsWith(name));
    assert.ok(at('plugins.mjs:github-lists') >= 0, order.join(','));
    assert.ok(at('plugins.mjs:github-lists') < at('scan.mjs'));
    assert.ok(at('scan.mjs') < at('merge-post.mjs'));
    assert.ok(at('merge-post.mjs') < at('prefilter.mjs'));
    assert.match(text, /handshake\D{0,12}3\b/);
    assert.match(text, /github-lists\D{0,12}2\b/);
    for (let n = 1; n <= 5; n++) assert.ok(text.includes(`${jobUrl(n)} | Example Robotics | Data Intern ${n}`), `row ${n} listed`);
  } finally {
    s.cleanup();
  }
});

// M-002-S2
test('M-002-S2 with 25 untriaged rows it prints exactly 20 and one line naming 5 more', async () => {
  const s = setup(rows(25, 'handshake'));
  try {
    const { out } = await report(s);
    assert.equal(out.filter((l) => l.includes('https://example.com/jobs/')).length, 20);
    const more = out.filter((l) => /\bmore\b/i.test(l));
    assert.equal(more.length, 1, out.join('\n'));
    assert.match(more[0], /\b5\b/);
  } finally {
    s.cleanup();
  }
});

// M-002-S21
test('M-002-S21 with exactly 20 untriaged rows it prints 20 and no remainder line', async () => {
  const s = setup(rows(20, 'handshake'));
  try {
    const { out } = await report(s);
    assert.equal(out.filter((l) => l.includes('https://example.com/jobs/')).length, 20);
    assert.equal(out.filter((l) => /\bmore\b/i.test(l)).length, 0, out.join('\n'));
  } finally {
    s.cleanup();
  }
});

// M-002-S3
test('M-002-S3 without config/student.yml it prints the INTERVIEW line, exits 1 and runs no upstream script', () => {
  const s = setup([]);
  try {
    rmSync(join(s.up.root, 'config', 'student.yml'));
    const r = cli(s);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout + r.stderr, /INTERVIEW/);
    assert.deepEqual(s.up.calls(), []);
  } finally {
    s.cleanup();
  }
});

// M-002-S24
test('M-002-S24 an empty staging feed and no Pending rows prints zero counts, no untriaged Pending rows, exit 0', () => {
  const s = setup([]);
  try {
    const r = cli(s);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /no untriaged Pending rows/);
    assert.match(r.stdout, /\b0\b/);
    assert.equal(s.up.calls().length, 2, 'github-lists and scan ran');
  } finally {
    s.cleanup();
  }
});
