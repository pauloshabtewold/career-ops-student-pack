import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { loadPreset, loadMerged } from '../../lib/presets.mjs';
import { isEligible } from '../../plugins/github-lists/_eligibility.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';
import { CYCLE } from '../helpers/feed-harness.mjs';

const NAMED = [
  'software-cs', 'mis-business-analytics', 'finance-economics', 'accounting', 'engineering-mech-elec',
  'policy-government', 'supply-chain-operations', 'statistics-math-actuarial', 'marketing-business',
  'consulting', 'cybersecurity', 'nursing',
];
const BYO = 'byo-employer-list';
const COLUMNS = ['Preset', 'Seeds', 'ok', 'small', 'empty', 'error', 'no-provider', 'removed'];
// Default 0.7; documented exceptions (each at least 0.5) only for presets whose milestone reported a lower best ratio.
const TARGETS = new Map([['policy-government', 0.4]]);
const targetFor = (id) => TARGETS.get(id) ?? 0.7;

const read = (...p) => readFileSync(join(PACK_ROOT, ...p), 'utf8');
const auditDoc = () => read('docs', 'preset-audit.md');

function parseTable(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells[0] === 'Preset' || /^-+$/.test(cells[0])) continue;
    rows.push(cells);
  }
  return rows;
}

const presetIds = () => readdirSync(join(PACK_ROOT, 'presets')).filter((f) => f.endsWith('.yml') && f !== 'OWNERS.yml').map((f) => f.slice(0, -4));

// M-015-S1
test('M-015-S1 presets/ holds exactly the twelve named presets plus byo-employer-list and OWNERS.yml has exactly those keys', () => {
  const expected = [...NAMED, BYO].sort();
  assert.deepEqual(presetIds().sort(), expected);
  const owners = yaml.load(read('presets', 'OWNERS.yml'));
  assert.deepEqual(Object.keys(owners).sort(), expected);
});

// M-015-S2
test('M-015-S2 preset-audit.md has one row per preset and the Seeds cell equals the live seed count', () => {
  const rows = parseTable(auditDoc());
  assert.deepEqual(rows.map((r) => r[0]).sort(), [...NAMED, BYO].sort());
  for (const r of rows) {
    assert.equal(r.length, COLUMNS.length, `${r[0]} cell count`);
    assert.equal(Number(r[1]), loadPreset(r[0]).seed_employers.length, `${r[0]} Seeds`);
  }
});

// M-015-S3
test('M-015-S3 every named preset row has error 0, empty 0 and ok+small at least its TARGETS ratio', () => {
  for (const [id, t] of TARGETS) assert.ok(id === 'policy-government' ? t === 0.4 : t >= 0.5, `${id} target ${t}`);
  const rows = parseTable(auditDoc());
  for (const id of NAMED) {
    const r = rows.find((x) => x[0] === id);
    assert.ok(r, `row for ${id}`);
    const [seeds, ok, small, empty, error] = r.slice(1, 6).map(Number);
    assert.equal(error, 0, `${id} error`);
    assert.equal(empty, 0, `${id} empty`);
    assert.ok(ok + small >= targetFor(id) * seeds, `${id}: ok+small ${ok + small} of ${seeds} below ${targetFor(id)}`);
  }
});

// M-015-S4
test('M-015-S4 audit date is ISO and upstream version equals compat.json upstream.max', () => {
  const doc = auditDoc();
  const date = doc.match(/^Audit date:\s*(.+)$/m);
  assert.ok(date, 'Audit date line');
  assert.match(date[1].trim(), /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!Number.isNaN(Date.parse(date[1].trim())), 'valid calendar date');
  const ver = doc.match(/^Upstream version:\s*(.+)$/m);
  assert.ok(ver, 'Upstream version line');
  assert.equal(ver[1].trim(), JSON.parse(read('compat.json')).upstream.max);
});

