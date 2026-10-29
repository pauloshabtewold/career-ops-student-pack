// M-004-S1 to S7. The docs/upstream/ issue drafts, their delete-once-merged index and the big-tech feed decision.
// Failure messages name the offending file, path or entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { PACK_ROOT } from '../helpers/script-harness.mjs';
import { scanText } from '../../scripts/pii-lint.mjs';

const UPSTREAM = join(PACK_ROOT, 'docs', 'upstream');
const DRAFTS = [
  'cycle-logic.md',
  'github-lists-plugin.md',
  'liveness-sweep.md',
  'aggregator-resolver.md',
  'bigtech-providers.md',
];

const read = (rel) => readFileSync(join(PACK_ROOT, rel), 'utf8');
const upstreamFiles = () => (existsSync(UPSTREAM) ? readdirSync(UPSTREAM).filter((f) => f.endsWith('.md')) : []);
const draftFiles = () => upstreamFiles().filter((f) => f !== 'README.md');

// Rows of the delete-once-merged table: first cell links a draft, second cell holds backticked pack paths.
function tableRows() {
  const rows = [];
  for (const line of read('docs/upstream/README.md').split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const link = cells[0] && cells[0].match(/\]\(([^)\s#]+\.md)\)/);
    if (!link) continue;
    const paths = [...(cells[1] || '').matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    rows.push({ draft: link[1].replace(/^\.\//, ''), paths });
  }
  return rows;
}

function packDecisionSection() {
  const text = read('docs/upstream/bigtech-providers.md');
  const m = text.match(/^## Pack decision[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  assert.ok(m, 'docs/upstream/bigtech-providers.md has no "## Pack decision" heading');
  return m[1];
}

export const isBigTech = (entry) => /big-?tech/i.test(entry.name || '') || /big-?tech/i.test(entry.repo || '');

test('M-004-S1 the five drafts exist and open with a draft-not-posted status line', () => {
  const missing = DRAFTS.filter((f) => !existsSync(join(UPSTREAM, f)));
  assert.deepEqual(missing, [], `missing draft files: ${missing.map((f) => `docs/upstream/${f}`).join(', ')}`);
  for (const f of DRAFTS) {
    const head = read(`docs/upstream/${f}`).split('\n').slice(0, 5).join('\n');
    assert.ok(head.includes('Status: draft, not posted'), `docs/upstream/${f} lacks "Status: draft, not posted" in its first five lines`);
  }
});

test('M-004-S2 the README delete-once-merged table lists exactly the draft files present', () => {
  assert.ok(existsSync(join(UPSTREAM, 'README.md')), 'missing path: docs/upstream/README.md');
  const listed = tableRows().map((r) => r.draft).sort();
  assert.deepEqual(listed, draftFiles().sort(), 'table rows differ from the draft files in docs/upstream/');
});

test('M-004-S3 every pack path named in the table exists', () => {
  assert.ok(existsSync(join(UPSTREAM, 'README.md')), 'missing path: docs/upstream/README.md');
  const rows = tableRows();
  assert.ok(rows.length >= 5, 'table rows parsed');
  const named = rows.flatMap((r) => r.paths);
  assert.ok(named.length > 0, 'table names pack paths');
  const missing = named.filter((p) => !existsSync(join(PACK_ROOT, p)));
  assert.deepEqual(missing, [], `missing pack paths: ${missing.join(', ')}`);
});

test('M-004-S4 no upstream file holds an issue URL, a foreign github.com URL or a pii-lint finding', () => {
  const files = upstreamFiles();
  assert.ok(files.length >= 6, 'docs/upstream/ holds README.md and the five drafts');
  const bad = [];
  for (const f of files) {
    const rel = `docs/upstream/${f}`;
    const text = read(rel);
    if (/\/issues\/\d+/.test(text)) bad.push(`${rel}: issue URL`);
    for (const m of text.matchAll(/github\.com[/:]([^\s)>\]"'`]*)/gi)) {
      if (!/^career-ops-hq\/career-ops(?:[/#?.][^\s]*)?$/.test(m[1]) && m[1] !== 'career-ops-hq/career-ops') bad.push(`${rel}: github.com/${m[1]}`);
    }
    if (scanText(rel, text).length > 0) bad.push(`${rel}: pii-lint finding`);
  }
  assert.deepEqual(bad, [], `offending files: ${bad.join('; ')}`);
});

test('M-004-S5 bigtech-providers.md has a Pack decision section stating no big-tech feed ships', () => {
  assert.ok(existsSync(join(UPSTREAM, 'bigtech-providers.md')), 'missing path: docs/upstream/bigtech-providers.md');
  assert.ok(packDecisionSection().trim().startsWith('No big-tech feed ships in the pack.'), 'Pack decision section does not open with the sentence');
});

test('M-004-S6 the Pack decision section lists the vetting criteria and the revisit trigger', () => {
  assert.ok(existsSync(join(UPSTREAM, 'bigtech-providers.md')), 'missing path: docs/upstream/bigtech-providers.md');
  const section = packDecisionSection();
  assert.ok(section.includes('100 stars'), 'criterion "100 stars" missing');
  assert.ok(section.includes('one full recruiting cycle'), 'criterion "one full recruiting cycle" missing');
  assert.ok(/^\s*(?:[-*]\s+)?(?:\*\*)?Revisit when/m.test(section), 'no line starting with "Revisit when"');
});

test('M-004-S7 the big-tech predicate rejects synthetic entries and the software-cs preset has none', () => {
  assert.equal(isBigTech({ name: 'bigtech-x' }), true);
  assert.equal(isBigTech({ repo: 'example/Big-Tech-Jobs' }), true);
  assert.equal(isBigTech({ name: 'simplify-intern', repo: 'example/Internships' }), false);
  const preset = yaml.load(read('presets/software-cs.yml'));
  const lists = preset.sources.github_lists;
  assert.ok(Array.isArray(lists) && lists.length > 0, 'software-cs github_lists parsed');
  const hits = lists.filter(isBigTech).map((e) => e.name || e.repo);
  assert.deepEqual(hits, [], `big-tech github_lists entries: ${hits.join(', ')}`);
});
