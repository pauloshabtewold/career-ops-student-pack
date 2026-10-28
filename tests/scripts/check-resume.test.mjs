// Assumed: scripts/check-resume.mjs exports countPdfPages(buffer) -> number and
// checkResume({ pdf, html, variant, config }) -> { code, problems } where pdf and html are file paths and config
// carries resume_variants [{ name, track, graduation: 'YYYY-MM', page_limit }]. The source must carry the
// graduation month name and year (for example "May 2027"). CLI: --pdf F --html F --variant NAME with --root.
// Problems print one per line on stdout or stderr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { countPdfPages, checkResume } from '../../scripts/check-resume.mjs';
import { makeRoot, runScript } from '../helpers/script-harness.mjs';

const pdfWith = (pages, { tight = false } = {}) =>
  Buffer.from(
    [
      '%PDF-1.4',
      '1 0 obj',
      `<< /Type /Pages /Count ${pages} >>`,
      'endobj',
      ...Array.from({ length: pages }, (_, i) => `${i + 2} 0 obj\n<< ${tight ? '/Type/Page' : '/Type /Page'} /Parent 1 0 R >>\nendobj`),
      '%%EOF',
      '',
    ].join('\n'),
  );

const CONFIG_YAML = 'resume_variants:\n  - name: grad-a\n    track: newgrad\n    graduation: "2027-05"\n    page_limit: 1\n  - name: intern-a\n    track: internship\n    graduation: "2028-05"\n    page_limit: 2\n';
const CONFIG = { resume_variants: [{ name: 'grad-a', track: 'newgrad', graduation: '2027-05', page_limit: 1 }, { name: 'intern-a', track: 'internship', graduation: '2028-05', page_limit: 2 }] };
const GOOD_HTML = '<html><body><h1>Alex Example</h1><p>B.S. Computer Science, May 2027</p></body></html>';

function files(r, pages, html = GOOD_HTML) {
  writeFileSync(r.file('data/resume.pdf'), pdfWith(pages));
  writeFileSync(r.file('data/resume.html'), html);
  return ['--pdf', r.file('data/resume.pdf'), '--html', r.file('data/resume.html')];
}

// M-004-S14
test('M-004-S14 countPdfPages counts Page objects and not Pages, in whitespace variants', () => {
  assert.equal(countPdfPages(pdfWith(1)), 1);
  assert.equal(countPdfPages(pdfWith(3)), 3);
  assert.equal(countPdfPages(pdfWith(2, { tight: true })), 2);
  assert.equal(countPdfPages(Buffer.from('<< /Type  /Page\n/Parent 1 0 R >> << /Type /Pages >>')), 1);
});

// M-004-S14
test('M-004-S14 checkResume passes a PDF within the page limit and an HTML source with the graduation date', () => {
  const r = makeRoot();
  try {
    const argv = files(r, 1);
    const res = checkResume({ pdf: argv[1], html: argv[3], variant: 'grad-a', config: CONFIG });
    assert.equal(res.code, 0);
    assert.deepEqual(res.problems ?? [], []);
  } finally {
    r.cleanup();
  }
});

// M-004-S14
test('M-004-S14 the CLI exits 0 when the PDF and source match the variant', () => {
  const r = makeRoot({ config: CONFIG_YAML });
  try {
    const out = runScript('check-resume', [...files(r, 1), '--variant', 'grad-a'], r);
    assert.equal(out.code, 0, out.stdout + out.stderr);
  } finally {
    r.cleanup();
  }
});

// M-004-S15
test('M-004-S15 too many pages exits 1 with one problem line', () => {
  const r = makeRoot({ config: CONFIG_YAML });
  try {
    const out = runScript('check-resume', [...files(r, 3), '--variant', 'grad-a'], r);
    assert.equal(out.code, 1);
    assert.equal(`${out.stdout}\n${out.stderr}`.split('\n').filter((l) => l.trim()).length, 1);
  } finally {
    r.cleanup();
  }
});

// M-004-S15
test('M-004-S15 a wrong graduation date plus too many pages reports one line per problem', () => {
  const r = makeRoot({ config: CONFIG_YAML });
  try {
    const out = runScript('check-resume', [...files(r, 2, '<p>B.S. Computer Science, December 2026</p>'), '--variant', 'grad-a'], r);
    assert.equal(out.code, 1);
    assert.equal(`${out.stdout}\n${out.stderr}`.split('\n').filter((l) => l.trim()).length, 2);
    const res = checkResume({ pdf: r.file('data/resume.pdf'), html: r.file('data/resume.html'), variant: 'grad-a', config: CONFIG });
    assert.equal(res.code, 1);
    assert.equal(res.problems.length, 2);
  } finally {
    r.cleanup();
  }
});

// M-004-S15
test('M-004-S15 an unknown variant exits 2', () => {
  const r = makeRoot({ config: CONFIG_YAML });
  try {
    const out = runScript('check-resume', [...files(r, 1), '--variant', 'no-such-variant'], r);
    assert.equal(out.code, 2);
    const res = checkResume({ pdf: r.file('data/resume.pdf'), html: r.file('data/resume.html'), variant: 'no-such-variant', config: CONFIG });
    assert.equal(res.code, 2);
  } finally {
    r.cleanup();
  }
});

// M-004-S15
test('M-004-S15 the variant page limit differs per variant', () => {
  const r = makeRoot({ config: CONFIG_YAML });
  try {
    const out = runScript('check-resume', [...files(r, 2, '<p>May 2028</p>'), '--variant', 'intern-a'], r);
    assert.equal(out.code, 0, out.stdout + out.stderr);
  } finally {
    r.cleanup();
  }
});
