// scripts/check-resume.mjs with the lib/ats-text.mjs checks: a hyphenated token or a date range split across lines in
// the extracted text fails and the failure names the token. Synthetic PDFs from tests/helpers/mini-pdf.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { checkResume } from '../../scripts/check-resume.mjs';
import { makePdf } from '../helpers/mini-pdf.mjs';
import { makeRoot, runScript } from '../helpers/script-harness.mjs';

const CONFIG_YAML = 'resume_variants:\n  - name: grad-a\n    track: newgrad\n    graduation: "2027-05"\n    page_limit: 1\n';
const CONFIG = { resume_variants: [{ name: 'grad-a', track: 'newgrad', graduation: '2027-05', page_limit: 1 }] };
const HTML =
  '<html><body><h1>Casey Sample</h1><p>B.S. Computer Science, May 2027</p><h2>Experience</h2>' +
  '<p>Fake Intern, Example Corp, 2023-2025</p><p>Built a real-time dashboard for the support team.</p></body></html>';
const INTACT = ['Casey Sample', 'B.S. Computer Science, May 2027', 'Experience', 'Fake Intern, Example Corp, 2023-2025', 'Built a real-time dashboard for the support team.'];
const SPLIT_TOKEN = ['Casey Sample', 'B.S. Computer Science, May 2027', 'Experience', 'Fake Intern, Example Corp, 2023-2025', 'Built a real-', 'time dashboard for the support team.'];
const SPLIT_RANGE = ['Casey Sample', 'B.S. Computer Science, May 2027', 'Experience', 'Fake Intern, Example Corp, 2023-', '2025', 'Built a real-time dashboard for the support team.'];

async function run(lines) {
  const r = makeRoot({ config: CONFIG_YAML });
  try {
    writeFileSync(r.file('data/resume.pdf'), makePdf([lines]));
    writeFileSync(r.file('data/resume.html'), HTML);
    const res = await checkResume({ pdf: r.file('data/resume.pdf'), html: r.file('data/resume.html'), variant: 'grad-a', config: CONFIG });
    const cli = runScript('check-resume', ['--pdf', r.file('data/resume.pdf'), '--html', r.file('data/resume.html'), '--variant', 'grad-a'], r);
    return { res, cli };
  } finally {
    r.cleanup();
  }
}

// M-002-S19-osdr
test('M-002-S19-osdr hyphenated tokens and date ranges never split across lines in extracted resume text', async () => {
  const { brokenHyphenTokens } = await import('../../lib/ats-text.mjs');
  const source = 'Fake Intern, Example Corp, 2023-2025. Built a real-time dashboard for the support team.';
  assert.deepEqual(brokenHyphenTokens('Fake Intern, Example Corp, 2023-2025\nBuilt a real-\ntime dashboard', source), ['real-time']);
  assert.deepEqual(brokenHyphenTokens('Fake Intern, Example Corp, 2023-\n2025\nBuilt a real-time dashboard', source), ['2023-2025']);

  const ok = await run(INTACT);
  assert.deepEqual(ok.res.problems, [], 'intact text passes');

  const token = await run(SPLIT_TOKEN);
  assert.equal(token.res.code, 1);
  assert.ok(token.res.problems.some((p) => p.includes('real-time')), token.res.problems.join('|'));
  assert.equal(token.cli.code, 1);
  assert.match(token.cli.stdout, /real-time/);

  const range = await run(SPLIT_RANGE);
  assert.equal(range.res.code, 1);
  assert.ok(range.res.problems.some((p) => p.includes('2023-2025')), range.res.problems.join('|'));
});
