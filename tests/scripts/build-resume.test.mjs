// scripts/build-resume.mjs renders templates/resume/sample-cv.md into the template HTML and a PDF; the PDF step runs
// through an injected runner (no browser, no upstream call) that writes a text-layer PDF from the rendered HTML, the way
// a correct render lays the text out. lib/ats-text.mjs checks then run on the extracted text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractPdfText } from '../../lib/pdf-text.mjs';
import { makePdf } from '../helpers/mini-pdf.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const passed = (r) => (Array.isArray(r) ? r.length === 0 : r === true || r?.ok === true);
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

// Visible text of an HTML document, one line per block element.
function htmlLines(html) {
  const body = html.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  return decode(body.replace(/<\/(h[1-6]|p|li|div|section|header|tr)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// M-002-S7-osdr
test('M-002-S7-osdr build-resume renders sample-cv.md and check-resume passes reading order and line-break checks', async () => {
  const { parseCv, renderHtml, renderPdf, DEFAULT_ORDER } = await import('../../scripts/build-resume.mjs');
  const { readingOrder, midSentenceBreaks, splitWords, htmlSections } = await import('../../lib/ats-text.mjs');
  assert.deepEqual([...DEFAULT_ORDER], ['Education', 'Experience', 'Projects', 'Skills']);

  const dir = mkdtempSync(join(tmpdir(), 'pack-build-resume-'));
  try {
    const cv = parseCv(readFileSync(join(PACK_ROOT, 'templates', 'resume', 'sample-cv.md'), 'utf8'));
    const html = renderHtml(cv);
    assert.deepEqual(htmlSections(html), ['Education', 'Experience', 'Projects', 'Skills']);
    const htmlFile = join(dir, 'resume.html');
    const pdfFile = join(dir, 'resume.pdf');
    writeFileSync(htmlFile, html);

    const calls = [];
    const runner = (cmd, args = [], opts = {}) => {
      calls.push({ cmd, args, opts });
      writeFileSync(pdfFile, makePdf([htmlLines(html)]));
      return { code: 0, stdout: '', stderr: '', error: null };
    };
    await renderPdf({ root: dir, html: htmlFile, pdf: pdfFile, runner });
    assert.equal(calls.length, 1, 'one PDF render');
    assert.equal(calls[0].cmd, process.execPath, 'generate-pdf runs as a node child process');
    assert.ok(calls[0].args.some((a) => /generate-pdf\.mjs$/.test(String(a))), calls[0].args.join(' '));

    const text = await extractPdfText(readFileSync(pdfFile));
    const words = htmlLines(html).join(' ').split(/\s+/).filter((w) => /^[A-Za-z]{4,}$/.test(w));
    assert.ok(passed(readingOrder(text, htmlSections(html))), 'reading order matches the HTML section order');
    assert.ok(passed(midSentenceBreaks(text)), 'no line break inside a sentence');
    assert.ok(passed(splitWords(text, words)), 'no split words');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
