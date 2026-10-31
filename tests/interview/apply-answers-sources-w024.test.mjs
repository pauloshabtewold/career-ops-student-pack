// W-024 A4-8: sources_chosen absent keeps every preset GitHub list, [] keeps none, a named subset keeps those.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyAnswers } from '../../interview/apply-answers.mjs';
import { loadPreset } from '../../lib/presets.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const TODAY = '2026-10-29';
const base = JSON.parse(readFileSync(join(PACK_ROOT, 'tests', 'fixtures', 'answers', 'cs.json'), 'utf8'));
const ALL = loadPreset('software-cs').sources.github_lists.map((g) => g.name);

async function registryNames(chosen) {
  const root = mkdtempSync(join(tmpdir(), 'pack-w024-'));
  try {
    for (const d of ['config', 'data', 'modes']) mkdirSync(join(root, d));
    writeFileSync(join(root, 'cv.md'), '# Jordan Testwell\n\nSkills: Python\n');
    const { sources_chosen, ...rest } = base;
    await applyAnswers({ answers: chosen === undefined ? rest : { ...rest, sources_chosen: chosen }, root, today: TODAY });
    return JSON.parse(readFileSync(join(root, 'data', 'student-github-sources.json'), 'utf8')).sources.map((s) => s.name);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('W-024-A48 an absent sources_chosen keeps every preset list', async () => {
  assert.deepEqual((await registryNames(undefined)).sort(), [...ALL].sort());
});

test('W-024-A48 an empty sources_chosen keeps no list', async () => {
  assert.deepEqual(await registryNames([]), []);
});

test('W-024-A48 a named subset keeps only those lists, and github-lists keeps all', async () => {
  assert.deepEqual(await registryNames([ALL[0]]), [ALL[0]]);
  assert.deepEqual((await registryNames(['github-lists'])).sort(), [...ALL].sort());
});

test('W-024-A48 an empty sources_chosen says that no list was added', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pack-w024-'));
  try {
    for (const d of ['config', 'data', 'modes']) mkdirSync(join(root, d));
    writeFileSync(join(root, 'cv.md'), '# Jordan Testwell\n\nSkills: Python\n');
    const res = await applyAnswers({ answers: { ...base, sources_chosen: [] }, root, today: TODAY });
    assert.ok(res.notes.some((n) => /sources_chosen is empty, so no GitHub lists were added/.test(n)), res.notes.join('\n'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
