// M-007 fix round 2, N2-1: the job text reaches fill-plan. Daily triage keeps the text it fetched in data/jds, chrome.mjs
// read-form saves the page's job text (JSON-LD JobPosting first, else the visible main text), fill-plan's CLI plans with
// the saved text (else upstream fetch-jd through the triage fetch gate), and saved text is never replaced by ''. Fake
// runner, fake CDP client, injected resume, letter and model fakes; no network or model call. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JD_DIR, jdFileName, load as loadJd, save as saveJd } from '../../lib/jd-store.mjs';
import { MIN_PAGE_JOB_WORDS, pageJobText, readForm } from '../../scripts/chrome.mjs';
import { dailyTriage } from '../../scripts/daily-triage.mjs';
import { fillPlans, jobTextFor } from '../../scripts/fill-plan.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';
import { args as triageArgs, jobUrl, makeRunner, makeTriageRoot, untriaged } from '../helpers/triage-harness.mjs';

const URL = 'https://boards.greenhouse.io/examplerobotics/jobs/7201';
const TODAY = '2026-11-03';
const words = (n, w = 'robotics') => Array.from({ length: n }, (_, i) => `${w}${i}`).join(' ');
const POSTING = `Example Robotics hires a Software Engineering Intern. Requirements: Python, SQL, testing. ${words(90)}`;

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-fix2-jd-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\n');
  writeFileSync(join(root, 'config', 'profile.yml'), 'candidate:\n  full_name: "Jordan Testwell"\n  email: "jordan.testwell@example.com"\n');
  writeFileSync(join(root, 'cv.md'), '# Jordan Testwell\n\njordan.testwell@example.com\n\n## Experience\n- Software Intern, Example Robotics: built a Python tool\n\n## Skills\nPython, SQL\n');
  return { root, dataDir, paths: { root, dataDir, packRoot: PACK_ROOT }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// M-007-fix2-N2-1a
test('M-007-fix2-N2-1a jd-store load returns saved text and an empty save never replaces it', () => {
  const r = scratch();
  try {
    assert.equal(loadJd(r.dataDir, URL), '');
    saveJd(r.dataDir, URL, POSTING);
    saveJd(r.dataDir, URL, '');
    assert.equal(loadJd(r.dataDir, URL), POSTING);
    saveJd(r.dataDir, URL, 'newer text');
    assert.equal(loadJd(r.dataDir, URL), 'newer text');
  } finally {
    r.cleanup();
  }
});

// M-007-fix2-N2-1b
test('M-007-fix2-N2-1b daily triage keeps the text it fetched in data/jds under the posting key', async () => {
  const r = makeTriageRoot({ pending: untriaged(2) });
  try {
    const { runner } = makeRunner(r, { fetch: (url) => `Posting text for ${url}. Requirements: Python.` });
    await dailyTriage({ ...triageArgs(r), runner });
    for (const n of [1, 2]) {
      const file = join(r.data, JD_DIR, jdFileName(jobUrl(n)));
      assert.match(readFileSync(file, 'utf8'), new RegExp(`Posting text for ${jobUrl(n).replace(/[.?]/g, '\\$&')}`));
    }
  } finally {
    r.cleanup();
  }
});

// M-007-fix2-N2-1c
test('M-007-fix2-N2-1c pageJobText takes the one JSON-LD JobPosting description, else the main text, else nothing', () => {
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Software Engineering Intern', description: `<p>${POSTING}</p>` });
  assert.match(pageJobText({ ld: [ld], main: 'Apply now' }), /^Software Engineering Intern\n\nExample Robotics hires/);
  assert.equal(pageJobText({ ld: [ld, ld], main: '' }), '', 'a page naming several postings gives nothing');
  assert.ok(pageJobText({ ld: ['{ not json'], main: POSTING }).includes('Requirements'), 'the visible main text is the fallback');
  assert.equal(pageJobText({ ld: [], main: words(MIN_PAGE_JOB_WORDS - 1) }), '', 'a short page shell is not a posting');
});

// M-007-fix2-N2-1d
test('M-007-fix2-N2-1d readForm returns the page job text next to the fields', async () => {
  const fields = [{ selector: '#email', id: 'email', name: 'email', type: 'email', label: 'Email' }];
  const send = async (method, params = {}) => {
    if (method === 'Target.createTarget') return { targetId: 'T1' };
    if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
    if (method !== 'Runtime.evaluate') return {};
    const expr = String(params.expression);
    if (expr.includes("querySelectorAll('input, select, textarea')")) return { result: { value: fields } };
    if (expr.includes('application/ld+json')) return { result: { value: { ld: [], main: POSTING } } };
    return { result: { value: null } };
  };
  const res = await readForm({ send, waitFor: () => Object.assign(Promise.resolve({}), { cancel: () => {} }), close: () => {}, opened: Promise.resolve() }, URL);
  assert.equal(res.fields.length, 1);
  assert.match(res.jobText, /Requirements: Python/);
});

// M-007-fix2-N2-1e
test('M-007-fix2-N2-1e fill-plan plans a triage 4.5 row with its saved job text: tailored resume and a letter written from the posting', async () => {
  const r = scratch();
  try {
    saveJd(r.dataDir, URL, POSTING);
    let fetched = 0;
    const fetch = async () => {
      fetched++;
      return { text: '' };
    };
    assert.equal(await jobTextFor({ paths: r.paths, url: URL, fetch }), POSTING);
    assert.equal(fetched, 0, 'saved text needs no fetch');
    const steps = [];
    let coverPosting = null;
    const deps = {
      fetchJob: (row) => jobTextFor({ paths: r.paths, url: row.url, fetch }),
      fieldsFor: () => [{ selector: '#cover_letter', id: 'cover_letter', name: 'cover_letter', type: 'file', label: 'Cover Letter' }, { selector: '#email', id: 'email', name: 'email', type: 'email', label: 'Email' }],
      headless: async (o) => {
        steps.push(o.step);
        return { text: '' };
      },
      writeCover: async (o) => {
        coverPosting = o.posting;
        const path = join(r.dataDir, 'letter.txt');
        writeFileSync(path, 'Dear hiring team at Example Robotics,\n\nI am applying for the Software Engineering Intern role.\n\nJordan Testwell\n');
        return path;
      },
      buildResume: async (o) => {
        mkdirSync(o.outDir, { recursive: true });
        writeFileSync(join(o.outDir, 'resume.html'), '<html><body>Jordan Testwell</body></html>');
        writeFileSync(join(o.outDir, 'resume.pdf'), '%PDF-1.4\n%%EOF\n');
        return { code: 0, html: join(o.outDir, 'resume.html'), pdf: join(o.outDir, 'resume.pdf') };
      },
      atsCheck: async () => ({ ok: true, problems: [] }),
    };
    const row = { url: URL, company: 'Example Robotics', title: 'Software Engineering Intern', score: 47, triage: 4.5 };
    await fillPlans({ paths: r.paths, rows: [row], today: TODAY, deps, say: () => {} });
    assert.ok(steps.includes('tailor-resume'), `the full path tailors the resume: ${steps.join(', ')}`);
    assert.match(String(coverPosting), /Requirements: Python/, 'the letter is written from the posting');
    assert.equal(loadJd(r.dataDir, URL), POSTING, 'the saved copy still holds the text');
  } finally {
    r.cleanup();
  }
});

// M-007-fix2-N2-1f
test('M-007-fix2-N2-1f with no saved text fill-plan fetches through fetch-jd when the career-ops folder has it, and not otherwise', async () => {
  const r = scratch();
  try {
    const urls = [];
    const fetch = async (url) => {
      urls.push(url);
      return { text: POSTING };
    };
    assert.equal(await jobTextFor({ paths: r.paths, url: URL, fetch }), '', 'no fetch-jd.mjs: no fetch');
    writeFileSync(join(r.root, 'fetch-jd.mjs'), '');
    assert.equal(await jobTextFor({ paths: r.paths, url: URL, fetch }), POSTING);
    assert.deepEqual(urls, [URL]);
    const closed = async () => ({ text: '', closed: 'posting closed' });
    assert.equal(await jobTextFor({ paths: r.paths, url: 'https://boards.greenhouse.io/examplerobotics/jobs/7202', fetch: closed }), '');
  } finally {
    r.cleanup();
  }
});
