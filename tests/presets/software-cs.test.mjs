import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreset } from '../../lib/presets.mjs';

const ID = 'software-cs';

const SHIPPED_SOURCES = {
  github_lists: [
    { name: 'simplify-intern', repo: 'SimplifyJobs/Summer2027-Internships', path: '.github/scripts/listings.json', format: 'simplify-json', kind: 'internship' },
    { name: 'simplify-newgrad', repo: 'SimplifyJobs/New-Grad-Positions', path: '.github/scripts/listings.json', format: 'simplify-json', kind: 'newgrad' },
    { name: 'vansh-intern', repo: 'vanshb03/Summer2027-Internships', path: 'README.md', format: 'markdown-table', kind: 'internship' },
    { name: 'vansh-newgrad', repo: 'vanshb03/New-Grad-2027', path: 'README.md', format: 'markdown-table', kind: 'newgrad' },
    { name: 'speedy-intern', repo: 'speedyapply/2027-SWE-College-Jobs', path: 'README.md', format: 'markdown-table', kind: 'internship' },
    { name: 'speedy-newgrad', repo: 'speedyapply/2027-SWE-College-Jobs', path: 'NEW_GRAD_USA.md', format: 'markdown-table', kind: 'newgrad' },
  ],
  alerts: [
    { name: 'Handshake saved search', how: 'Save a software search on Handshake and turn on email alerts.' },
    { name: 'LinkedIn job alerts', how: 'Create alerts for software engineer intern and new grad.' },
  ],
};

// Current ATS board URL shapes: Greenhouse job-boards host, Ashby, Lever.
const BOARD_URL = /^https:\/\/(job-boards(\.eu)?\.greenhouse\.io|jobs\.ashbyhq\.com|jobs(\.eu)?\.lever\.co)\/[A-Za-z0-9_.-]+\/?$/;

// M-009-S1
test('M-009-S1 software-cs validates with 50 to 150 seed employers, each exactly name and careers_url', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, ID);
  const seeds = p.seed_employers;
  assert.ok(seeds.length >= 50 && seeds.length <= 150, `${seeds.length} seed employers`);
  for (const [i, e] of seeds.entries()) {
    assert.deepEqual(Object.keys(e).sort(), ['careers_url', 'name'], `seed ${i}`);
    assert.match(e.careers_url, BOARD_URL, `seed ${i} ${e.name}`);
  }
});

// M-009-S2
test('M-009-S2 seed names are unique case-insensitively and careers_url values are unique', () => {
  const seeds = loadPreset(ID).seed_employers;
  assert.ok(seeds.length > 0, 'no seed employers to check');
  const seen = { name: new Map(), url: new Map() };
  for (const e of seeds) {
    const keys = { name: e.name.toLowerCase(), url: e.careers_url.toLowerCase().replace(/\/$/, '') };
    for (const [k, v] of Object.entries(keys)) {
      assert.ok(!seen[k].has(v), `duplicate ${k}: ${e.name} (${v}) repeats ${seen[k].get(v)}`);
      seen[k].set(v, e.name);
    }
  }
});

// M-009-S3
test('M-009-S3 software-cs keeps id, name, coverage level and sources block as shipped', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, 'software-cs');
  assert.equal(p.name, 'Software engineering, computer science');
  assert.equal(p.coverage.level, 'automated');
  assert.deepEqual(p.sources, SHIPPED_SOURCES);
});
