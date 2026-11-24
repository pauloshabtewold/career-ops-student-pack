// M-007 fix round 2, N2-1 (d): a row with no job text from any source is never batch-ready; it is kept out with "no
// job text" before any resume render or model call, while a row with text in the same run is batched. Injected fakes
// only; no browser, network or model. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBatch } from '../../lib/batch-file.mjs';
import { fillPlans } from '../../scripts/fill-plan.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const WITH = 'https://boards.greenhouse.io/examplerobotics/jobs/7401';
const WITHOUT = 'https://boards.greenhouse.io/examplelabs/jobs/7402';

// M-007-fix2-N2-1g
test('M-007-fix2-N2-1g a row with no job text is kept out as "no job text" with no render or call; a row with text is batched', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-fix2-strict-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\n');
  writeFileSync(join(root, 'config', 'profile.yml'), 'candidate:\n  full_name: "Jordan Testwell"\n  email: "jordan.testwell@example.com"\n');
  writeFileSync(join(root, 'cv.md'), '# Jordan Testwell\n\njordan.testwell@example.com\n\n## Skills\nPython\n');
  try {
    const built = [];
    let calls = 0;
    const said = [];
    const deps = {
      fetchJob: async (row) => (row.url === WITH ? 'Example Robotics hires an intern to build Python tools. Requirements: Python.' : ''),
      headless: async () => {
        calls++;
        return { text: '' };
      },
      buildResume: async (o) => {
        built.push(o.outDir);
        mkdirSync(o.outDir, { recursive: true });
        writeFileSync(join(o.outDir, 'resume.html'), '<html><body>Jordan Testwell</body></html>');
        writeFileSync(join(o.outDir, 'resume.pdf'), '%PDF-1.4\n%%EOF\n');
        return { code: 0, html: join(o.outDir, 'resume.html'), pdf: join(o.outDir, 'resume.pdf') };
      },
      atsCheck: async () => ({ ok: true, problems: [] }),
    };
    const rows = [
      { url: WITHOUT, company: 'Example Labs', title: 'Data Intern', score: 40, triage: 3.8 },
      { url: WITH, company: 'Example Robotics', title: 'Software Intern', score: 41, triage: 3.9 },
    ];
    const res = await fillPlans({ paths: { root, dataDir, packRoot: PACK_ROOT }, rows, today: '2026-11-03', deps, say: (l) => said.push(l) });
    assert.equal(res.ready, 1);
    assert.deepEqual(readBatch(dataDir, res.ids[0]).items.map((i) => i.link), [WITH]);
    assert.ok(said.some((l) => l.includes('Example Labs') && /flagged: no job text/.test(l)), said.join('\n'));
    assert.equal(built.length, 1, 'only the row with job text was rendered');
    assert.equal(calls, 0, 'no model call (lean path, no letter slot)');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
