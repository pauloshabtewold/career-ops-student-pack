// Assumed (M-005): scripts/schedule.mjs exports PAUSE_FILE and pauseCommand(command, dataDir); 'pause' sets the pause
// marker data/<PAUSE_FILE> and 'resume' clears it, without touching the installed jobs. scripts/scheduled.mjs
// scheduledRun({ root, packRoot, passThrough, dataDir, today, runner, out }) starts no child while paused, and the
// scheduled.mjs CLI exits 0. Synthetic scratch roots only; the fake runner never starts a process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PAUSE_FILE, pauseCommand } from '../../scripts/schedule.mjs';
import { scheduledRun } from '../../scripts/scheduled.mjs';
import { makeRoot, PACK_ROOT, TODAY, runScript } from '../helpers/script-harness.mjs';

async function runScheduled(r) {
  const calls = [];
  const runner = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return '';
  };
  await scheduledRun({ root: r.root, packRoot: PACK_ROOT, passThrough: [], dataDir: r.data, today: TODAY, runner, out: () => {} });
  return calls.map((c) => basename(String(c.args[0])));
}

// M-005-S1-osdr
test('M-005-S1-osdr pause makes scheduled.mjs exit 0 with no child started and resume restores the run', async () => {
  const r = makeRoot({ config: 'automation: scheduled-discovery\n' });
  try {
    await pauseCommand('pause', r.data);
    assert.ok(existsSync(join(r.data, PAUSE_FILE)), 'pause sets the pause marker');
    assert.deepEqual(await runScheduled(r), [], 'no child starts while paused');
    const cli = runScript('scheduled', [], r);
    assert.equal(cli.code, 0, cli.stderr);
    assert.equal(r.exists(`data/digest/student-${TODAY}.md`), false, 'the paused CLI ran no daily step');

    await pauseCommand('resume', r.data);
    assert.equal(existsSync(join(r.data, PAUSE_FILE)), false, 'resume clears the pause marker');
    assert.ok((await runScheduled(r)).includes('daily.mjs'), 'the daily run starts again after resume');
  } finally {
    r.cleanup();
  }
});
