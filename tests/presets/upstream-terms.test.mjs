// Every preset title rule has to reach upstream's substring title_filter; apply-answers drops a rule it cannot rewrite
// as literal terms and tells the student, which the W-015 walkthrough hit with software-cs "full.?stack".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadPreset, toUpstreamTerms } from '../../lib/presets.mjs';
import { PACK_ROOT } from '../helpers/budget-harness.mjs';

const ids = readdirSync(join(PACK_ROOT, 'presets')).filter((f) => f.endsWith('.yml') && f !== 'OWNERS.yml').map((f) => f.replace(/\.yml$/, ''));

// W-015-P1
test('W-015-P1 every preset title rule converts to upstream title terms', () => {
  const skipped = [];
  for (const id of ids) {
    const rules = loadPreset(id).title_rules ?? {};
    for (const kind of ['include', 'exclude']) for (const r of rules[kind] ?? []) skipped.push(...toUpstreamTerms(r).skipped.map((s) => `${id} ${kind} ${s}`));
  }
  assert.deepEqual(skipped, []);
});

// W-015-P1
test('W-015-P1 software-cs full stack rule reaches upstream in all three spellings', () => {
  assert.deepEqual(toUpstreamTerms('full(-| )?stack').terms.sort(), ['full stack', 'full-stack', 'fullstack']);
});
