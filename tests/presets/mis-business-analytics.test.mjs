import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreset } from '../../lib/presets.mjs';

const ID = 'mis-business-analytics';

// M-010-S1
test('M-010-S1 mis-business-analytics validates with 50 to 150 seed employers, each with name and careers_url', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, ID);
  const seeds = p.seed_employers;
  assert.ok(seeds.length >= 50 && seeds.length <= 150, `${seeds.length} seed employers`);
  for (const [i, e] of seeds.entries()) {
    assert.ok(e.name && e.careers_url, `seed ${i}`);
    assert.match(e.careers_url, /^https:\/\//, `seed ${i}`);
  }
});

// M-010-S2
test('M-010-S2 seed names are unique case-insensitively and careers_url values are unique', () => {
  const seen = { name: new Map(), url: new Map() };
  for (const e of loadPreset(ID).seed_employers) {
    const keys = { name: e.name.toLowerCase(), url: e.careers_url };
    for (const [k, v] of Object.entries(keys)) {
      assert.ok(!seen[k].has(v), `duplicate ${k}: ${e.name} (${v}) repeats ${seen[k].get(v)}`);
      seen[k].set(v, e.name);
    }
  }
});

// M-010-S3
test('M-010-S3 id, name, coverage level and sources block are unchanged', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, ID);
  assert.equal(p.name, 'MIS, information systems, business analytics');
  assert.equal(p.coverage.level, 'semi-automated');
  assert.deepEqual(p.sources.github_lists.map((g) => [g.name, g.repo, g.path, g.format, g.kind]), [
    ['simplify-intern', 'SimplifyJobs/Summer2027-Internships', '.github/scripts/listings.json', 'simplify-json', 'internship'],
    ['simplify-newgrad', 'SimplifyJobs/New-Grad-Positions', '.github/scripts/listings.json', 'simplify-json', 'newgrad'],
    ['litos-data-science', 'mehek-builds/Hiring-Now', 'csv/data-science.csv', 'csv', 'internship'],
    ['litos-bizops-newgrad', 'mehek-builds/New-Grad-2027', 'csv/business-operations.csv', 'csv', 'newgrad'],
  ]);
  assert.deepEqual(p.sources.alerts.map((a) => a.name), ['Handshake saved search', 'LinkedIn job alerts']);
});
