// firstRun reports a failing ingest step as a FAILED line, keeps going and still returns 0 with the report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { firstRun } from '../../scripts/first-run.mjs';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT, TODAY, pipelineText } from '../helpers/script-harness.mjs';
import { defaultRunner } from '../../lib/upstream.mjs';

test('a step whose runner throws prints one FAILED line with the first stderr line and the run still reports', async () => {
  const up = createFakeUpstream();
  try {
    writeFileSync(join(up.root, 'config', 'student.yml'), 'timezone: America/Chicago\npresets: []\n');
    writeFileSync(join(up.root, 'data', 'pipeline.md'), pipelineText({}));
    writeFileSync(join(up.root, 'data', 'pipeline.staging.md'), '');
    writeFileSync(join(up.root, 'data', 'applications.md'), '# Applications\n');
    const runner = (cmd, args, opts) => {
      if (basename(args[0]) === 'plugins.mjs') throw Object.assign(new Error('Command failed'), { stderr: 'plugin host refused\nsecond line' });
      return defaultRunner(cmd, args, opts);
    };
    const out = [];
    const code = await firstRun({ root: up.root, dataDir: join(up.root, 'data'), packRoot: PACK_ROOT, today: TODAY, runner, out: (l) => out.push(String(l)) });
    assert.equal(code, 0);
    assert.ok(out.includes('first-run: github-lists FAILED (plugin host refused)'), out.join('\n'));
    assert.ok(out.some((l) => /^first-run: scan ok/.test(l)), 'later steps still ran');
    assert.ok(out.includes('no untriaged Pending rows'), out.join('\n'));
  } finally {
    rmSync(up.root, { recursive: true, force: true });
  }
});
