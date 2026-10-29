import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreset } from '../../lib/presets.mjs';

const ID = 'accounting';

const SHIPPED_SOURCES = {
  github_lists: [
    { name: 'jobright-account-intern', repo: 'jobright-ai/2026-Account-Internship', path: 'README.md', format: 'markdown-table', kind: 'internship' },
    { name: 'jobright-account-newgrad', repo: 'jobright-ai/2026-Account-New-Grad', path: 'README.md', format: 'markdown-table', kind: 'newgrad' },
  ],
  alerts: [
    { name: 'Handshake saved search', how: 'Save searches for audit intern, tax intern and assurance associate.' },
    { name: 'Firm career sites', how: 'Winter busy-season internships are posted on each firm site in the spring and summer.' },
  ],
};

// M-012-S1 (regression guard on the shipped file if it already meets the range)
test('M-012-S1 accounting validates with 50 to 150 seed employers, each exactly name and careers_url', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, ID);
  const seeds = p.seed_employers;
  assert.ok(seeds.length >= 50 && seeds.length <= 150, `${seeds.length} seed employers`);
  for (const [i, e] of seeds.entries()) {
    assert.deepEqual(Object.keys(e).sort(), ['careers_url', 'name'], `seed ${i}`);
    assert.match(e.careers_url, /^https:\/\//, `seed ${i}`);
  }
});

// M-012-S2
test('M-012-S2 seed names are unique case-insensitively and careers_url values are unique', () => {
  const seeds = loadPreset(ID).seed_employers;
  assert.ok(seeds.length > 0, 'no seed employers to check');
  const seen = { name: new Map(), url: new Map() };
  for (const e of seeds) {
    const keys = { name: e.name.toLowerCase(), url: e.careers_url };
    for (const [k, v] of Object.entries(keys)) {
      assert.ok(!seen[k].has(v), `duplicate ${k}: ${e.name} (${v}) repeats ${seen[k].get(v)}`);
      seen[k].set(v, e.name);
    }
  }
});

// M-012-S3 (keep: regression guard, passes on the shipped file)
test('M-012-S3 accounting keeps id, name, coverage level and sources block as shipped', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, ID);
  assert.equal(p.name, 'Accounting');
  assert.equal(p.coverage.level, 'semi-automated');
  assert.deepEqual(p.sources, SHIPPED_SOURCES);
});
