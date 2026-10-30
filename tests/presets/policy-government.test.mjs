import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreset } from '../../lib/presets.mjs';

const ID = 'policy-government';

const SHIPPED_SOURCES = {
  github_lists: [
    { name: 'litos-policy', repo: 'mehek-builds/Hiring-Now', path: 'csv/policy-government-affairs.csv', format: 'csv', kind: 'internship', field_map: { company: 'Company', title: 'Role', location: 'Location', date: 'Posted', url: 'Link' } },
  ],
  alerts: [
    { name: 'USAJOBS', how: 'Save a USAJOBS search with the Pathways and recent graduates hiring paths and turn on its email alerts; the inbox step reads those alerts.' },
    { name: 'Think tank pages', how: 'Check think tank internship pages by hand each term.' },
    { name: 'Idealist', how: 'Idealist bars scraping, so use its email alerts only.' },
  ],
};

// M-014-S1 (regression guard on the shipped file if it already meets the range)
test('M-014-S1 policy-government validates with 50 to 150 seed employers, each with name and careers_url', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, ID);
  const seeds = p.seed_employers;
  assert.ok(seeds.length >= 50 && seeds.length <= 150, `${seeds.length} seed employers`);
  for (const [i, e] of seeds.entries()) {
    assert.ok(e.name && e.careers_url, `seed ${i}`);
    assert.match(e.careers_url, /^https:\/\//, `seed ${i}`);
  }
});

// M-014-S2 (regression guard on the shipped file if it has no duplicates)
test('M-014-S2 seed names are unique case-insensitively and careers_url values are unique', () => {
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

// M-014-S3 (keep: regression guard, passes on the shipped file)
test('M-014-S3 policy-government keeps id, name, coverage level and sources block as shipped', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, ID);
  assert.equal(p.name, 'Policy, political science, government');
  assert.equal(p.coverage.level, 'semi-automated');
  assert.deepEqual(p.sources, SHIPPED_SOURCES);
});

// M-014-S4 (red until the coverage note gains the watch-only sentence)
test('M-014-S4 coverage note has a watch-only sentence with a percentage', () => {
  const note = loadPreset(ID).coverage.note;
  const sentences = note.split(/(?<=[.!?])\s+/);
  assert.ok(
    sentences.some((s) => /watch-only/i.test(s) && /\d+\s*%/.test(s)),
    `no sentence with watch-only and a percentage in: ${note}`,
  );
});

// W-017: governmentjobs.com robots.txt disallows all bots, so no seed may point there.
test('W-017 no policy-government seed points at governmentjobs.com', () => {
  for (const e of loadPreset(ID).seed_employers) {
    assert.ok(!/governmentjobs\.com/i.test(e.careers_url), `${e.name} points at governmentjobs.com`);
  }
});