// M-015-S5
test('M-015-S5 preset-audit.md has no URL, no seed employer name, and only well-formed rows', () => {
  const doc = auditDoc();
  const url = doc.match(/https?:\/\//);
  assert.equal(url, null, `URL found: ${url?.[0]}`);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const id of presetIds()) {
    for (const e of loadPreset(id).seed_employers) {
      const re = new RegExp(`(?<![A-Za-z0-9])${esc(e.name)}(?![A-Za-z0-9])`);
      const m = doc.match(re);
      assert.equal(m, null, `seed employer name in doc: "${m?.[0]}" (from ${id})`);
    }
  }
  for (const r of parseTable(doc)) {
    assert.ok([...NAMED, BYO].includes(r[0]), `row first cell not a preset id: "${r[0]}"`);
    for (const c of r.slice(1)) {
      const okCell = /^\d+$/.test(c) || (c === '-' && r[0] === BYO);
      assert.ok(okCell, `bad count cell "${c}" in row ${r[0]}`);
    }
  }
});

// M-015-S6
test('M-015-S6 architecture.md states a named preset count equal to the presets/ count', () => {
  const words = { nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13 };
  const m = read('docs', 'architecture.md').match(/\b(\d+|[a-z]+) named presets\b/i);
  assert.ok(m, 'named preset count phrase');
  const stated = /^\d+$/.test(m[1]) ? Number(m[1]) : words[m[1].toLowerCase()];
  assert.equal(stated, presetIds().filter((i) => i !== BYO).length);
  assert.equal(stated, 12);
});

// M-015-S7
test('M-015-S7 a preset with TARGETS below 0.7 has a coverage note sentence with watch-only and a percentage', () => {
  for (const id of NAMED.filter((i) => targetFor(i) < 0.7)) {
    const sentences = loadPreset(id).coverage.note.split(/(?<=[.!?])\s+/);
    assert.ok(sentences.some((s) => /watch-only/i.test(s) && /\d+(\.\d+)?\s*%/.test(s)), `${id} coverage note lacks a watch-only percentage sentence`);
  }
});

// M-015-S8
test('M-015-S8 header says counts come from a manual authoritative audit and the monthly workflow opens issues without editing the file', () => {
  const doc = auditDoc();
  assert.match(doc, /counts come from a manual authoritative audit run/i);
  assert.match(doc, /docs\/maintenance\.md/);
  assert.match(doc, /monthly workflow opens issues and does not edit this file/i);
  assert.doesNotMatch(doc, /monthly workflow updates this table/i);
});

// M-015-S9
function eligible(m, title) {
  const row = { company: 'Example Brands', title, location: 'Austin, TX', date: '2026-09-15', url: 'https://example.edu/jobs/1', kind: 'internship' };
  return isEligible(row, { cycle: CYCLE, titleRules: m.title_rules, earlyCareer: m.early_career });
}

const ENG_PARTNERS = [
  ['cybersecurity', 'Security Engineer Intern'],
  ['supply-chain-operations', 'Industrial Engineer Intern'],
  ['engineering-mech-elec', 'Mechanical Engineer Intern'],
  ['software-cs', 'Software Engineer Intern'],
];
const SDR_PARTNERS = ['supply-chain-operations', 'statistics-math-actuarial', 'consulting', 'cybersecurity'];

test('M-015-S9 marketing-business merged with a partner keeps the partner engineering title eligible in both orders', () => {
  for (const [partner, title] of ENG_PARTNERS) {
    for (const ids of [['marketing-business', partner], [partner, 'marketing-business']]) {
      const r = eligible(loadMerged(ids), title);
      assert.equal(r.ok, true, `${ids.join('+')} ${title}: ${r.reason}`);
    }
  }
});

test('M-015-S9 marketing-business merged with a partner keeps Sales Development Intern eligible in both orders', () => {
  for (const partner of SDR_PARTNERS) {
    for (const ids of [['marketing-business', partner], [partner, 'marketing-business']]) {
      const r = eligible(loadMerged(ids), 'Sales Development Intern');
      assert.equal(r.ok, true, `${ids.join('+')}: ${r.reason}`);
    }
  }
});
