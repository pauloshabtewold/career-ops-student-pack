import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as yaml from 'js-yaml';
import { loadPreset } from '../../lib/presets.mjs';
import { scanText } from '../../scripts/pii-lint.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const NAMED = ['software-cs', 'mis-business-analytics', 'finance-economics', 'accounting', 'engineering-mech-elec', 'policy-government'];
const BYO = 'byo-employer-list';
const dir = join(PACK_ROOT, 'presets');
const ids = () => readdirSync(dir).filter((f) => f.endsWith('.yml') && f !== 'OWNERS.yml').map((f) => f.slice(0, -4)).sort();

// M-006-S8
test('M-006-S8 exactly 6 named presets ship, plus the bring-your-own preset, and each validates', () => {
  assert.deepEqual(ids(), [...NAMED, BYO].sort());
  for (const id of ids()) assert.doesNotThrow(() => loadPreset(id), id);
});

test('M-006-S8 each named preset has 50 to 150 seed employers; byo has none', () => {
  for (const id of NAMED) {
    const n = loadPreset(id).seed_employers.length;
    assert.ok(n >= 50 && n <= 150, `${id} has ${n} seed employers`);
  }
  assert.equal((loadPreset(BYO).seed_employers ?? []).length, 0);
});

test('M-006-S8 OWNERS.yml has a role-placeholder owner and ISO date for every preset', () => {
  const owners = yaml.load(readFileSync(join(dir, 'OWNERS.yml'), 'utf8'));
  for (const id of ids()) {
    assert.ok(owners[id], `OWNERS.yml entry for ${id}`);
    assert.equal(owners[id].owner, 'pack-maintainer', id);
    assert.match(String(owners[id].last_reviewed), /^\d{4}-\d{2}-\d{2}$/, id);
  }
});

// M-006-S9
test('M-006-S9 every shipped employer policy has a source_url', () => {
  for (const id of ids()) {
    for (const e of loadPreset(id).employer_policies ?? []) assert.match(e.source_url ?? '', /^https?:\/\//, `${id} ${e.company}`);
  }
});

test('M-006-S9 a policy without source_url fails validation naming the preset and company', async () => {
  const { validatePreset } = await import('../../lib/presets.mjs');
  const p = structuredClone(loadPreset('software-cs'));
  p.employer_policies = [{ company: 'Example Policy Co', max: 2, period_days: 30 }];
  assert.throws(() => validatePreset(p, 'software-cs'), (err) => /software-cs/.test(err.message) && /Example Policy Co/.test(err.message));
});

// M-006-S12
test('M-006-S12 every seed_employers entry carries exactly name and careers_url', () => {
  for (const id of ids()) {
    const raw = yaml.load(readFileSync(join(dir, `${id}.yml`), 'utf8'));
    (raw.seed_employers ?? []).forEach((e, i) => {
      assert.deepEqual(Object.keys(e).sort(), ['careers_url', 'name'], `${id} seed_employers[${i}] (${e.name ?? 'unnamed'})`);
    });
  }
});

// M-006-S13
test('M-006-S13 scanText finds no blocked token under presets/ or tests/fixtures/', () => {
  const files = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      statSync(p).isDirectory() ? walk(p) : files.push(p);
    }
  };
  for (const top of ['presets', join('tests', 'fixtures')]) {
    assert.ok(existsSync(join(PACK_ROOT, top)), `${top} exists`);
    walk(join(PACK_ROOT, top));
  }
  assert.ok(files.some((f) => f.includes(`${join('presets', 'software-cs.yml')}`)));
  for (const f of files) {
    const rel = relative(PACK_ROOT, f).replace(/\\/g, '/');
    for (const hit of scanText(rel, readFileSync(f, 'utf8')).filter((x) => x.rule === 'blocked-token')) {
      assert.fail(`${rel}:${hit.line} blocked token`);
    }
  }
});
