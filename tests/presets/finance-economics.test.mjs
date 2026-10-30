import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreset } from '../../lib/presets.mjs';

const ID = 'finance-economics';

const SHIPPED_SOURCES = {
  github_lists: [
    {
      name: 'jobright-account-intern',
      repo: 'jobright-ai/2026-Account-Internship',
      path: 'README.md',
      format: 'markdown-table',
      kind: 'internship',
    },
    {
      name: 'jobright-account-newgrad',
      repo: 'jobright-ai/2026-Account-New-Grad',
      path: 'README.md',
      format: 'markdown-table',
      kind: 'newgrad',
    },
    { name: 'simplify-intern', repo: 'SimplifyJobs/Summer2027-Internships', path: '.github/scripts/listings.json', format: 'simplify-json', kind: 'internship' },
    { name: 'simplify-newgrad', repo: 'SimplifyJobs/New-Grad-Positions', path: '.github/scripts/listings.json', format: 'simplify-json', kind: 'newgrad' },
    { name: 'quant-intern', repo: 'quant-scraper/Quant-Internships-New-Grad-2027', path: 'README.md', format: 'markdown-table', kind: 'internship' },
  ],
  alerts: [
    { name: 'Handshake saved search', how: 'Save searches for summer analyst, finance intern and rotational program.' },
    { name: 'LinkedIn job alerts', how: 'Alerts for investment banking analyst and corporate finance.' },
    { name: 'Bank career sites', how: 'Banks post analyst programs on their own sites; check them in the fall.' },
  ],
};

// M-011-S1
test('M-011-S1 finance-economics validates with 50 to 150 seed employers, each exactly name and careers_url', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, ID);
  const seeds = p.seed_employers;
  assert.ok(seeds.length >= 50 && seeds.length <= 150, `${seeds.length} seed employers`);
  for (const [i, e] of seeds.entries()) {
    assert.deepEqual(Object.keys(e).sort(), ['careers_url', 'name'], `seed ${i}`);
    assert.match(e.careers_url, /^https:\/\//, `seed ${i}`);
  }
});

// M-011-S2
test('M-011-S2 seed names are unique case-insensitively and careers_url values are unique', () => {
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

// M-011-S3 (keep: regression guard, passes on the shipped file)
test('M-011-S3 finance-economics keeps id, name, coverage level and sources block as shipped', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, ID);
  assert.equal(p.name, 'Finance, economics');
  assert.equal(p.coverage.level, 'semi-automated');
  assert.deepEqual(p.sources, SHIPPED_SOURCES);
});

// W-015-F1: the Codex walkthrough's finance student got 20 full-time "Associate" roles needing 3-5 years, all FAIL.
test('W-015-F1 finance early_career keeps summer associate and associate programs but not a bare Associate title', () => {
  const re = new RegExp(loadPreset(ID).early_career, 'i');
  for (const t of ['Summer Associate, Investment Banking', 'Associate Program 2027', 'Associate Intern, Wealth', 'Summer Analyst']) assert.ok(re.test(t), t);
  for (const t of ['Investment Associate', 'Senior Associate, Private Equity', 'Associate, Credit Risk']) assert.ok(!re.test(t), t);
});
