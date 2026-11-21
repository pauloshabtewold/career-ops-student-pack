// lib/fact-gate.mjs check(text, sources) and scripts/cover.mjs writeCover regenerating once on a fact-gate failure.
// The headless call is a fake (no agent runs). Sources shape (ruling): { cv, answers, posting } as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CV = '# Jordan Testwell\n\n## Experience\n- Software Intern, Example Robotics, Jun 2025 - Aug 2025: built a Python scheduling tool\n\n## Skills\nPython, SQL\n';
const POSTING = 'Example Robotics is hiring a Software Engineering Intern. You will write Python and SQL.';
const BAD = 'At Initech Global I led a Python project for the platform team and shipped it on time.';

// M-002-S20-osdr
test('M-002-S20-osdr a cover paragraph naming an employer absent from cv.md is regenerated once then flagged', async () => {
  const { check } = await import('../../lib/fact-gate.mjs');
  const sources = { cv: CV, answers: 'work_authorization: US citizen', posting: POSTING };
  assert.ok(check(BAD, sources).includes('Initech Global'), 'the unknown employer is reported');
  assert.deepEqual(check('At Example Robotics I built a Python scheduling tool.', sources), []);

  const { writeCover } = await import('../../scripts/cover.mjs');
  const dataDir = mkdtempSync(join(tmpdir(), 'pack-fact-gate-'));
  try {
    const calls = [];
    const headless = async (opts) => {
      calls.push(opts);
      return { text: BAD, usage: null, model: 'sonnet' };
    };
    const res = await writeCover({ cv: CV, posting: POSTING, answers: {}, company: 'Example Robotics', role: 'Software Engineering Intern', presets: ['software-cs'], signature: 'Jordan Testwell', dataDir, date: '2026-11-03', headless });
    assert.equal(calls.length, 2, 'one draft plus exactly one regeneration');
    const flags = res?.flags ?? [];
    assert.ok(res?.flagged === true || flags.length > 0, `the letter is flagged: ${JSON.stringify(res)}`);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
