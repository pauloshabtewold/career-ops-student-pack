// Read failures in the interview scripts: an unreadable cv_path, a malformed portals.yml, and an unreadable detect-field
// input. Each stops with a one-line reason; the two apply-answers cases write no file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyAnswers, AnswersError } from '../../interview/apply-answers.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';
import { readFileSync } from 'node:fs';

const TODAY = '2026-10-29';
const answersOf = (k) => JSON.parse(readFileSync(join(PACK_ROOT, 'tests', 'fixtures', 'answers', `${k}.json`), 'utf8'));

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'pack-read-errors-'));
  for (const d of ['config', 'data', 'modes']) mkdirSync(join(root, d));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const files = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)).map((f) => join(n, f)) : [n])).sort();

test('an unreadable cv_path raises AnswersError naming the path and writes no file', async () => {
  const r = scratch();
  try {
    const { cv_markdown, ...answers } = answersOf('cs');
    const before = files(r.root);
    await assert.rejects(applyAnswers({ answers: { ...answers, cv_path: 'missing/resume.md' }, root: r.root, today: TODAY }), (err) => {
      assert.ok(err instanceof AnswersError);
      assert.match(err.message, /cv_path missing\/resume\.md cannot be read \(ENOENT\)/);
      return true;
    });
    assert.deepEqual(files(r.root), before);
  } finally {
    r.cleanup();
  }
});

test('a malformed portals.yml raises AnswersError naming portals.yml before any file is written', async () => {
  const r = scratch();
  try {
    writeFileSync(join(r.root, 'portals.yml'), 'title_filter: [unclosed\n');
    const before = files(r.root);
    const answers = { ...answersOf('cs'), cv_markdown: '# Jordan Testwell\n\nSkills: Python\n' };
    await assert.rejects(applyAnswers({ answers, root: r.root, today: TODAY }), (err) => {
      assert.ok(err instanceof AnswersError,`${err?.name}: ${err?.message}`);
      assert.match(err.message, /portals\.yml cannot be parsed/);
      return true;
    });
    assert.deepEqual(files(r.root), before);
    assert.equal(existsSync(join(r.root, 'config', 'student.yml')), false);
    assert.equal(existsSync(join(r.root, 'cv.md')), false);
  } finally {
    r.cleanup();
  }
});

test('detect-field on a file that cannot be read exits non-zero with a one-line reason', () => {
  const r = scratch();
  try {
    const res = spawnSync(process.execPath, [join(PACK_ROOT, 'interview', 'detect-field.mjs'), join(r.root, 'no-such-resume.md')], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 30000 });
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /cannot read .*no-such-resume\.md: ENOENT/);
    assert.equal(res.stdout, '');
  } finally {
    r.cleanup();
  }
});
