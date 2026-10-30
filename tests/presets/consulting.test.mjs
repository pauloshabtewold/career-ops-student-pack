import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreset } from '../../lib/presets.mjs';
import { isEligible } from '../../plugins/github-lists/_eligibility.mjs';
import { CYCLE } from '../helpers/feed-harness.mjs';

const ID = 'consulting';

function check(preset, title) {
  const row = { company: 'Example Advisory', title, location: 'Chicago, IL', date: '2026-09-15', url: 'https://example.edu/jobs/1', kind: 'internship' };
  return isEligible(row, { cycle: CYCLE, titleRules: preset.title_rules, earlyCareer: preset.early_career });
}

// M-006-S1
test('M-006-S1 consulting validates with 50 to 150 seed employers, each exactly name and careers_url', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, ID);
  const seeds = p.seed_employers;
  assert.ok(seeds.length >= 50 && seeds.length <= 150, `${seeds.length} seed employers`);
  for (const [i, e] of seeds.entries()) {
    assert.deepEqual(Object.keys(e).sort(), ['careers_url', 'name'], `seed ${i}`);
    assert.match(e.careers_url, /^https:\/\//, `seed ${i}`);
  }
});

// M-006-S2
test('M-006-S2 seed names are unique case-insensitively and careers_url values are unique', () => {
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

// M-006-S3
// W-017: the two new-grad lists passed the rule of 5 or more rows matched to an employer board.
test('M-006-S3 sources.github_lists holds exactly the jobright consultant and Litos finance-consulting new-grad lists', () => {
  const lists = loadPreset(ID).sources?.github_lists;
  assert.deepEqual(lists, [
    { name: 'jobright-consultant-newgrad', repo: 'jobright-ai/2026-Consultant-New-Grad', path: 'README.md', format: 'markdown-table', kind: 'newgrad' },
    { name: 'litos-finance-consulting-newgrad', repo: 'mehek-builds/New-Grad-2027', path: 'csv/finance-consulting.csv', format: 'csv', kind: 'newgrad', field_map: { company: 'Company', title: 'Role', location: 'Location', date: 'Posted', url: 'Link' } },
  ]);
});

// M-006-S4
test('M-006-S4 coverage note says deadline trackers feed dates only and the vendor lists count once matched', () => {
  const { coverage } = loadPreset(ID);
  assert.match(coverage.note, /deadline/i);
  assert.match(coverage.note, /dates only/i);
  assert.match(coverage.note, /once matched to an employer board/i);
});

// M-006-S5
test('M-006-S5 sources.alerts names at least one deadline tracker', () => {
  const alerts = loadPreset(ID).sources?.alerts ?? [];
  assert.ok(alerts.length >= 1, 'no alerts');
  for (const a of alerts) {
    assert.ok(a.name && a.how, 'alert needs name and how');
  }
});

// M-006-S6
test('M-006-S6 Business Analyst Intern is eligible and Senior Manager is not', () => {
  const p = loadPreset(ID);
  const ok = check(p, 'Business Analyst Intern');
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(check(p, 'Senior Manager').ok, false);
});
