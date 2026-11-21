// lib/approval-grammar.mjs parse(reply, itemCount): batch approval replies to approved item numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const itemsOf = (r) => (Array.isArray(r) ? r : r?.items);

// M-002-S12-osdr
test('M-002-S12-osdr the reply all except 3 and 7 in all-except form approves every other item', async () => {
  const { parse } = await import('../../lib/approval-grammar.mjs');
  assert.deepEqual(itemsOf(parse('all except 3, 7', 9)), [1, 2, 4, 5, 6, 8, 9]);
  assert.deepEqual(itemsOf(parse('All except 3,7', 8)), [1, 2, 4, 5, 6, 8]);
  assert.deepEqual(itemsOf(parse('approve all', 4)), [1, 2, 3, 4]);
});
