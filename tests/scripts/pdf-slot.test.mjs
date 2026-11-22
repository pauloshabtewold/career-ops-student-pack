// build-resume runs the browser-slot command before any generate-pdf spawn: exit 0 renders, exit 1 or 2 returns 4
// (waiting) and spawns nothing. Fake slot commands and a recording runner; no browser runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('M-002 build-resume spawns generate-pdf only after the slot command exits 0; exit 1 or 2 waits with code 4', async () => {
  const { buildResume, EXIT_WAIT } = await import('../../scripts/build-resume.mjs');
  assert.equal(EXIT_WAIT, 4);
  const dir = mkdtempSync(join(tmpdir(), 'pack-pdf-slot-'));
  try {
    writeFileSync(join(dir, 'cv.md'), '# Casey Sample\n\n## Education\nB.S. Fake Studies, Example State University, May 2027\n');
    for (const [slotExit, want, spawns] of [[0, 0, 1], [1, 4, 0], [2, 4, 0]]) {
      const calls = [];
      const runner = (...a) => (calls.push(a), { code: 0, stdout: '', stderr: '' });
      const seen = [];
      const runSlot = (cmd) => (seen.push(cmd), slotExit);
      const res = buildResume({ root: dir, cvFile: join(dir, 'cv.md'), outDir: join(dir, 'out'), env: { BROWSER_SLOT_CMD: 'fake-slot' }, runner, runSlot });
      assert.deepEqual(seen, ['fake-slot']);
      assert.equal(res.code, want, `slot exit ${slotExit}`);
      assert.equal(calls.length, spawns, `slot exit ${slotExit}: generate-pdf spawns`);
      if (want === 4) assert.match(res.error, /waiting for a browser slot/);
    }
    const fromConfig = [];
    buildResume({ root: dir, cvFile: join(dir, 'cv.md'), outDir: join(dir, 'out'), env: {}, config: { browser: { slot_cmd: 'cfg-slot' } }, runner: () => ({ code: 0 }), runSlot: (c) => (fromConfig.push(c), 1) });
    assert.deepEqual(fromConfig, ['cfg-slot'], 'config browser.slot_cmd is the fallback');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M-002 build-resume CLI exits 4 with one waiting line when the slot command refuses', async () => {
  const { spawnSync } = await import('node:child_process');
  const { PACK_ROOT } = await import('../helpers/script-harness.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'pack-pdf-slot-cli-'));
  try {
    writeFileSync(join(dir, 'cv.md'), '# Casey Sample\n\n## Education\nB.S. Fake Studies, Example State University, May 2027\n');
    const r = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'build-resume.mjs'), '--cv', join(dir, 'cv.md'), '--out', join(dir, 'out'), '--root', dir], { env: { ...process.env, BROWSER_SLOT_CMD: 'false' }, encoding: 'utf8' });
    assert.equal(r.status, 4, r.stdout + r.stderr);
    assert.equal(r.stdout.trim().split('\n').length, 1);
    assert.match(r.stdout, /waiting for a browser slot/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
