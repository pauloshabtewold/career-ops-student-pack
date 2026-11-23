// Assumed (M-005): scripts/daily.mjs writes data/digest/student-<date>.md through lib/digest.mjs, and the digest holds a
// line with the day's estimated tokens (lib/usage-cost.mjs perDayEstimate) labelled as an estimate. Fake upstream only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';
import { PACK_ROOT, jobUrl, line, pipelineText } from '../helpers/script-harness.mjs';

const DAY = '2026-10-27';

// M-005-S6-osdr
test('M-005-S6-osdr the digest shows the day\'s estimated tokens labelled estimate', () => {
  const up = createFakeUpstream();
  try {
    writeFileSync(join(up.root, 'config', 'student.yml'), 'timezone: America/Chicago\nautomation: scheduled-discovery\npresets: []\n');
    writeFileSync(join(up.root, 'data', 'pipeline.md'), pipelineText({ pending: [line(jobUrl(1), 'Northwind Robotics', 'Data Intern', 'Remote', 'triage=4.0')] }));
    const argv = [join(PACK_ROOT, 'scripts', 'daily.mjs'), '--root', up.root, '--data-dir', join(up.root, 'data'), '--today', DAY];
    const res = spawnSync(process.execPath, argv, { cwd: PACK_ROOT, encoding: 'utf8', timeout: 120000 });
    assert.equal(res.status, 0, res.stderr);
    const digest = readFileSync(join(up.root, 'data', 'digest', `student-${DAY}.md`), 'utf8');
    const lines = digest.split('\n').filter((l) => /estimate/i.test(l) && /\d[\d,.]*\s*k?\s*tokens/i.test(l));
    assert.equal(lines.length, 1, `one estimated-tokens line labelled estimate:\n${digest}`);
  } finally {
    rmSync(up.root, { recursive: true, force: true });
  }
});
