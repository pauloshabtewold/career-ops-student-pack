import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreset } from '../../lib/presets.mjs';
import { isEligible } from '../../plugins/github-lists/_eligibility.mjs';
import { CYCLE } from '../helpers/feed-harness.mjs';

const ID = 'statistics-math-actuarial';

function check(preset, title) {
  const row = { company: 'Example Mutual', title, location: 'Hartford, CT', date: '2026-09-15', url: 'https://example.edu/jobs/1', kind: 'internship' };
  return isEligible(row, { cycle: CYCLE, titleRules: preset.title_rules, earlyCareer: preset.early_career });
}

// M-004-S1
test('M-004-S1 statistics-math-actuarial validates with 50 to 150 seed employers, each with name and careers_url', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, ID);
  const seeds = p.seed_employers;
  assert.ok(seeds.length >= 50 && seeds.length <= 150, `${seeds.length} seed employers`);
  for (const [i, e] of seeds.entries()) {
    assert.ok(e.name && e.careers_url, `seed ${i}`);
    assert.match(e.careers_url, /^https:\/\//, `seed ${i}`);
  }
});

// M-004-S2
test('M-004-S2 seed names are unique case-insensitively and careers_url values are unique', () => {
  const seen = { name: new Map(), url: new Map() };
  for (const e of loadPreset(ID).seed_employers) {
    const keys = { name: e.name.toLowerCase(), url: e.careers_url };
    for (const [k, v] of Object.entries(keys)) {
      assert.ok(!seen[k].has(v), `duplicate ${k}: ${e.name} (${v}) repeats ${seen[k].get(v)}`);
      seen[k].set(v, e.name);
    }
  }
});

// M-004-S3
test('M-004-S3 github_lists holds the three Litos math, actuarial and pc-actuarial CSV sources mapping url to Link', () => {
  const lists = loadPreset(ID).sources.github_lists ?? [];
  assert.equal(lists.length, 3);
  for (const g of lists) {
    assert.match(`${g.name} ${g.repo}`, /litos/i, g.name);
    assert.equal(g.format, 'csv', g.name);
    assert.equal(g.field_map.url, 'Link', g.name);
  }
  const text = lists.map((g) => `${g.name} ${g.path} ${g.repo}`);
  assert.ok(text.some((t) => /math-internships/i.test(t)), 'math-internships');
  assert.ok(text.some((t) => /(^|[^-\w])actuarial-internships/i.test(t)), 'actuarial-internships');
  assert.ok(text.some((t) => /pc-actuarial/i.test(t)), 'pc-actuarial');
});

// M-004-S4
test('M-004-S4 alerts name the ASA STATtr@k December list and the CAS career center', () => {
  const alerts = loadPreset(ID).sources.alerts ?? [];
  const text = alerts.map((a) => `${a.name} ${a.how}`).join(' | ');
  assert.match(text, /STATtr@k/i);
  assert.match(text, /December/i);
  assert.match(text, /\bCAS\b/);
  assert.match(text, /career center/i);
  assert.ok(alerts.every((a) => a.name && a.how));
});

// M-004-S5
test('M-004-S5 Actuarial Analyst Intern is eligible and Senior Actuary is not', () => {
  const p = loadPreset(ID);
  const ok = check(p, 'Actuarial Analyst Intern');
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(check(p, 'Senior Actuary').ok, false);
});

// M-004-S6
test('M-004-S6 recruiting_calendar equals the finance-economics calendar', () => {
  assert.deepEqual(loadPreset(ID).recruiting_calendar, loadPreset('finance-economics').recruiting_calendar);
});

// M-004-S7
test('M-004-S7 Data Analyst Intern, AI Agents is eligible and Risk Advisory Intern, Insurance Agent is not', () => {
  const p = loadPreset(ID);
  const ok = check(p, 'Data Analyst Intern, AI Agents');
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(check(p, 'Risk Advisory Intern, Insurance Agent').ok, false);
});
