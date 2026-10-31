import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import * as yaml from 'js-yaml';
import { loadPreset, validatePreset } from '../../lib/presets.mjs';
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
test('M-006-S12 every seed_employers entry carries name and careers_url, plus only a provider and its config', () => {
  const allowed = new Set(['name', 'careers_url', 'provider', 'api', 'phenom', 'ibm']);
  for (const id of ids()) {
    const raw = yaml.load(readFileSync(join(dir, `${id}.yml`), 'utf8'));
    (raw.seed_employers ?? []).forEach((e, i) => {
      const keys = Object.keys(e);
      const at = `${id} seed_employers[${i}] (${e.name ?? 'unnamed'})`;
      assert.ok(keys.includes('name') && keys.includes('careers_url'), at);
      for (const k of keys) assert.ok(allowed.has(k), `${at} key ${k}`);
      if (!e.provider) assert.deepEqual(keys.sort(), ['careers_url', 'name'], at);
    });
  }
});

const seed = (extra) => ({ name: 'Example Co', careers_url: 'https://careers.example.com', ...extra });
const withSeed = (extra) => {
  const p = structuredClone(loadPreset('software-cs'));
  p.seed_employers = [seed(extra)];
  return p;
};

test('W-019 a seed may carry a provider from the allowlist with only the config keys it reads', () => {
  const good = [
    { provider: 'phenom', phenom: { lang: 'en_us', country: 'us' } },
    { provider: 'phenom' },
    { provider: 'radancy' },
    { provider: 'radancy', api: 'https://careers.example.com/en/search-jobs' },
    { provider: 'jibeapply', api: 'https://careers.example.com/api/jobs' },
    { provider: 'ibm', ibm: { country: 'US', categories: ['Intern'] } },
  ];
  for (const extra of good) assert.doesNotThrow(() => validatePreset(withSeed(extra), 'software-cs'), JSON.stringify(extra));
});

test('W-019 a seed is rejected for an unknown provider, config without a provider, or a key the provider does not read', () => {
  const bad = [
    { provider: 'workday' },
    { provider: 'greenhouse', api: 'https://x.example.com' },
    { api: 'https://careers.example.com/api/jobs' },
    { phenom: { lang: 'en_us' } },
    { provider: 'ibm', phenom: { lang: 'en_us' } },
    { provider: 'jibeapply', ibm: { country: 'US' } },
    { provider: 'phenom', phenom: { widgetsApi: 'x' } },
    { provider: 'phenom', phenom: 'en_us' },
    { provider: 'ibm', ibm: { categories: 'Intern' } },
    { provider: 'jibeapply', api: 'http://careers.example.com/api/jobs' },
    { provider: 'radancy', max_pages: 5 },
    { enabled: true },
  ];
  for (const extra of bad) assert.throws(() => validatePreset(withSeed(extra), 'software-cs'), /seed_employers\[0\]/, JSON.stringify(extra));
});

test('W-019 name and careers_url stay required on a provider seed', () => {
  const p = withSeed({ provider: 'phenom' });
  delete p.seed_employers[0].careers_url;
  assert.throws(() => validatePreset(p, 'software-cs'), /seed_employers\[0\]/);
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

test('W-023-A3-7 unknown top-level, sources and title_rules keys are rejected, naming the key', () => {
  const base = () => structuredClone(loadPreset('policy-government'));
  const cases = [
    [(p) => { p.sourcez = {}; }, /sourcez/],
    [(p) => { p.sources.nyc_job = true; }, /sources\.nyc_job/],
    [(p) => { p.title_rules.exlude = ['x']; }, /title_rules\.exlude/],
  ];
  for (const [mutate, pattern] of cases) {
    const p = base();
    mutate(p);
    assert.throws(() => validatePreset(p, 'policy-government'), pattern);
  }
});
