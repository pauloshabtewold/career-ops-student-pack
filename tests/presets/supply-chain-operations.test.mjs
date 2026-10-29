import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreset } from '../../lib/presets.mjs';
import { isEligible } from '../../plugins/github-lists/_eligibility.mjs';
import { CYCLE } from '../helpers/feed-harness.mjs';

const ID = 'supply-chain-operations';

function check(preset, title) {
  const row = { company: 'Example Logistics', title, location: 'Austin, TX', date: '2026-09-15', url: 'https://example.edu/jobs/1', kind: 'internship' };
  return isEligible(row, { cycle: CYCLE, titleRules: preset.title_rules, earlyCareer: preset.early_career });
}

// M-003-S1
test('M-003-S1 supply-chain-operations validates with 50 to 150 seed employers, each exactly name and careers_url', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, ID);
  const seeds = p.seed_employers;
  assert.ok(seeds.length >= 50 && seeds.length <= 150, `${seeds.length} seed employers`);
  for (const [i, e] of seeds.entries()) {
    assert.deepEqual(Object.keys(e).sort(), ['careers_url', 'name'], `seed ${i}`);
    assert.match(e.careers_url, /^https:\/\//, `seed ${i}`);
  }
});

// M-003-S2
test('M-003-S2 seed names are unique case-insensitively and careers_url values are unique', () => {
  const seen = { name: new Map(), url: new Map() };
  for (const e of loadPreset(ID).seed_employers) {
    const keys = { name: e.name.toLowerCase(), url: e.careers_url };
    for (const [k, v] of Object.entries(keys)) {
      assert.ok(!seen[k].has(v), `duplicate ${k}: ${e.name} (${v}) repeats ${seen[k].get(v)}`);
      seen[k].set(v, e.name);
    }
  }
});

// M-003-S3
test('M-003-S3 github_lists holds the two Litos CSV sources mapping url to Link and title to Role', () => {
  const lists = loadPreset(ID).sources.github_lists ?? [];
  assert.equal(lists.length, 2);
  for (const g of lists) {
    assert.match(`${g.name} ${g.repo}`, /litos/i, g.name);
    assert.equal(g.format, 'csv', g.name);
    assert.equal(g.field_map.url, 'Link', g.name);
    assert.equal(g.field_map.title, 'Role', g.name);
  }
  assert.match(lists.map((g) => `${g.name} ${g.path} ${g.repo}`).join(' '), /supply/i);
  assert.match(lists.map((g) => `${g.name} ${g.path} ${g.repo}`).join(' '), /industrial/i);
});

// M-003-S4
test('M-003-S4 Supply Chain Analyst Intern is eligible under the preset rules', () => {
  const r = check(loadPreset(ID), 'Supply Chain Analyst Intern');
  assert.equal(r.ok, true, r.reason);
});

// M-003-S5
test('M-003-S5 senior, sales and driver titles are not eligible under the preset rules', () => {
  const p = loadPreset(ID);
  for (const t of ['Senior Supply Chain Analyst', 'Inside Sales Intern', 'Sales Representative Intern', 'Delivery Driver Intern']) {
    assert.equal(check(p, t).ok, false, t);
  }
});
