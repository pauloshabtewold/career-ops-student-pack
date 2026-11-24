// M-007 fix round 1, S-7: the token report puts the plumbing rows in their own table in tokens per fixture sample, adds
// the real-use column from the 2026-11-23 live verify, and opens with the plain sentence about per-call steps and calls
// avoided. writeReport only renders text from the shipped verdicts and baseline: no model call, no file written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LIVE_VERIFY, writeReport } from '../../tools/lever-ab.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

test('S-7 the report opens with the headline, has a real-use column and puts plumbing rows in tokens per fixture sample', async () => {
  const md = await writeReport({ root: PACK_ROOT });
  const lines = md.split('\n');
  assert.match(lines[2], /^The daily per-call model steps .* cost the same per call as before.*calls avoided \(T1, T13, T4, T7, T16\)\.$/);
  const header = lines.find((l) => l.startsWith('| Feature | Step | Claude tokens per call before'));
  assert.ok(header.includes(`| Real use (live verify, ${LIVE_VERIFY.date}) |`), header);
  const plumbing = md.slice(md.indexOf('## Plumbing rows'));
  assert.match(plumbing, /\| Claude tokens per fixture sample before \| Claude after \| Codex tokens per fixture sample before \|/);
  for (const id of ['setup', 'M1', 'M12']) {
    assert.ok(plumbing.split('\n').some((l) => l.startsWith(`| ${id} |`)), `${id} is a plumbing row`);
    assert.ok(!md.slice(0, md.indexOf('## Plumbing rows')).split('\n').some((l) => l.startsWith(`| ${id} |`)), `${id} is not in the per-call table`);
  }
  const row = (start) => lines.find((l) => l.startsWith(start)) ?? '';
  assert.ok(row('| M1 | triage of unchanged postings |').includes('11,681'), 'triage real use');
  assert.ok(row('| G7 | tailor resume |').includes('3,339 and 3,491 per call'));
  assert.ok(row('| G4 | outreach lessons (weekly) |').includes('3,794 per call'));
  assert.ok(row('| G3 | outcome classify |').includes('no call'));
});

test('S-7 the shipped docs/token-report.md is the rendered report', async () => {
  assert.equal(readFileSync(join(PACK_ROOT, 'docs', 'token-report.md'), 'utf8'), await writeReport({ root: PACK_ROOT }));
});
