// Assumed: SECURITY.md at the pack root is the vulnerability reporting policy. String checks only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

// M-004-S9-cdel
test('M-004-S9-cdel SECURITY.md points reporters to private vulnerability reporting, never a public issue, and names the latest release', () => {
  const file = join(PACK_ROOT, 'SECURITY.md');
  assert.ok(existsSync(file), 'SECURITY.md exists');
  const text = readFileSync(file, 'utf8');
  assert.match(text, /private vulnerability reporting/i);
  assert.match(text, /Report a vulnerability/);
  assert.match(text, /never[^\n]*public issue/i);
  assert.match(text, /latest release[^\n]*supported|supported[^\n]*latest release/i);
  assert.doesNotMatch(text, /[–—‘’“”]/, 'plain punctuation');
});
