import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { applyAnswers } from '../../interview/apply-answers.mjs';
import { loadStudentConfig } from '../../lib/config.mjs';
import { PACK_ROOT, TODAY } from '../helpers/script-harness.mjs';

const answersOf = (k) => JSON.parse(readFileSync(join(PACK_ROOT, 'tests', 'fixtures', 'answers', `${k}.json`), 'utf8'));

async function applyWith(answers) {
  const root = mkdtempSync(join(tmpdir(), 'pack-agent-ia-'));
  for (const d of ['config', 'data', 'modes']) mkdirSync(join(root, d));
  writeFileSync(join(root, 'cv.md'), '# Jordan Testwell\n\nSkills: Python, Java, SQL\n');
  try {
    await applyAnswers({ answers, root, today: TODAY });
    const written = yaml.load(readFileSync(join(root, 'config', 'student.yml'), 'utf8'));
    return { written, cfg: await loadStudentConfig({ root }) };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// M-002-S3
test('M-002-S3 answers with agent codex write agent: codex to config/student.yml', async () => {
  const { written, cfg } = await applyWith({ ...answersOf('cs'), agent: 'codex' });
  assert.equal(written.agent, 'codex');
  assert.equal(cfg.agent, 'codex');
});

// M-002-S3
test('M-002-S3 answers that omit agent write agent: claude', async () => {
  const answers = answersOf('cs');
  assert.equal('agent' in answers, false, 'fixture omits agent');
  const { written, cfg } = await applyWith(answers);
  assert.equal(written.agent, 'claude');
  assert.equal(cfg.agent, 'claude');
});
