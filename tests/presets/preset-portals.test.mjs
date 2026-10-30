// Assumed: scripts/preset-portals.mjs exports presetPortals(id) -> YAML string, and as a CLI
// (`node scripts/preset-portals.mjs <id>`) prints that string to stdout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { presetPortals } from '../../scripts/preset-portals.mjs';
import { loadPreset } from '../../lib/presets.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const NAMED = readdirSync(join(PACK_ROOT, 'presets')).filter((f) => f.endsWith('.yml') && f !== 'OWNERS.yml').map((f) => f.slice(0, -4)).filter((id) => id !== 'byo-employer-list').sort();

function check(id, text) {
  const doc = yaml.load(text);
  const seeds = loadPreset(id).seed_employers;
  assert.ok(Array.isArray(doc.tracked_companies), id);
  assert.equal(doc.tracked_companies.length, seeds.length, id);
  doc.tracked_companies.forEach((e, i) => {
    assert.deepEqual(e, { ...seeds[i], enabled: true }, `${id} entry ${i}`);
  });
}

// M-006-S10 (M-001-S8: NAMED follows the presets/ directory scan)
for (const id of NAMED) {
  test(`M-006-S10 CLI prints tracked_companies YAML for ${id}`, () => {
    const out = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'preset-portals.mjs'), id], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 60000 });
    assert.equal(out.status, 0, out.stderr);
    check(id, out.stdout);
  });
}

test('M-006-S10 presetPortals(id) returns the same YAML', async () => {
  check('software-cs', String(await presetPortals('software-cs')));
});

// M-006-S11
test('M-006-S11 every resume fixture is marked SYNTHETIC FIXTURE with example emails and 555-01xx numbers', () => {
  const dir = join(PACK_ROOT, 'tests', 'fixtures', 'resumes');
  const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
  assert.deepEqual(files, ['cs.md', 'finance.md', 'mechanical.md', 'mis.md', 'nursing.md']);
  for (const f of files) {
    const text = readFileSync(join(dir, f), 'utf8');
    assert.ok(text.split('\n').slice(0, 5).join('\n').includes('SYNTHETIC FIXTURE'), `${f} marker`);
    const emails = [...text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)];
    assert.ok(emails.length > 0, `${f} has an email`);
    for (const m of emails) assert.match(m[1], /^(example\.(com|org|net|edu))$/i, `${f} email domain`);
    const phones = [...text.matchAll(/(?<![\w.-])(?:\+?1[ .-]?)?\(?([2-9]\d{2})\)?[ .-](\d{3})[ .-](\d{4})(?![\w-])/g)];
    assert.ok(phones.length > 0, `${f} has a phone`);
    for (const m of phones) assert.ok(m[2] === '555' && /^01\d\d$/.test(m[3]), `${f} phone ${m[0]}`);
  }
});

// W-019
test('W-019 presetPortals passes a seed provider and its config through to portals.yml', async () => {
  const doc = yaml.load(String(await presetPortals('accounting')));
  const crowe = doc.tracked_companies.find((e) => e.name === 'Crowe');
  assert.equal(crowe.provider, 'phenom');
  assert.deepEqual(crowe.phenom, { lang: 'en_us', country: 'us' });
  const eide = doc.tracked_companies.find((e) => e.name === 'Eide Bailly');
  assert.equal(eide.provider, 'jibeapply');
  assert.match(eide.api, /^https:\/\//);
  assert.equal(eide.enabled, true);
});
