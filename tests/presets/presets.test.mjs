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
test('M-006-S12 every seed_employers entry carries name and careers_url, plus only a provider and its config, max_response_mb or watch_only', () => {
  const allowed = new Set(['name', 'careers_url', 'provider', 'api', 'phenom', 'ibm', 'apple', 'max_response_mb', 'watch_only']);
  for (const id of ids()) {
    const raw = yaml.load(readFileSync(join(dir, `${id}.yml`), 'utf8'));
    (raw.seed_employers ?? []).forEach((e, i) => {
      const keys = Object.keys(e);
      const at = `${id} seed_employers[${i}] (${e.name ?? 'unnamed'})`;
      assert.ok(keys.includes('name') && keys.includes('careers_url'), at);
      for (const k of keys) assert.ok(allowed.has(k), `${at} key ${k}`);
      if (!e.provider) assert.deepEqual(keys.filter((k) => k !== 'watch_only' && k !== 'max_response_mb').sort(), ['careers_url', 'name'], at);
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

// W-029: career-ops 1.39.0 refuses a board response over 10 MB unless the portals.yml entry raises it with max_response_mb.
test('W-029 a readable seed may raise the response cap with max_response_mb, with or without a provider', () => {
  for (const extra of [{ max_response_mb: 32 }, { max_response_mb: 12.5 }, { provider: 'phenom', max_response_mb: 20 }]) {
    assert.doesNotThrow(() => validatePreset(withSeed(extra), 'software-cs'), JSON.stringify(extra));
  }
});

test('W-029 max_response_mb must be a number above 0 and at most 100, and never on a watch-only seed', () => {
  for (const extra of [{ max_response_mb: 0 }, { max_response_mb: -5 }, { max_response_mb: '32' }, { max_response_mb: true }, { max_response_mb: 101 }, { watch_only: true, max_response_mb: 32 }]) {
    assert.throws(() => validatePreset(withSeed(extra), 'software-cs'), /seed_employers\[0\]/, JSON.stringify(extra));
  }
});

test('W-029 the boards over 10 MB on career-ops 1.39.0 carry max_response_mb in every preset that seeds them', () => {
  const capped = ['OpenAI', 'SpaceX', 'Lucid Motors', 'Veeva', 'Shield AI', 'Anduril'];
  const seen = new Set();
  for (const id of ids()) {
    for (const e of loadPreset(id).seed_employers.filter((s) => capped.includes(s.name))) {
      seen.add(e.name);
      assert.ok(e.max_response_mb > 10, `${id} ${e.name} max_response_mb`);
    }
  }
  assert.deepEqual([...seen].sort(), [...capped].sort());
});

test('W-029 a seed may name the apple provider with location, queries and teams', () => {
  assert.doesNotThrow(() => validatePreset(withSeed({ provider: 'apple', apple: { queries: ['supply chain'], teams: ['internships-STDNT-INTRN'] } }), 'software-cs'));
  assert.doesNotThrow(() => validatePreset(withSeed({ provider: 'apple', apple: { location: 'united-states-USA', queries: ['logistics'] } }), 'software-cs'));
  for (const extra of [{ provider: 'apple', apple: { queries: 'supply chain' } }, { provider: 'apple', apple: { team: ['x'] } }, { provider: 'apple', apple: { location: ['us'] } }]) {
    assert.throws(() => validatePreset(withSeed(extra), 'software-cs'), /seed_employers\[0\]/, JSON.stringify(extra));
  }
});

test('W-029 the Apple seed in supply-chain-operations is readable by the 1.39.0 apple provider, not watch-only', () => {
  const apple = loadPreset('supply-chain-operations').seed_employers.find((e) => e.name === 'Apple');
  assert.equal(apple.provider, 'apple');
  assert.equal(apple.watch_only, undefined);
  // The upstream provider throws on an entry with no queries and no teams, which printed an error on every scan.
  assert.ok((apple.apple.queries?.length ?? 0) + (apple.apple.teams?.length ?? 0) > 0);
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

// W-028: watch_only marks a hand-checked seed; it is true or absent and never sits next to a provider.
test('W-028 watch_only is accepted as true alone and rejected with any other value or beside a provider', () => {
  assert.doesNotThrow(() => validatePreset(withSeed({ watch_only: true }), 'software-cs'));
  for (const extra of [{ watch_only: false }, { watch_only: 'yes' }, { watch_only: true, provider: 'phenom' }, { watch_only: true, api: 'https://x.example.com' }]) {
    assert.throws(() => validatePreset(withSeed(extra), 'software-cs'), /seed_employers\[0\]/, JSON.stringify(extra));
  }
});

// M-001-S16-cdel
test('M-001-S16-cdel software-cs ships the zapplyjobs Internships-2027 and New-Grad-Software-Engineering-Jobs-2027 README lists', () => {
  const lists = loadPreset('software-cs').sources.github_lists;
  const pick = (name) => lists.find((l) => l.name === name);
  const intern = pick('zapply-intern');
  const newgrad = pick('zapply-newgrad');
  assert.ok(intern, 'zapply-intern list present');
  assert.ok(newgrad, 'zapply-newgrad list present');
  assert.deepEqual({ repo: intern.repo, path: intern.path, format: intern.format, kind: intern.kind }, { repo: 'zapplyjobs/Internships-2027', path: 'README.md', format: 'markdown-table', kind: 'internship' });
  assert.deepEqual({ repo: newgrad.repo, path: newgrad.path, format: newgrad.format, kind: newgrad.kind }, { repo: 'zapplyjobs/New-Grad-Software-Engineering-Jobs-2027', path: 'README.md', format: 'markdown-table', kind: 'newgrad' });
});

// M-001-S16-cdel
test('M-001-S16-cdel a preset alert accepts an optional site and search next to name and how, and any other key is unknown', () => {
  const withAlert = (alert) => {
    const p = structuredClone(loadPreset('byo-employer-list'));
    p.sources.alerts = [alert];
    return p;
  };
  const base = { name: 'Some alert', how: 'Turn it on.' };
  assert.doesNotThrow(() => validatePreset(withAlert(base), 'byo-employer-list'));
  for (const site of ['linkedin', 'handshake', 'simplify', 'indeed', 'usajobs', 'other']) {
    assert.doesNotThrow(() => validatePreset(withAlert({ ...base, site, search: 'data intern' }), 'byo-employer-list'), site);
  }
  assert.doesNotThrow(() => validatePreset(withAlert({ ...base, site: 'linkedin' }), 'byo-employer-list'), 'site alone');
  assert.doesNotThrow(() => validatePreset(withAlert({ ...base, search: 'data intern' }), 'byo-employer-list'), 'search alone');
  assert.throws(() => validatePreset(withAlert({ ...base, color: 'red' }), 'byo-employer-list'), /color/);
  assert.throws(() => validatePreset(withAlert({ ...base, site: 'myspace' }), 'byo-employer-list'), /site/);
  assert.throws(() => validatePreset(withAlert({ ...base, search: '' }), 'byo-employer-list'), /search/);
  assert.throws(() => validatePreset(withAlert({ ...base, site: 'linkedin', search: 5 }), 'byo-employer-list'), /search/);
});

// M-001-S16-cdel
test('M-001-S16-cdel software-cs Handshake and LinkedIn alerts carry a site and a search', () => {
  const alerts = loadPreset('software-cs').sources.alerts;
  for (const site of ['handshake', 'linkedin']) {
    const hit = alerts.find((a) => a.site === site);
    assert.ok(hit, `${site} alert with a site key`);
    assert.ok(typeof hit.search === 'string' && hit.search.length > 0, `${site} alert has a search`);
  }
});

// M-001-S16-cdel
test('M-001-S16-cdel engineering-mech-elec carries a Handshake alert with search engineering intern and a LinkedIn alert with search electrical engineering intern', () => {
  const alerts = loadPreset('engineering-mech-elec').sources.alerts;
  assert.equal(alerts.find((a) => a.site === 'handshake')?.search, 'engineering intern');
  assert.equal(alerts.find((a) => a.site === 'linkedin')?.search, 'electrical engineering intern');
});

// M-001-S16-cdel
test('M-001-S16-cdel the other field presets carry Handshake and LinkedIn alerts with a search, policy-government adds usajobs, tip-only entries keep no site', () => {
  const FIELD = ['accounting', 'consulting', 'cybersecurity', 'finance-economics', 'marketing-business', 'mis-business-analytics', 'nursing', 'policy-government', 'statistics-math-actuarial', 'supply-chain-operations'];
  for (const id of FIELD) {
    const alerts = loadPreset(id).sources.alerts;
    for (const site of ['handshake', 'linkedin']) {
      const hit = alerts.find((a) => a.site === site);
      assert.ok(hit, `${id}: ${site} alert`);
      assert.ok(typeof hit.search === 'string' && hit.search.length > 0, `${id}: ${site} search`);
    }
  }
  assert.ok(loadPreset('policy-government').sources.alerts.some((a) => a.site === 'usajobs'), 'policy-government usajobs entry');
  assert.equal(loadPreset('nursing').sources.alerts.find((a) => a.name === 'Hospital residency pages')?.site, undefined);
  assert.ok(loadPreset('nursing').sources.alerts.some((a) => a.name === 'Hospital residency pages'), 'the tip-only entry stays');
  assert.equal(loadPreset('policy-government').sources.alerts.find((a) => a.name === 'Think tank pages')?.site, undefined);
});
