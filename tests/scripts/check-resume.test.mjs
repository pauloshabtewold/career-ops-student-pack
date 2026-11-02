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
import { makePdf } from '../helpers/mini-pdf.mjs';

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
const CONTACT_HTML = '<html><body><h1>Alex Example</h1><p>alex@example.com | (415) 555-0123</p><p>B.S. Computer Science, May 2027</p></body></html>';
const GOOD_LINES = ['Alex Example', 'alex@example.com | 415-555-0123', 'B.S. Computer Science, May 2027', 'Intern, Example Corp, Jun 2025 - Aug 2025'];

const textPdf = (pages = [GOOD_LINES]) => makePdf(pages);

function files(r, pages, html = GOOD_HTML, pdf = makePdf(Array.from({ length: pages }, () => GOOD_LINES))) {
  writeFileSync(r.file('data/resume.pdf'), pdf);
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
test('M-004-S14 checkResume passes a PDF within the page limit and an HTML source with the graduation date', async () => {
  const r = makeRoot();
  try {
    const argv = files(r, 1);
    const res = await checkResume({ pdf: argv[1], html: argv[3], variant: 'grad-a', config: CONFIG });
    assert.equal(res.code, 0);
    assert.deepEqual(res.problems ?? [], []);
  } finally {
    r.cleanup();
  }
});

// M-004-S14
test('M-004-S14 the CLI exits 0 when the PDF and source match the variant', async () => {
  const r = makeRoot({ config: CONFIG_YAML });
  try {
    const out = runScript('check-resume', [...files(r, 1), '--variant', 'grad-a'], r);
    assert.equal(out.code, 0, out.stdout + out.stderr);
  } finally {
    r.cleanup();
  }
});

// M-004-S15
test('M-004-S15 too many pages exits 1 with one problem line', async () => {
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
test('M-004-S15 a wrong graduation date plus too many pages reports one line per problem', async () => {
  const r = makeRoot({ config: CONFIG_YAML });
  try {
    const out = runScript('check-resume', [...files(r, 2, '<p>B.S. Computer Science, December 2026</p>'), '--variant', 'grad-a'], r);
    assert.equal(out.code, 1);
    assert.equal(`${out.stdout}\n${out.stderr}`.split('\n').filter((l) => l.trim()).length, 2);
    const res = await checkResume({ pdf: r.file('data/resume.pdf'), html: r.file('data/resume.html'), variant: 'grad-a', config: CONFIG });
    assert.equal(res.code, 1);
    assert.equal(res.problems.length, 2);
  } finally {
    r.cleanup();
  }
});

// M-004-S15
test('M-004-S15 an unknown variant exits 2', async () => {
  const r = makeRoot({ config: CONFIG_YAML });
  try {
    const out = runScript('check-resume', [...files(r, 1), '--variant', 'no-such-variant'], r);
    assert.equal(out.code, 2);
    const res = await checkResume({ pdf: r.file('data/resume.pdf'), html: r.file('data/resume.html'), variant: 'no-such-variant', config: CONFIG });
    assert.equal(res.code, 2);
  } finally {
    r.cleanup();
  }
});

// M-004-S15
test('M-004-S15 the variant page limit differs per variant', async () => {
  const r = makeRoot({ config: CONFIG_YAML });
  try {
    const out = runScript('check-resume', [...files(r, 2, '<p>May 2028</p>'), '--variant', 'intern-a'], r);
    assert.equal(out.code, 0, out.stdout + out.stderr);
  } finally {
    r.cleanup();
  }
});

// W-027
async function textCase(lines, html = CONTACT_HTML) {
  const r = makeRoot({ config: CONFIG_YAML });
  try {
    const argv = files(r, 1, html, makePdf([lines]));
    const res = await checkResume({ pdf: argv[1], html: argv[3], variant: 'grad-a', config: CONFIG });
    const cli = runScript('check-resume', [...argv, '--variant', 'grad-a'], r);
    return { res, cli };
  } finally {
    r.cleanup();
  }
}

test('W-027 a PDF whose text shows the source email, phone and ASCII date ranges passes', async () => {
  const { res, cli } = await textCase(GOOD_LINES);
  assert.deepEqual(res.problems, []);
  assert.equal(cli.code, 0, cli.stdout + cli.stderr);
});

test('W-027 an email missing from the PDF text fails with one line', async () => {
  const { res, cli } = await textCase(GOOD_LINES.map((l) => l.replace('alex@example.com', 'alex at example dot com')));
  assert.equal(res.code, 1);
  assert.equal(res.problems.length, 1);
  assert.match(res.problems[0], /email alex@example\.com/);
  assert.equal(cli.code, 1);
  assert.match(cli.stdout, /^check-resume: email alex@example\.com/m);
});

test('W-027 a phone number missing from the PDF text fails, formatting differences do not', async () => {
  const bad = await textCase(GOOD_LINES.map((l) => l.replace('415-555-0123', '415-555-0199')));
  assert.equal(bad.res.problems.length, 1);
  assert.match(bad.res.problems[0], /phone \(415\) 555-0123/);
  const fmt = await textCase(GOOD_LINES.map((l) => l.replace('415-555-0123', '415.555.0123')));
  assert.deepEqual(fmt.res.problems, []);
});

test('W-027 an en dash or em dash between dates fails and says to use an ASCII hyphen', async () => {
  for (const dash of ['\u2013', '\u2014']) {
    const { res, cli } = await textCase(GOOD_LINES.map((l) => l.replace('Jun 2025 - Aug 2025', `Jun 2025 ${dash} Aug 2025`)));
    assert.equal(res.problems.length, 1, dash);
    assert.match(res.problems[0], /ASCII hyphen/);
    assert.equal(cli.code, 1);
  }
  const year = await textCase(['alex@example.com 415-555-0123', 'Example Corp 2023\u20132025']);
  assert.match(year.res.problems[0], /ASCII hyphen/);
  const ok = await textCase(['alex@example.com 415-555-0123', 'Example Corp 2023-2025, Present']);
  assert.deepEqual(ok.res.problems, []);
});

test('W-027 an image-only PDF with no text layer fails with the single no-text line', async () => {
  const { res, cli } = await textCase(null);
  assert.equal(res.code, 1);
  assert.equal(res.problems.length, 1);
  assert.match(res.problems[0], /no text layer/);
  assert.equal(cli.code, 1);
});

test('W-027 a source with no email or phone only gets the text-layer and dash checks', async () => {
  const { res } = await textCase(['Alex Example', 'B.S. Computer Science, May 2027'], GOOD_HTML);
  assert.deepEqual(res.problems, []);
});

test('W-027 a corrupt PDF reports one unreadable-text line instead of crashing', async () => {
  const r = makeRoot({ config: CONFIG_YAML });
  try {
    const argv = files(r, 1, CONTACT_HTML, Buffer.from('%PDF-1.4\nnot a real pdf\n%%EOF\n'));
    const res = await checkResume({ pdf: argv[1], html: argv[3], variant: 'grad-a', config: CONFIG });
    assert.equal(res.code, 1);
    assert.ok(res.problems.some((p) => /text layer could not be read/.test(p)), res.problems.join('|'));
  } finally {
    r.cleanup();
  }
});

// Glued words (W-027): a text layer with no spaces between words, the defect a personal ATS check found.
const LONG_HTML =
  '<html><head><style>.x { letter-spacing: 0.1em; }</style></head><body><h1>Alex Example</h1><p>alex@example.com | (415) 555-0123</p>' +
  '<p>B.S. Computer Science, May 2027</p><h2>Experience</h2><p>Software Engineering Intern, Example Corp, Jun 2025 - Aug 2025</p>' +
  '<p>Built internal dashboards with React and Node for the support team.</p><p>Reduced build times across three services.</p></body></html>';
const LONG_LINES = [
  'Alex Example',
  'alex@example.com | 415-555-0123',
  'B.S. Computer Science, May 2027',
  'Experience',
  'Software Engineering Intern, Example Corp, Jun 2025 - Aug 2025',
  'Built internal dashboards with React and Node for the support team.',
  'Reduced build times across three services.',
];

test('W-027 the test PDF builder writes real spaces between words in the text layer', async () => {
  const { extractPdfText } = await import('../../lib/pdf-text.mjs');
  const text = await extractPdfText(makePdf([LONG_LINES]));
  assert.match(text, /Built internal dashboards with React and Node/);
});

test('W-027 a normal resume text layer is not reported as glued', async () => {
  const { res } = await textCase(LONG_LINES, LONG_HTML);
  assert.deepEqual(res.problems, []);
});

test('W-027 words run together in the text layer fail with a fix hint', async () => {
  const glued = LONG_LINES.map((l, i) => (i >= 4 ? l.replace(/ /g, '') : l));
  const { res, cli } = await textCase(glued, LONG_HTML);
  assert.equal(res.code, 1);
  assert.equal(res.problems.length, 1, res.problems.join('|'));
  assert.match(res.problems[0], /runs words together \("[a-z]+"/);
  assert.match(res.problems[0], /re-render with real spaces/);
  assert.equal(cli.code, 1);
  assert.match(cli.stdout, /^check-resume: PDF text runs words together/m);
});

test('W-027 words positioned one by one with no space glyph (TJ chunks) are caught as glued', async () => {
  const chunked = LONG_LINES.map((l, i) => (i >= 4 ? l.split(' ') : l));
  const { res } = await textCase(chunked, LONG_HTML);
  assert.ok(res.problems.some((p) => /runs words together/.test(p)), res.problems.join('|'));
});

test('W-027 glued text is caught without usable source pairs by its long letter runs', async () => {
  const { gluedWords } = await import('../../scripts/check-resume.mjs');
  assert.equal(gluedWords('BuiltinternaldashboardswithReact and ReducedbuildtimesacrossthreeServices').length, 2);
  assert.deepEqual(gluedWords('Built internal dashboards with React. Reduced build times.'), []);
});
