// W-024 A4-9: first-run.mjs --list-only prints the counts and the rows without running any ingest step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { firstRun } from '../../scripts/first-run.mjs';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT, TODAY, jobUrl, line, pipelineText } from '../helpers/script-harness.mjs';

function setup(n) {
  const up = createFakeUpstream();
  writeFileSync(join(up.root, 'config', 'student.yml'), 'timezone: America/Chicago\npresets: []\n');
  const pending = Array.from({ length: n }, (_, i) => line(jobUrl(i + 1), 'Example Robotics', `Data Intern ${i + 1}`, 'Remote', 'src=handshake; imported=2026-10-27'));
  writeFileSync(join(up.root, 'data', 'pipeline.md'), pipelineText({ pending }));
  return { up, data: join(up.root, 'data'), cleanup: () => rmSync(up.root, { recursive: true, force: true }) };
}

test('W-024-A49 listOnly runs no runner step and still lists counts and rows', async () => {
  const s = setup(3);
  try {
    const ran = [];
    const out = [];
    const code = await firstRun({ root: s.up.root, dataDir: s.data, packRoot: PACK_ROOT, today: TODAY, listOnly: true, runner: (...a) => { ran.push(a); return { status: 0, stdout: '', stderr: '' }; }, out: (l) => out.push(String(l)) });
    assert.equal(code, 0);
    assert.deepEqual(ran, []);
    const text = out.join('\n');
    assert.ok(!/first-run: \w/.test(text), text);
    assert.match(text, /Pending rows: 3/);
    for (let n = 1; n <= 3; n++) assert.ok(text.includes(`${jobUrl(n)} | Example Robotics | Data Intern ${n}`), `row ${n}`);
  } finally {
    s.cleanup();
  }
});

test('W-024-A49 the --list-only CLI flag is accepted, lists rows and calls no upstream script', () => {
  const s = setup(2);
  try {
    const r = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'first-run.mjs'), '--root', s.up.root, '--data-dir', s.data, '--today', TODAY, '--list-only'], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /Untriaged Pending rows: 2/);
    assert.ok(r.stdout.includes(`${jobUrl(1)} | Example Robotics | Data Intern 1`));
    assert.deepEqual(s.up.calls(), []);
  } finally {
    s.cleanup();
  }
});
