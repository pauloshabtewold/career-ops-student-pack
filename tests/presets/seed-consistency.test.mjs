import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const dir = join(PACK_ROOT, 'presets');

test('the same seed name has the same careers_url in every preset', () => {
  const byName = new Map();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.yml') && f !== 'OWNERS.yml')) {
    const doc = yaml.load(readFileSync(join(dir, file), 'utf8'));
    for (const seed of doc.seed_employers ?? []) {
      if (!byName.has(seed.name)) byName.set(seed.name, new Map());
      const urls = byName.get(seed.name);
      if (!urls.has(seed.careers_url)) urls.set(seed.careers_url, []);
      urls.get(seed.careers_url).push(file);
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
