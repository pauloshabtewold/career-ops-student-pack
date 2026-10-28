import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CEILINGS } from '../../scripts/budget.mjs';
import { LIMITS } from '../../plugins/github-lists/_limits.mjs';

// M-005-S15
test('M-005-S15 every github-lists limit that has a budget ceiling equals that ceiling', () => {
  const shared = Object.keys(LIMITS).filter((k) => k in CEILINGS);
  assert.ok(shared.length >= 4, `only ${shared.length} shared keys`);
  for (const k of shared) assert.deepEqual(LIMITS[k], CEILINGS[k].value, `limit ${k} differs from its ceiling`);
});
