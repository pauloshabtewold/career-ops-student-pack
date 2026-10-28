import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyAnswers } from '../../interview/apply-answers.mjs';
import { loadStudentConfig } from '../../lib/config.mjs';
import { PACK_ROOT, TODAY } from '../helpers/script-harness.mjs';

const answersOf = (k) => JSON.parse(readFileSync(join(PACK_ROOT, 'tests', 'fixtures', 'answers', `${k}.json`), 'utf8'));

// M-001-S8
test('M-001-S8 apply-answers writes audit block and new rank keys at defaults that validate', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pack-knobs-ia-'));
  for (const d of ['config', 'data', 'modes']) mkdirSync(join(root, d));
  try {
    await applyAnswers({ answers: answersOf('cs'), root, today: TODAY });
    const cfg = await loadStudentConfig({ root });
    assert.ok(cfg, 'student.yml loads and validates');
    assert.deepEqual([...cfg.audit.exclude_reasons], []);
    assert.equal(cfg.audit.require_triage, false);
    assert.equal(cfg.audit.keyword_match, 'word');
    assert.deepEqual({ ...cfg.rank.company_caps }, {});
    assert.deepEqual([...cfg.rank.intern_only], []);
    assert.equal(cfg.rank.one_track_per_company, false);
    assert.deepEqual([...cfg.rank.ignore_words], []);
    const raw = readFileSync(join(root, 'config', 'student.yml'), 'utf8');
    assert.match(raw, /^audit:/m, 'audit block written to the file');
    assert.match(raw, /company_caps/);
    assert.match(raw, /ignore_words/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
