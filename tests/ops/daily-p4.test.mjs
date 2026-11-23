// Keep (M-005): scripts/daily.mjs stays a zero-token run that always exits 0, also after the P4 digest change.
// tests/ops/daily.test.mjs is locked since M-008, so this check lives here. Fake claude and codex executables at the
// front of PATH record any call into a marker file; the fake upstream's scan step fails. No real agent can be reached.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT, jobUrl, line, pipelineText } from '../helpers/script-harness.mjs';

// M-005-S12-osdr
test('M-005-S12-osdr daily.mjs makes zero model calls and always exits 0', () => {
  const up = createFakeUpstream();
  try {
    const data = join(up.root, 'data');
    writeFileSync(join(up.root, 'config', 'student.yml'), 'timezone: America/Chicago\nautomation: scheduled-discovery\nagent: claude\npresets: []\n');
    writeFileSync(join(data, 'pipeline.md'), pipelineText({ pending: [line(jobUrl(1), 'Northwind Robotics', 'Data Intern', 'Remote', 'triage=4.0')] }));
    const bin = join(up.root, 'fake-bin');
    const marker = join(up.root, 'model-calls.txt');
    mkdirSync(bin);
    for (const name of ['claude', 'codex']) {
      const file = join(bin, name);
      writeFileSync(file, `#!/bin/sh\necho ${name} >> "${marker}"\nexit 0\n`);
      chmodSync(file, 0o755);
    }
    up.setOutput('scan', 'scan: fake failure\n', 1);
    const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ''}` };
    for (const today of ['2026-10-27', '2026-11-01']) {
      const argv = [join(PACK_ROOT, 'scripts', 'daily.mjs'), '--root', up.root, '--data-dir', data, '--today', today];
      const res = spawnSync(process.execPath, argv, { cwd: PACK_ROOT, encoding: 'utf8', timeout: 120000, env });
      assert.equal(res.status, 0, `${today}: ${res.stderr}`);
      assert.ok(existsSync(join(data, 'digest', `student-${today}.md`)), `${today}: the digest is written`);
    }
    assert.equal(existsSync(marker) ? readFileSync(marker, 'utf8') : '', '', 'no claude or codex call');
  } finally {
    rmSync(up.root, { recursive: true, force: true });
  }
});
