// first-run.mjs --queue still prints the queue when a preset cannot be read, and says the upcoming section is left out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { firstRun } from '../../scripts/first-run.mjs';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT, TODAY, jobUrl, line, pipelineText } from '../helpers/script-harness.mjs';

test('extra check: --queue names the preset error and keeps the queue lines', async () => {
  const up = createFakeUpstream();
  try {
    writeFileSync(join(up.root, 'config', 'student.yml'), 'timezone: America/Chicago\npresets: [../tests/fixtures/bad-preset]\n');
    writeFileSync(join(up.root, 'data', 'pipeline.md'), pipelineText({ pending: [line(jobUrl(1), 'Co 1', 'Data Intern 1', 'Remote', 'src=handshake; imported=2026-10-11')] }));
    const out = [];
    const code = await firstRun({ root: up.root, dataDir: join(up.root, 'data'), packRoot: PACK_ROOT, today: TODAY, queue: true, runner: () => '{}', out: (l) => out.push(String(l)) });
    assert.equal(code, 0, out.join('\n'));
    assert.ok(out.includes('queue: 1 postings waiting'), out.join('\n'));
    assert.ok(out.some((l) => /^upcoming section left out: preset \.\.\/tests\/fixtures\/bad-preset/.test(l)), out.join('\n'));
  } finally {
    rmSync(up.root, { recursive: true, force: true });
  }
});
