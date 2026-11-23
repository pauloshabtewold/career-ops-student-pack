// Assumed (M-005): lib/skill-gap.mjs skillGaps(jobTexts, cvText) returns the requirement phrases seen in MIN_POSTINGS or
// more of the given job texts and absent from cv.md, each as a string or an object naming the phrase (with an optional
// suggestion from SUGGESTIONS). requirementPhrases(jobText) extracts the phrases of one posting. Fake postings only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIN_POSTINGS, skillGaps } from '../../lib/skill-gap.mjs';

const posting = (company, skills) => [`Data Analyst Intern at ${company}`, '', 'Requirements:', ...skills.map((s) => `- Experience with ${s}`), ''].join('\n');
const CV = ['# Sam Placeholder', '', '## Skills', '', '- SQL', '- Excel', '- Python', ''].join('\n');
const label = (g) => (typeof g === 'string' ? g : JSON.stringify(g));

// M-005-S5-osdr
test('M-005-S5-osdr the Sunday digest names a requirement seen in 3 matched postings and absent from cv.md', () => {
  assert.equal(MIN_POSTINGS, 3);
  const jobs = [
    posting('Northwind Robotics', ['SQL', 'Tableau', 'Docker']),
    posting('Contoso Analytics', ['SQL', 'Tableau', 'Docker']),
    posting('Fabrikam Labs', ['SQL', 'Tableau']),
  ];
  const gaps = skillGaps(jobs, CV).map(label);
  assert.ok(gaps.some((g) => /tableau/i.test(g)), `Tableau is in 3 postings and not in cv.md: ${gaps.join(' | ')}`);
  assert.ok(!gaps.some((g) => /docker/i.test(g)), 'Docker is in only 2 postings');
  assert.ok(!gaps.some((g) => /\bSQL\b/.test(g)), 'SQL is already in cv.md');
});
