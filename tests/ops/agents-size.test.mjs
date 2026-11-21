// AGENTS.student.md: the pack block built from it stays under 8192 bytes, with the P1 tools row and approval phrases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_BLOCK_LIMIT, packBlock } from '../../lib/agents-override.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

// M-002-S16-osdr
test('M-002-S16-osdr the AGENTS.student.md pack block stays under 8192 bytes', () => {
  const text = readFileSync(join(PACK_ROOT, 'AGENTS.student.md'), 'utf8');
  assert.equal(PACK_BLOCK_LIMIT, 8192);
  const size = Buffer.byteLength(packBlock(text), 'utf8');
  assert.ok(size < 8192, `pack block is ${size} bytes`);
  const browser = text.split('\n').find((l) => /^\|\s*Browser\s*\|/.test(l));
  assert.ok(browser && browser.includes('chrome.mjs'), `Browser row names chrome.mjs: ${browser}`);
  assert.match(text, /approve all/);
  assert.match(text, /all except/);
});
