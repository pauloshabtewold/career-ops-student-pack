// Guided-messages lint, P2 additions. tests/ops/guided-messages.test.mjs is locked since M-002,
// so P2 files are linted here with the same rule instead of being appended to its LINTED list.
// Importing that file would register its tests a second time, so the 4-line rule is repeated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const fromFile = (rel) => ({ name: rel, read: async () => readFileSync(join(PACK_ROOT, rel), 'utf8') });

export const LINTED_P2 = [fromFile('modes/fresh-jobs.md')];

const LINE_PREFIXES = ['Next:', 'Type:', 'Why:'];

// Same rule as lintGuided in guided-messages.test.mjs: null when the text holds every guided line.
function lintGuided(name, text) {
  const lines = String(text).split('\n').map((l) => l.replace(/^[\s>*_-]+/, '').replace(/^\*\*(Next|Type|Why):\*\*/, '$1:'));
  const missing = LINE_PREFIXES.filter((p) => !lines.some((l) => l.startsWith(p)));
  return missing.length ? `${name}: missing the ${missing.join(', ')} line${missing.length > 1 ? 's' : ''}` : null;
}

// M-003-S12-osdr
test('M-003-S12-osdr the guided-messages lint list from P2 adds modes/fresh-jobs.md and it passes', async () => {
  const entry = LINTED_P2.find((e) => e.name === 'modes/fresh-jobs.md');
  assert.ok(entry, 'modes/fresh-jobs.md is in the lint list');
  let text;
  try {
    text = await entry.read();
  } catch (err) {
    assert.fail(`modes/fresh-jobs.md: ${err.message}`);
  }
  assert.equal(lintGuided(entry.name, text), null);
});
