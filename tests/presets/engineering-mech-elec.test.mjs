import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreset } from '../../lib/presets.mjs';

const ID = 'engineering-mech-elec';
const PERMITTED = ['tracker05-me', 'wonofakind-2027', 'hiderrick-eng', 'litos-me', 'litos-ee', 'litos-aero', 'litos-che', 'meche-intern', 'meche-newgrad'];
const LITOS = ['litos-me', 'litos-ee', 'litos-aero', 'litos-che'];
const lists = () => loadPreset(ID).sources.github_lists ?? [];
const isLitos = (g) => /^mehek-builds\//i.test(g.repo ?? '');

// M-013-S1
test('M-013-S1 engineering-mech-elec validates with 50 to 150 seed employers, each exactly name and careers_url', () => {
  const p = loadPreset(ID);
  assert.equal(p.id, ID);
  const seeds = p.seed_employers;
  assert.ok(seeds.length >= 50 && seeds.length <= 150, `${seeds.length} seed employers`);
  for (const [i, e] of seeds.entries()) {
    assert.deepEqual(Object.keys(e).sort(), ['careers_url', 'name'], `seed ${i}`);
    assert.match(e.careers_url, /^https:\/\//, `seed ${i}`);
  }
});

// M-013-S2
test('M-013-S2 seed names are unique case-insensitively and careers_url values are unique', () => {
  const seen = { name: new Map(), url: new Map() };
  for (const e of loadPreset(ID).seed_employers) {
    const keys = { name: e.name.toLowerCase(), url: e.careers_url };
    for (const [k, v] of Object.entries(keys)) {
      assert.ok(!seen[k].has(v), `duplicate ${k}: ${e.name} (${v}) repeats ${seen[k].get(v)}`);
      seen[k].set(v, e.name);
    }
  }
});

// M-013-S3
test('M-013-S3 every mehek-builds source uses a csv/ path and maps url to Link and title to Role', () => {
  const litos = lists().filter(isLitos);
  assert.ok(litos.length >= 4, `${litos.length} mehek-builds sources`);
  for (const g of litos) {
    assert.equal(g.format, 'csv', g.name);
    assert.match(g.path, /^csv\/.+\.csv$/, `${g.name} path ${g.path}`);
    assert.equal(g.field_map?.url, 'Link', g.name);
    assert.equal(g.field_map?.title, 'Role', g.name);
    assert.deepEqual(g.field_map, { company: 'Company', title: 'Role', location: 'Location', date: 'Posted', url: 'Link' }, g.name);
  }
});

// M-013-S3 (source names)
test('M-013-S3 source names are in the permitted set, the four Litos names are present, kept json sources carry a field_map', () => {
  const gl = lists();
  const names = gl.map((g) => g.name);
  for (const n of names) assert.ok(PERMITTED.includes(n), `unexpected source ${n}`);
  for (const n of LITOS) assert.ok(names.includes(n), `missing ${n}`);
  for (const g of gl.filter((x) => ['tracker05-me', 'wonofakind-2027'].includes(x.name))) {
    assert.ok(g.field_map && Object.keys(g.field_map).length > 0, `${g.name} needs a field_map`);
  }
});

// M-013-S4
// W-017: the earlier MechEJobTracker entry used a repo path that does not exist; the real repo is eyaghmour07/MechEJobTracker.
test('M-013-S4 no github_lists source uses the wrong MechEJobTracker/MechEJobTracker repo or a root-level Litos CSV path', () => {
  for (const g of lists()) {
    assert.notEqual(String(g.repo).toLowerCase(), 'mechejobtracker/mechejobtracker', `source ${g.name} uses the wrong MechEJobTracker repo`);
    if (isLitos(g)) assert.ok(String(g.path).includes('/'), `source ${g.name} uses root-level path ${g.path}`);
  }
});
