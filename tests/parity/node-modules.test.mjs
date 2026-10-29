// W-011-S5 the scratch copy of a checkout with no node_modules of its own (a git worktree inside a checkout) gets a
// link to the node_modules Node would resolve from the original, so the baseline cycle can import its dependencies.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { linkType, runParity } from '../../tools/parity.mjs';
import { makeSource, makeStudentConfig, okRunner, tmp, cleanupTmp } from './_source.mjs';

after(cleanupTmp);

test('W-011-S5 the baseline copy links the nearest ancestor node_modules when the source has none', async () => {
  const parent = tmp('parity-parent-');
  mkdirSync(join(parent, 'node_modules', 'fake-dep'), { recursive: true });
  writeFileSync(join(parent, 'node_modules', 'fake-dep', 'index.js'), 'module.exports = 1;\n');
  const source = join(parent, 'worktree');
  cpSync(makeSource(), source, { recursive: true });
  const scratch = join(tmp('parity-nm-run-'), 'work');
  const report = join(tmp('parity-nm-report-'), 'report.md');
  const argv = ['--source', source, '--scratch', scratch, '--student-config', makeStudentConfig(), '--report', report, '--today', '2026-10-27'];
  const seen = [];
  const runner = async (call) => {
    if (call.stage === 'cycle' && call.side === 'baseline') seen.push(existsSync(join(call.cwd, 'node_modules', 'fake-dep', 'index.js')));
    return okRunner(call);
  };
  const code = await runParity(argv, { stageRunner: runner, proc: new EventEmitter(), exit: () => {} });
  assert.deepEqual(seen, [true]);
  assert.equal(code, 0);
});

test('W-011-S5 the link is a junction on Windows and a dir symlink elsewhere', () => {
  assert.equal(linkType('win32'), 'junction');
  assert.equal(linkType('darwin'), 'dir');
  assert.equal(linkType('linux'), 'dir');
});
