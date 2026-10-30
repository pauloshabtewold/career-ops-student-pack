// resume-text.mjs CLI: `node interview/resume-text.mjs <file>` prints the resume text, one line per DOCX paragraph.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';
import { buildZip, docxBuffer } from '../helpers/docx.mjs';

const SCRIPT = join(PACK_ROOT, 'interview', 'resume-text.mjs');

function withFile(name, data, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'pack-resume-text-'));
  try {
    const file = join(dir, name);
    writeFileSync(file, data);
    const out = spawnSync(process.execPath, [SCRIPT, file], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 30000 });
    return fn({ code: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const PARAS = ['Jordan Testwell', ['Example Robotics Co, ', 'software intern'], 'Built tools for R&D <fast> teams'];
const EXPECTED = ['Jordan Testwell', 'Example Robotics Co, software intern', 'Built tools for R&D <fast> teams'];
const lines = (stdout) => stdout.replace(/\n+$/, '').split('\n');

// M-001-S10 normal: deflated word/document.xml
test('M-001-S10 resume-text prints one line per w:p paragraph from a deflated DOCX', () => {
  withFile('resume.docx', docxBuffer(PARAS), (res) => {
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(lines(res.stdout), EXPECTED);
  });
});

// M-001-S27 edge: stored (method 0) word/document.xml
test('M-001-S27 resume-text prints one line per w:p paragraph when the document entry is stored', () => {
  withFile('resume.docx', docxBuffer(PARAS, { method: 0 }), (res) => {
    assert.equal(res.code, 0, res.stderr);
    assert.deepEqual(lines(res.stdout), EXPECTED);
  });
});

test('M-001-S10 resume-text passes .md and .txt files through unchanged', () => {
  withFile('resume.md', '# Jordan Testwell\n\nSkills: Python\n', (res) => {
    assert.equal(res.code, 0, res.stderr);
    assert.equal(res.stdout, '# Jordan Testwell\n\nSkills: Python\n');
  });
  withFile('resume.txt', 'plain line one\nplain line two\n', (res) => {
    assert.equal(res.code, 0, res.stderr);
    assert.equal(res.stdout, 'plain line one\nplain line two\n');
  });
});

// M-001-S11 error
test('M-001-S11 resume-text exits 1 with a one-line reason for a file that is not a zip', () => {
  withFile('resume.docx', 'this is not a zip archive at all', (res) => {
    assert.equal(res.code, 1);
    assert.equal(res.stdout, '');
    const reason = res.stderr.trim();
    assert.ok(reason.length > 0 && !reason.includes('\n'), `one-line reason, got: ${JSON.stringify(res.stderr)}`);
  });
});

test('M-001-S11 resume-text exits 1 with a one-line reason for a zip without word/document.xml', () => {
  const zip = buildZip([{ name: 'notes/readme.txt', data: 'hello', method: 8 }]);
  withFile('resume.docx', zip, (res) => {
    assert.equal(res.code, 1);
    const reason = res.stderr.trim();
    assert.ok(reason.length > 0 && !reason.includes('\n'), `one-line reason, got: ${JSON.stringify(res.stderr)}`);
    assert.match(reason, /document\.xml/);
  });
});
