// W-029: career-ops 1.39.0 refuses a board response over 10 MB unless the portals.yml entry sets max_response_mb.
// A student who copied a preset's seeds before the pack carried that key keeps the old entry, so update adds the key
// to entries whose careers_url matches a capped preset seed. Synthetic portals.yml text only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as yaml from 'js-yaml';
import { addResponseCaps, presetResponseCaps } from '../../lib/portals-caps.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const caps = new Map([
  ['https://jobs.example.com/big', 32],
  ['https://boards.example.com/huge', 64],
]);

const PORTALS = `# student portals
title_filter:
  positive:
    - analyst
# cycle:portals-neg:start
# cycle:portals-neg:end
tracked_companies:
  - name: Big Co
    careers_url: https://jobs.example.com/big
    enabled: true
  - name: Small Co
    careers_url: https://jobs.example.com/small
    enabled: true
  - careers_url: "https://boards.example.com/huge/"
    name: Huge Co
    enabled: true
`;

test('W-029 addResponseCaps adds max_response_mb to matching entries and keeps comments and other lines', () => {
  const { text, added } = addResponseCaps(PORTALS, caps);
  assert.deepEqual(added, ['Big Co', 'Huge Co']);
  assert.ok(text.includes('# student portals'));
  assert.ok(text.includes('# cycle:portals-neg:start'));
  const doc = yaml.load(text);
  const by = Object.fromEntries(doc.tracked_companies.map((e) => [e.name, e]));
  assert.equal(by['Big Co'].max_response_mb, 32);
  assert.equal(by['Huge Co'].max_response_mb, 64);
  assert.equal('max_response_mb' in by['Small Co'], false);
  assert.deepEqual(doc.title_filter, { positive: ['analyst'] });
  assert.equal(text.split('\n').length, PORTALS.split('\n').length + 2);
});

test('W-029 addResponseCaps leaves an entry that already sets max_response_mb alone and is idempotent', () => {
  const once = addResponseCaps(PORTALS, caps).text;
  const twice = addResponseCaps(once, caps);
  assert.deepEqual(twice.added, []);
  assert.equal(twice.text, once);
  const own = PORTALS.replace('    enabled: true\n  - name: Small Co', '    max_response_mb: 50\n    enabled: true\n  - name: Small Co');
  const res = addResponseCaps(own, caps);
  assert.deepEqual(res.added, ['Huge Co']);
  assert.equal(yaml.load(res.text).tracked_companies[0].max_response_mb, 50);
});

test('W-029 addResponseCaps changes nothing it cannot place exactly: flow entries, disabled entries, no portals', () => {
  const flow = 'tracked_companies:\n  - { name: Big Co, careers_url: "https://jobs.example.com/big", enabled: true }\n';
  assert.deepEqual(addResponseCaps(flow, caps), { text: flow, added: [] });
  const off = 'tracked_companies:\n  - name: Big Co\n    careers_url: https://jobs.example.com/big\n    enabled: false\n';
  assert.deepEqual(addResponseCaps(off, caps), { text: off, added: [] });
  assert.deepEqual(addResponseCaps('', caps), { text: '', added: [] });
  assert.deepEqual(addResponseCaps('title_filter: {}\n', caps), { text: 'title_filter: {}\n', added: [] });
  const broken = 'tracked_companies: [\n';
  assert.deepEqual(addResponseCaps(broken, caps), { text: broken, added: [] });
});

test('W-029 presetResponseCaps maps every capped preset seed careers_url to its max_response_mb', () => {
  const map = presetResponseCaps(PACK_ROOT);
  assert.ok(map.size >= 5, `capped seeds: ${map.size}`);
  assert.equal(map.get('https://jobs.ashbyhq.com/openai') > 10, true);
  for (const mb of map.values()) assert.ok(mb > 10 && mb <= 100);
});
