// Assumed: drafts mode hands the student a file in their own folder, never a temp or scratchpad path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

test('outreach drafts mode names data/outreach/drafts- and forbids temp paths', () => {
  const text = readFileSync(join(PACK_ROOT, 'modes/outreach.md'), 'utf8');
  const section = /## Drafts mode\n([\s\S]*)$/.exec(text)?.[1] ?? '';
  assert.match(section, /data\/outreach\/drafts-YYYY-MM-DD\.md/);
  assert.match(section, /Never point the user at a temp or scratchpad path/);
});
