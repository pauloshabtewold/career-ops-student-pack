// Layering: shared helpers live in lib/, and every exported name has one meaning across the pack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PACK_ROOT } from '../helpers/budget-harness.mjs';

const read = (rel) => readFileSync(join(PACK_ROOT, rel), 'utf8');
const mjsIn = (dir) =>
  readdirSync(join(PACK_ROOT, dir))
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => `${dir}/${f}`);
const SKIP = new Set(['node_modules', '.git', 'tests', 'upstream']);
function packMjs(dir = '') {
  const out = [];
  for (const e of readdirSync(join(PACK_ROOT, dir), { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...packMjs(rel));
    else if (e.name.endsWith('.mjs')) out.push(rel);
  }
  return out;
}
const MOVED = ['VERDICT_RE', 'companyKey', 'classifyMail', 'NEWGRAD_TITLE', 'checkSafetyDiff'];
const importBlocks = (src) => [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g)].map((m) => ({ names: m[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean), from: m[2] }));
const exportedNames = (src) => {
  const names = [];
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)) names.push(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const n of m[1].split(',')) {
      const parts = n.trim().split(/\s+as\s+/);
      if (parts[0]) names.push((parts[1] ?? parts[0]).trim());
    }
  }
  return names;
};
const loadNs = (rel) => import(pathToFileURL(join(PACK_ROOT, rel)).href);

test('M-004-S1 tools/ and update.mjs import the moved helpers from lib, never from scripts/', () => {
  const files = [...mjsIn('tools'), 'update.mjs'];
  let moved = 0;
  for (const f of files) {
    for (const { names, from } of importBlocks(read(f))) {
      for (const n of names.filter((x) => MOVED.includes(x))) {
        moved += 1;
        assert.ok(!/scripts\//.test(from), `${f} imports ${n} from ${from}`);
        assert.ok(/lib\//.test(from), `${f} imports ${n} from ${from}, expected a lib module`);
      }
    }
  }
  assert.ok(moved > 0, 'at least one moved name is imported');
});

test('M-004-S2 each renamed or moved name is exported by exactly one pack module and no module exports bare classify or formatReport', () => {
  const owners = new Map();
  for (const f of packMjs()) {
    for (const n of exportedNames(read(f))) owners.set(n, [...(owners.get(n) ?? []), f]);
  }
  for (const n of ['applyVerdicts', 'classifyMail', 'classifySpecifier', 'formatFirstRunReport', 'formatParityReport']) {
    assert.equal((owners.get(n) ?? []).length, 1, `${n} exported by ${JSON.stringify(owners.get(n) ?? [])}`);
  }
  for (const n of ['classify', 'formatReport']) assert.deepEqual(owners.get(n) ?? [], [], `${n} still exported`);
});

test('M-004-S3 docs/architecture.md describes isMain, lib/run.mjs, lib/temp-dir.mjs and lib/safety-diff.mjs', () => {
  const doc = read('docs/architecture.md');
  for (const w of ['isMain', 'lib/run.mjs', 'lib/temp-dir.mjs', 'lib/safety-diff.mjs']) assert.ok(doc.includes(w), `architecture.md lacks ${w}`);
  assert.ok(doc.includes('scripts/check-safety-tag.mjs'), 'still names the gate');
});

test('M-004-S5 no file under scripts/ exports a moved name directly or by re-export', () => {
  for (const f of mjsIn('scripts')) {
    const src = read(f);
    const direct = exportedNames(src).filter((n) => MOVED.includes(n));
    assert.deepEqual(direct, [], `${f} exports ${direct.join(', ')}`);
    for (const m of src.matchAll(/export\s*(?:\*|\{([^}]*)\})\s*from\s*['"][^'"]+['"]/g)) {
      const names = (m[1] ?? '*').split(',').map((n) => n.trim().split(/\s+as\s+/).pop());
      for (const n of names) assert.ok(!MOVED.includes(n), `${f} re-exports ${n}`);
    }
  }
});

test('M-004-S6 apply-triage exports applyVerdicts and daily-triage defines runApplyTriage without exporting applyVerdicts', () => {
  assert.ok(exportedNames(read('scripts/apply-triage.mjs')).includes('applyVerdicts'));
  const daily = read('scripts/daily-triage.mjs');
  assert.ok(/\brunApplyTriage\b/.test(daily), 'runApplyTriage defined');
  assert.ok(!exportedNames(daily).includes('applyVerdicts'), 'daily-triage exports applyVerdicts');
  assert.ok(!/\bfunction\s+applyVerdicts\b/.test(daily), 'daily-triage still defines applyVerdicts');
});

test('M-004-S8 checkSafetyDiff is undefined on check-safety-tag and classify is undefined on inbox', async () => {
  assert.equal((await loadNs('scripts/check-safety-tag.mjs')).checkSafetyDiff, undefined);
  assert.equal((await loadNs('scripts/inbox.mjs')).classify, undefined);
});

test('M-004-S9 formatReport is undefined on first-run and parity-compare and classify is undefined on lint-imports', async () => {
  assert.equal((await loadNs('scripts/first-run.mjs')).formatReport, undefined);
  assert.equal((await loadNs('tools/parity-compare.mjs')).formatReport, undefined);
  assert.equal((await loadNs('scripts/lint-imports.mjs')).classify, undefined);
});
