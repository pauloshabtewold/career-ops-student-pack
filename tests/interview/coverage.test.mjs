// Assumed: interview/coverage.mjs exports coverageLine(presetIds, { today, owners }) -> string or string[] (one line per
// preset), possibly async. `owners` overrides presets/OWNERS.yml as { id: { owner, last_reviewed } }; `today` is YYYY-MM-DD.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { coverageLine } from '../../interview/coverage.mjs';
import { loadPreset } from '../../lib/presets.mjs';
import { PACK_ROOT, TODAY } from '../helpers/script-harness.mjs';

const IDS = readdirSync(join(PACK_ROOT, 'presets')).filter((f) => f.endsWith('.yml') && f !== 'OWNERS.yml').map((f) => f.slice(0, -4)).sort();
const fresh = Object.fromEntries(IDS.map((id) => [id, { owner: 'pack-maintainer', last_reviewed: '2026-10-01' }]));
const lines = async (ids, owners = fresh) => {
  const out = await coverageLine(ids, { today: TODAY, owners });
  return (Array.isArray(out) ? out : String(out).split('\n')).filter((l) => l.trim());
};

// M-006-S6 (M-001-S8: IDS follows the presets/ directory scan)
test('M-006-S6 one line per preset carrying its coverage level and note', async () => {
  for (const id of IDS.filter((i) => i !== 'byo-employer-list')) {
    const p = loadPreset(id);
    const [line, ...more] = await lines([id]);
    assert.equal(more.length, 0, id);
    assert.ok(line.includes(p.coverage.level), `${id} level`);
    assert.ok(line.includes(p.coverage.note), `${id} note`);
    assert.doesNotMatch(line, /unmaintained/i, id);
  }
  assert.equal((await lines(['software-cs', 'finance-economics'])).length, 2);
});

test('M-006-S6 the nursing answer set gets the discovery-only line that says discovery help, not automation', async () => {
  const nursing = JSON.parse(readFileSync(join(PACK_ROOT, 'tests', 'fixtures', 'answers', 'nursing.json'), 'utf8'));
  const [line] = await lines(nursing.presets);
  assert.match(line, /discovery[- ]only/i);
  assert.match(line, /discovery help/i);
  assert.match(line, /not automation/i);
});

// M-006-S7
test('M-006-S7 a preset with no owner is labeled unmaintained', async () => {
  const owners = { ...fresh };
  delete owners['accounting'];
  const [line] = await lines(['accounting'], owners);
  assert.match(line, /unmaintained/i);
  const [other] = await lines(['software-cs'], owners);
  assert.doesNotMatch(other, /unmaintained/i);
});

test('M-006-S7 last_reviewed older than 60 days is unmaintained, 56 days is not', async () => {
  const stale = { 'software-cs': { owner: 'pack-maintainer', last_reviewed: '2026-08-01' } };
  const ok = { 'software-cs': { owner: 'pack-maintainer', last_reviewed: '2026-09-01' } };
  assert.match((await lines(['software-cs'], stale))[0], /unmaintained/i);
  assert.doesNotMatch((await lines(['software-cs'], ok))[0], /unmaintained/i);
});

// W-011-S3 the BYO note already opens with the discovery lead, so the line says it once.
test('W-011-S3 the byo-employer-list coverage line says discovery help, not automation exactly once', async () => {
  const [line, ...more] = await lines(['byo-employer-list']);
  assert.equal(more.length, 0);
  assert.equal(line.match(/Discovery help, not automation/gi)?.length, 1, line);
  assert.ok(line.includes('[discovery-only]'));
});
