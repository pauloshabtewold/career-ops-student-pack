import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreset } from '../../lib/presets.mjs';
import { parseSource } from '../../plugins/github-lists/_parsers.mjs';
import { isEligible } from '../../plugins/github-lists/_eligibility.mjs';
import { CYCLE } from '../helpers/feed-harness.mjs';

const ID = 'cybersecurity';
const SUFFIX = ' (clearance required)';

function check(preset, title) {
  const row = { company: 'Example Security', title, location: 'Austin, TX', date: '2026-09-15', url: 'https://example.com/jobs/1', kind: 'internship' };
  return isEligible(row, { cycle: CYCLE, titleRules: preset.title_rules, earlyCareer: preset.early_career });
}

function hackedRico(preset) {
  const g = (preset.sources.github_lists ?? []).find((x) => x.repo === 'HackedRico/2027-cyber-jobs');
  assert.ok(g, 'HackedRico source present');
  return g;
}

// Parses one synthetic record through the preset's own field_map.
function parseRecord(preset, extra) {
  const g = hackedRico(preset);
  const m = g.field_map;
  const rec = {
    [m.company ?? 'company']: 'Example Security',
    [m.title]: 'Security Analyst Intern',
    [m.location ?? 'location']: 'Austin, TX',
    [m.url ?? 'url']: 'https://example.com/jobs/1',
    [m.date]: '2026-09-15',
    ...extra(m),
  };
  return parseSource(JSON.stringify([rec]), { format: g.format, kind: g.kind, field_map: m });
}

// M-007-S1
test('M-007-S1 cybersecurity validates with 50 to 150 seed employers, each with name and careers_url', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, ID);
  assert.equal(p.name, 'Cybersecurity');
  const seeds = p.seed_employers;
  assert.ok(seeds.length >= 50 && seeds.length <= 150, `${seeds.length} seed employers`);
  for (const [i, e] of seeds.entries()) {
    assert.ok(e.name && e.careers_url, `seed ${i}`);
    assert.match(e.careers_url, /^https:\/\//, `seed ${i}`);
  }
});

// M-007-S2
test('M-007-S2 seed names are unique case-insensitively and careers_url values are unique', () => {
  const seen = { name: new Map(), url: new Map() };
  for (const e of loadPreset(ID).seed_employers) {
    const keys = { name: e.name.toLowerCase(), url: e.careers_url };
    for (const [k, v] of Object.entries(keys)) {
      assert.ok(!seen[k].has(v), `duplicate ${k}: ${e.name} (${v}) repeats ${seen[k].get(v)}`);
      seen[k].set(v, e.name);
    }
  }
});

// M-007-S3
test('M-007-S3 github_lists holds the HackedRico listings.json source with title role, date date_added, clearance clearance', () => {
  const g = hackedRico(loadPreset(ID));
  assert.match(g.path, /listings\.json$/);
  assert.equal(g.field_map.title, 'role');
  assert.equal(g.field_map.date, 'date_added');
  assert.equal(g.field_map.clearance, 'clearance');
});

// M-007-S4
test('M-007-S4 a HackedRico-shaped record with clearance true gets the clearance title suffix', () => {
  const { rows, parseErrors } = parseRecord(loadPreset(ID), (m) => ({ [m.clearance]: true }));
  assert.equal(parseErrors, 0);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].title.endsWith(SUFFIX), rows[0].title);
});

// M-007-S5
test('M-007-S5 an alert names USAJOBS and says federal cyber roles are absent from the HackedRico list', () => {
  const alerts = loadPreset(ID).sources.alerts ?? [];
  const a = alerts.find((x) => /usajobs/i.test(`${x.name} ${x.how}`));
  assert.ok(a, 'USAJOBS alert');
  assert.match(a.how, /federal/i);
  assert.match(a.how, /HackedRico/);
});

// M-007-S6
test('M-007-S6 the coverage note names the title flag and the clearance dealbreaker', () => {
  const c = loadPreset(ID).coverage;
  assert.equal(c.level, 'semi-automated');
  assert.ok(c.note.includes('(clearance required)'), c.note);
  assert.match(c.note, /clearance.{0,40}dealbreaker|dealbreaker.{0,40}clearance/i);
});

// M-007-S7
test('M-007-S7 SOC Analyst Intern is eligible and Senior Security Engineer is not', () => {
  const p = loadPreset(ID);
  const ok = check(p, 'SOC Analyst Intern');
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(check(p, 'Senior Security Engineer').ok, false);
});

// M-007-S8
test('M-007-S8 the recruiting calendar equals the software-cs calendar', () => {
  assert.deepEqual(loadPreset(ID).recruiting_calendar, loadPreset('software-cs').recruiting_calendar);
});

// M-007-S9
test('M-007-S9 SOC and IAM match as whole words; Associate, Social and Diamond titles do not match', () => {
  const p = loadPreset(ID);
  const iam = check(p, 'IAM Analyst Intern');
  assert.equal(iam.ok, true, iam.reason);
  for (const t of ['Social Media Associate Intern', 'Diamond Sales Associate Intern']) {
    assert.equal(check(p, t).ok, false, t);
  }
});

// M-007-S10
test('M-007-S10 a HackedRico-shaped record with closed true is not ingested', () => {
  const p = loadPreset(ID);
  assert.ok(hackedRico(p).field_map.closed, 'closed mapped');
  const closed = parseRecord(p, (m) => ({ [m.closed]: true }));
  assert.equal(closed.rows.length, 0);
  assert.equal(closed.parseErrors, 0);
  const open = parseRecord(p, () => ({}));
  assert.equal(open.rows.length, 1);
});
