import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyAnswers } from '../../interview/apply-answers.mjs';
import { loadStudentConfig } from '../../lib/config.mjs';
import { PACK_ROOT, TODAY } from '../helpers/script-harness.mjs';

const answersOf = (k) => JSON.parse(readFileSync(join(PACK_ROOT, 'tests', 'fixtures', 'answers', `${k}.json`), 'utf8'));

// M-001-S6
test('M-001-S6 apply-answers writes the five parsing keys at defaults that validate', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pack-pknobs-ia-'));
  for (const d of ['config', 'data', 'modes']) mkdirSync(join(root, d));
  writeFileSync(join(root, 'cv.md'), '# Jordan Testwell\n\nSkills: Python, Java, SQL\n');
  try {
    await applyAnswers({ answers: answersOf('cs'), root, today: TODAY });
    const cfg = await loadStudentConfig({ root });
    assert.ok(cfg, 'student.yml loads and validates');
    assert.equal(cfg.audit.duplicate_reason, 'first');
    assert.deepEqual([...cfg.rank.easy_apply_hosts], ['greenhouse', 'ashby', 'lever']);
    assert.equal(cfg.rank.contacts_format, 'stage');
    assert.equal(cfg.rank.metro_match, 'word');
    assert.equal(cfg.rank.hold_on_pending_connect, true);
    const raw = readFileSync(join(root, 'config', 'student.yml'), 'utf8');
    assert.match(raw, /^\s*duplicate_reason:\s*first/m);
    assert.match(raw, /easy_apply_hosts/);
    assert.match(raw, /^\s*contacts_format:\s*stage/m);
    assert.match(raw, /^\s*metro_match:\s*word/m);
    assert.match(raw, /^\s*hold_on_pending_connect:\s*true/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
