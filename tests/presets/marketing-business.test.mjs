import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreset } from '../../lib/presets.mjs';
import { isEligible } from '../../plugins/github-lists/_eligibility.mjs';
import { CYCLE } from '../helpers/feed-harness.mjs';

const ID = 'marketing-business';

function check(preset, title) {
  const row = { company: 'Example Brands', title, location: 'Austin, TX', date: '2026-09-15', url: 'https://example.edu/jobs/1', kind: 'internship' };
  return isEligible(row, { cycle: CYCLE, titleRules: preset.title_rules, earlyCareer: preset.early_career });
}

// M-005-S1
test('M-005-S1 marketing-business validates with 50 to 150 seed employers, each exactly name and careers_url', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, ID);
  const seeds = p.seed_employers;
  assert.ok(seeds.length >= 50 && seeds.length <= 150, `${seeds.length} seed employers`);
  for (const [i, e] of seeds.entries()) {
    assert.deepEqual(Object.keys(e).sort(), ['careers_url', 'name'], `seed ${i}`);
    assert.match(e.careers_url, /^https:\/\//, `seed ${i}`);
  }
});

// M-005-S2
test('M-005-S2 seed names are unique case-insensitively and careers_url values are unique', () => {
  const seen = { name: new Map(), url: new Map() };
  for (const e of loadPreset(ID).seed_employers) {
    const keys = { name: e.name.toLowerCase(), url: e.careers_url };
    for (const [k, v] of Object.entries(keys)) {
      assert.ok(!seen[k].has(v), `duplicate ${k}: ${e.name} (${v}) repeats ${seen[k].get(v)}`);
      seen[k].set(v, e.name);
    }
  }
});

// M-005-S3
test('M-005-S3 github_lists holds the Litos marketing CSV mapping url to Link and the jobright marketing new-grad list', () => {
  const lists = loadPreset(ID).sources.github_lists ?? [];
  assert.deepEqual(lists.map((g) => g.name), ['litos-marketing', 'jobright-marketing-newgrad']);
  const [g, j] = lists;
  assert.match(`${g.name} ${g.repo}`, /litos/i);
  assert.match(`${g.name} ${g.path}`, /marketing/i);
  assert.equal(g.format, 'csv');
  assert.deepEqual(g.field_map, { company: 'Company', title: 'Role', location: 'Location', date: 'Posted', url: 'Link' });
  assert.deepEqual([j.repo, j.path, j.format, j.kind], ['jobright-ai/2026-Marketing-New-Grad', 'README.md', 'markdown-table', 'newgrad']);
});

// M-005-S4
// W-017: the jobright marketing list makes "no marketing-specific list" false; the vendor lists only count once matched.
test('M-005-S4 coverage note says vendor lists count once matched and the employer list carries the preset', () => {
  const { coverage } = loadPreset(ID);
  assert.match(coverage.note, /vendor marketing lists/i);
  assert.match(coverage.note, /employer list carries/i);
});

// M-005-S5
test('M-005-S5 Brand Management Intern is eligible and Software Engineer Intern is not', () => {
  const p = loadPreset(ID);
  const ok = check(p, 'Brand Management Intern');
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(check(p, 'Software Engineer Intern').ok, false);
});

// M-005-S6
test('M-005-S6 recruiting_calendar equals the mis-business-analytics calendar', () => {
  assert.deepEqual(loadPreset(ID).recruiting_calendar, loadPreset('mis-business-analytics').recruiting_calendar);
});

// M-005-S7
test('M-005-S7 no bare engineer exclude rule remains and Sales Engineer Intern is not eligible', () => {
  const p = loadPreset(ID);
  for (const rule of p.title_rules.exclude) {
    const re = new RegExp(rule, 'i');
    for (const t of ['Mechanical Engineer Intern', 'Electrical Engineer Intern', 'Software Engineer Intern']) {
      assert.ok(!re.test(t), `exclude rule ${rule} matches ${t}`);
    }
  }
  assert.equal(check(p, 'Sales Engineer Intern').ok, false);
});
