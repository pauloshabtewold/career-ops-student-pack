import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import * as parity from '../../tools/parity.mjs';
import { tmp, cleanupTmp } from './_source.mjs';

after(cleanupTmp);

// M-002-S3
test('scratchOverlap returns inside, contains or null', () => {
  const base = tmp();
  const guarded = join(base, 'pack');
  const other = join(base, 'other');
  mkdirSync(guarded, { recursive: true });
  mkdirSync(other, { recursive: true });
  assert.equal(parity.scratchOverlap(join(guarded, 'work'), [guarded, other]), 'inside');
  assert.equal(parity.scratchOverlap(guarded, [guarded]), 'inside');
  assert.equal(parity.scratchOverlap(base, [guarded, other]), 'contains');
  assert.equal(parity.scratchOverlap(join(base, 'apart'), [guarded, other]), null);
  assert.equal(parity.scratchOverlap(join(base, 'apart'), []), null);
});
