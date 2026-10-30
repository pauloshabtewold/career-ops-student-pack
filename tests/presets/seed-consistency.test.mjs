import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const dir = join(PACK_ROOT, 'presets');

const sortKeys = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);

test('the same seed name has the same careers_url, provider and provider config in every preset', () => {
  const byName = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yml') && f !== 'OWNERS.yml')) {
    const doc = yaml.load(readFileSync(join(dir, file), 'utf8'));
    for (const seed of doc.seed_employers ?? []) {
      if (!byName.has(seed.name)) byName.set(seed.name, new Map());
      const urls = byName.get(seed.name);
      // W-019: the provider and its config count as part of the board, so they must agree too.
      const board = JSON.stringify(sortKeys(seed));
      if (!urls.has(board)) urls.set(board, []);
      urls.get(board).push(file);
    }
  }
  const conflicts = [];
  for (const [name, urls] of byName) {
    if (urls.size > 1) {
      conflicts.push(`${name}: ${[...urls].map(([u, files]) => `${u} (${files.join(', ')})`).join(' vs ')}`);
    }
  }
  assert.deepEqual(conflicts, []);
});
