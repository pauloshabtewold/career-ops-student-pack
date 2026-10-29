// Interview-run transcripts must name the presets that ship in presets/ (OWNERS.yml is not a preset).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const SETS = ['cs', 'mis', 'finance', 'mechanical', 'nursing'];
const IDS = readdirSync(join(PACK_ROOT, 'presets')).filter((f) => f.endsWith('.yml') && f !== 'OWNERS.yml').map((f) => f.slice(0, -4)).sort();
const transcript = (k) => readFileSync(join(PACK_ROOT, 'tests', 'fixtures', 'interview-runs', k, 'transcript.md'), 'utf8');
const hasId = (text, id) => new RegExp(`(?<![\\w-])${id}(?![\\w-])`).test(text);

// M-001-S29 keep
test('M-001-S29 the nursing transcript lists every preset id found in presets/', () => {
  assert.ok(IDS.length >= 12, `ids: ${IDS.join(', ')}`);
  const text = transcript('nursing');
  const missing = IDS.filter((id) => !hasId(text, id));
  assert.deepEqual(missing, []);
});

// M-001-S30 keep
for (const k of SETS) {
  test(`M-001-S30 ${k} transcript Preset set: line equals the preset ids and it never says seven presets`, () => {
    const text = transcript(k);
    const header = text.split('\n').find((l) => l.startsWith('Preset set:'));
    assert.ok(header, 'Preset set: line present');
    const listed = header.slice('Preset set:'.length).replace(/\(.*\)/, '').split(/[\s,;]+/).filter((t) => /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(t)).sort();
    assert.deepEqual(listed, IDS);
    assert.doesNotMatch(text, /\bseven (?:field )?presets\b/i);
  });
}
