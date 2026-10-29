import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as yaml from 'js-yaml';
import { loadPreset } from '../../lib/presets.mjs';
import { scanText } from '../../scripts/pii-lint.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const CORE = ['software-cs', 'mis-business-analytics', 'finance-economics', 'accounting', 'engineering-mech-elec', 'policy-government'];
const NEW_PRESETS = ['supply-chain-operations', 'statistics-math-actuarial', 'marketing-business', 'consulting', 'cybersecurity'];
const BYO = 'byo-employer-list';
const dir = join(PACK_ROOT, 'presets');
const ids = () => readdirSync(dir).filter((f) => f.endsWith('.yml') && f !== 'OWNERS.yml').map((f) => f.slice(0, -4)).sort();

const named = () => ids().filter((id) => id !== BYO);
const KEYS = new Set(['company', 'title', 'location', 'date', 'url', 'clearance', 'closed']);

// M-001-S5
test('M-001-S5 every named preset validates with 50 to 150 seed employers and the six core presets are present', () => {
  assert.ok(ids().includes(BYO));
  assert.doesNotThrow(() => loadPreset(BYO), BYO);
  assert.equal((loadPreset(BYO).seed_employers ?? []).length, 0);
  const have = named();
  for (const id of CORE) assert.ok(have.includes(id), `core preset ${id} present`);
  for (const id of have) {
    assert.doesNotThrow(() => loadPreset(id), id);
    const n = loadPreset(id).seed_employers.length;
    assert.ok(n >= 50 && n <= 150, `${id} has ${n} seed employers`);
  }
});

test('M-001-S5 the five new presets ship', () => {
  const have = named();
  for (const id of NEW_PRESETS) assert.ok(have.includes(id), `new preset ${id} present`);
});

// M-001-S6
test('M-001-S6 every github_lists field_map key is one of company title location date url clearance closed', () => {
  for (const id of ids()) {
    for (const src of loadPreset(id).github_lists ?? []) {
      for (const k of Object.keys(src.field_map ?? {})) assert.ok(KEYS.has(k), `${id} source ${src.name}: field_map key "${k}" not allowed`);
    }
  }
});

// M-001-S7
test('M-001-S7 OWNERS.yml has a pack-maintainer row with an ISO last_reviewed date for every preset file', () => {
  const owners = yaml.load(readFileSync(join(dir, 'OWNERS.yml'), 'utf8'));
  for (const id of [...ids(), ...NEW_PRESETS]) {
    assert.ok(owners[id], `OWNERS.yml entry for ${id}`);
    assert.equal(owners[id].owner, 'pack-maintainer', id);
    assert.match(String(owners[id].last_reviewed), /^\d{4}-\d{2}-\d{2}$/, id);
  }
  for (const id of NEW_PRESETS) assert.equal(String(owners[id].last_reviewed), '2026-10-29', id);
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
