// scripts/cover.mjs writeCover: role-family base from templates/cover plus one tailored paragraph that passes the fact
// gate and clean-text. The headless call is a fake (no agent runs); fake person and companies only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const CV = '# Jordan Testwell\n\n## Experience\n- Software Intern, Example Robotics, Jun 2025 - Aug 2025: built a Python scheduling tool\n\n## Skills\nPython, SQL\n';
const POSTING = 'Example Robotics is hiring a Software Engineering Intern to build Python tools with SQL.';
const RAW = 'At Example Robotics I built a Python scheduling tool — the team’s “fast” favorite.';

// M-002-S4-osdr
test('M-002-S4-osdr cover.mjs returns the family base plus one paragraph that passes the fact gate and clean-text', async () => {
  const { PARAGRAPH_WORDS, familyFor, paragraphPrompt, writeCover } = await import('../../scripts/cover.mjs');
  assert.equal(PARAGRAPH_WORDS, 90);
  assert.equal(familyFor(['software-cs']), 'software');
  assert.equal(familyFor(['no-such-preset']), 'general');
  assert.match(paragraphPrompt({ cv: CV, posting: POSTING, company: 'Example Robotics', role: 'Software Engineering Intern' }), /90/);

  const dataDir = mkdtempSync(join(tmpdir(), 'pack-cover-'));
  try {
    const calls = [];
    const headless = async (opts) => {
      calls.push(opts);
      return { text: RAW, usage: null, model: 'sonnet' };
    };
    const res = await writeCover({ cv: CV, posting: POSTING, answers: {}, company: 'Example Robotics', role: 'Software Engineering Intern', presets: ['software-cs'], signature: 'Jordan Testwell', dataDir, date: '2026-11-03', headless });
    assert.equal(calls.length, 1, 'one paragraph call when the fact gate passes');
    const path = typeof res === 'string' ? res : res?.path;
    assert.ok(path && existsSync(path), `letter path returned: ${JSON.stringify(res)}`);
    const letter = readFileSync(path, 'utf8');

    const base = readFileSync(join(PACK_ROOT, 'templates', 'cover', 'software.md'), 'utf8');
    for (const slot of ['{company}', '{role}', '{paragraph}', '{signature}']) assert.ok(base.includes(slot), `software base holds ${slot}`);
    for (const chunk of base.split(/\{(?:company|role|paragraph|signature)\}/).map((c) => c.trim()).filter(Boolean)) {
      assert.ok(letter.includes(chunk), `letter keeps the base text: ${chunk.slice(0, 60)}`);
    }
    assert.ok(!/\{(company|role|paragraph|signature)\}/.test(letter), 'every slot filled');
    assert.ok(letter.includes('Example Robotics') && letter.includes('Software Engineering Intern') && letter.includes('Jordan Testwell'));
    assert.ok(letter.includes('At Example Robotics I built a Python scheduling tool'), letter);
    assert.ok(!/[—–‘’“”]/.test(letter), 'clean-text removed curly quotes and long dashes');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
