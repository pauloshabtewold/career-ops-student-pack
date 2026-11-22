// scripts/fill-plan.mjs: fields resolved from the answer bank and ATS maps with zero model calls, guarded job text saved
// through lib/jd-store.mjs, cover letters only for forms with a cover slot, and tailored resumes gated by every ATS
// check. Every agent, cover, render and check step is an injected fake; no agent or browser runs. Fake data only.
// Shapes used here (ruling):
//   form = { url, fields: [{ label, name, type, required?, options? }] }
//   row  = { url, company, role, score, track, jobText }
//   planRow ctx = { root, dataDir, today, batchId, item, form, answers, candidate, cv, presets,
//                   headless, writeCover, buildResume, atsCheck }
//   plan = { batchId, item, fields, unknown, cover, resume, jd, flags, inBatch }
//   resolveFields(form, { answers, candidate, headless }) -> { fields: [{ label, name, key, value }], unknown }
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makePdf } from '../helpers/mini-pdf.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const labelOf = (u) => (typeof u === 'string' ? u : u?.label ?? u?.question ?? '');
const GH_URL = 'https://boards.greenhouse.io/examplerobotics/jobs/1001';
const UNKNOWN_Q = 'What is your favorite fake board game?';
const CANDIDATE = { full_name: 'Jordan Testwell', email: 'jordan.testwell@example.com', phone: '555-0100' };
const ANSWERS = { work_authorization: 'US citizen', requires_sponsorship: false, start_date: '2027-06', relocation: 'within-locations', how_did_you_hear: 'University career fair', eeo: { gender: 'fake-gender-a' }, questions: {} };
const CV = '# Jordan Testwell\n\n## Education\nB.S. Computer Science, Example State University, May 2027\n\n## Experience\n- Software Intern, Example Robotics, Jun 2025 - Aug 2025: built a Python scheduling tool\n\n## Projects\n- Fake budgeting app in SQL\n\n## Skills\nPython, SQL\n';
const JOB_TEXT = 'Example Robotics is hiring a Software Engineering Intern. You will build Python tools and write SQL.';

// The mock Greenhouse form (tests/helpers/mock-ats-server.mjs) as a field list.
const GH_FIELDS = [
  { label: 'First Name', name: 'first_name', type: 'text', required: true },
  { label: 'Last Name', name: 'last_name', type: 'text', required: true },
  { label: 'Email', name: 'email', type: 'email', required: true },
  { label: 'Phone', name: 'phone', type: 'tel' },
  { label: 'Resume/CV', name: 'resume', type: 'file', required: true },
  { label: 'Cover Letter', name: 'cover_letter', type: 'file' },
  { label: 'Are you legally authorized to work in the United States?', name: 'work_auth', type: 'select', options: ['Yes', 'No'] },
  { label: UNKNOWN_Q, name: 'question_fav', type: 'text' },
];
const NO_COVER_FIELDS = GH_FIELDS.filter((f) => f.name !== 'cover_letter');

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
function htmlLines(html) {
  const body = html.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  return decode(body.replace(/<\/(h[1-6]|p|li|div|section|header|tr)>|<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

async function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), 'pack-fill-plan-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\n');
  try {
    await fn({ root, dataDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Recording fakes for the injected steps.
function fakes({ root, dataDir, failCheck = null, realResume = false }) {
  const rec = { headless: [], cover: [], build: [], check: [] };
  const headless = async (opts) => {
    rec.headless.push(opts);
    return { text: 'Experience\nProjects\nEducation\nSkills', usage: null, model: 'sonnet' };
  };
  const writeCover = async (opts) => {
    rec.cover.push(opts);
    const dir = join(dataDir, 'letters');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `letter-${rec.cover.length}.txt`);
    writeFileSync(path, `Dear hiring team at ${opts.company},\n\nFake paragraph.\n\nJordan Testwell\n`);
    return path;
  };
  const buildResume = async (opts) => {
    rec.build.push(opts);
    const outDir = opts.outDir ?? join(dataDir, 'resumes');
    mkdirSync(outDir, { recursive: true });
    const n = rec.build.length;
    const html = join(outDir, `resume-${n}.html`);
    const pdf = join(outDir, `resume-${n}.pdf`);
    let text = '<html><body><h1>Jordan Testwell</h1><h2>Education</h2><p>Fake</p></body></html>';
    if (realResume) {
      const { parseCv, renderHtml } = await import('../../scripts/build-resume.mjs');
      text = renderHtml(parseCv(readFileSync(join(PACK_ROOT, 'templates', 'resume', 'sample-cv.md'), 'utf8')), opts.order);
    }
    writeFileSync(html, text);
    writeFileSync(pdf, makePdf([htmlLines(text)]));
    return { html, pdf };
  };
  const atsCheck = async (opts) => {
    rec.check.push(opts);
    return failCheck ? { ok: false, problems: [failCheck] } : { ok: true, problems: [] };
  };
  return { rec, ctx: { root, dataDir, today: '2026-11-03', batchId: '2026-11-03-apply-1', item: 1, answers: ANSWERS, candidate: CANDIDATE, cv: CV, presets: ['software-cs'], headless, writeCover, buildResume, ...(failCheck !== undefined && failCheck !== 'real' ? { atsCheck } : {}) } };
}

const row = (score, n = 1001) => ({ url: `https://boards.greenhouse.io/examplerobotics/jobs/${n}`, company: 'Example Robotics', role: 'Software Engineering Intern', score, track: 'swe-intern', jobText: JOB_TEXT });

// M-002-S2-osdr
test('M-002-S2-osdr fill-plan for the Greenhouse mock form resolves every mapped field with zero agent calls and lists exactly one unknown question', async () => {
  const { resolveFields } = await import('../../scripts/fill-plan.mjs');
  const calls = [];
  const res = await resolveFields({ url: GH_URL, fields: GH_FIELDS }, { answers: ANSWERS, candidate: CANDIDATE, headless: async (o) => (calls.push(o), { text: '' }) });
  assert.equal(calls.length, 0, 'zero agent calls');
  assert.deepEqual((res.unknown ?? []).map(labelOf), [UNKNOWN_Q]);
  const value = (name) => (res.fields ?? []).find((f) => f.name === name)?.value;
  assert.equal(value('first_name'), 'Jordan');
  assert.equal(value('last_name'), 'Testwell');
  assert.equal(value('email'), 'jordan.testwell@example.com');
  assert.equal(value('phone'), '555-0100');
});

// M-002-S9-osdr
test('M-002-S9-osdr fill-plan saves the guarded job text under data/jds and adds a jd note to the row', () =>
  withRoot(async ({ root, dataDir }) => {
    const { save, jdFileName, JD_DIR } = await import('../../lib/jd-store.mjs');
    assert.equal(JD_DIR, 'jds');
    const url = 'https://boards.greenhouse.io/examplerobotics/jobs/1009';
    const token = save(dataDir, url, JOB_TEXT);
    const file = join(dataDir, 'jds', jdFileName(url));
    assert.equal(token, `jd=${jdFileName(url)}`);
    assert.ok(jdFileName(url).endsWith('.txt'));
    assert.equal(readFileSync(file, 'utf8'), JOB_TEXT);
    const before = statSync(file).mtimeMs;
    assert.equal(save(dataDir, url, JOB_TEXT), token, 'idempotent on equal text');
    assert.equal(statSync(file).mtimeMs, before);

    const { planRow } = await import('../../scripts/fill-plan.mjs');
    const { ctx } = fakes({ root, dataDir });
    const plan = await planRow(row(3.6, 1010), { ...ctx, form: { url: row(3.6, 1010).url, fields: GH_FIELDS } });
    const saved = join(dataDir, 'jds', jdFileName(row(3.6, 1010).url));
    assert.ok(existsSync(saved), 'job text saved for the planned row');
    assert.ok(readFileSync(saved, 'utf8').includes('Software Engineering Intern'));
    assert.equal(plan.jd, `jd=${jdFileName(row(3.6, 1010).url)}`);
  }));

// M-002-S14-osdr
test('M-002-S14-osdr a lean-path form with a cover slot gets a letter and a form without one gets none', () =>
  withRoot(async ({ root, dataDir }) => {
    const { planRow, FULL_PATH_SCORE } = await import('../../scripts/fill-plan.mjs');
    assert.equal(FULL_PATH_SCORE, 4.0);
    const lean = row(3.6, 1014);
    const withSlot = fakes({ root, dataDir });
    const plan = await planRow(lean, { ...withSlot.ctx, form: { url: lean.url, fields: GH_FIELDS } });
    assert.equal(withSlot.rec.cover.length, 1, 'one letter written for the cover slot');
    assert.ok(plan.cover && existsSync(plan.cover), `cover path on the plan: ${plan.cover}`);

    const bare = row(3.6, 1015);
    const noSlot = fakes({ root, dataDir: join(root, 'data-bare') });
    mkdirSync(join(root, 'data-bare'));
    const plain = await planRow(bare, { ...noSlot.ctx, form: { url: bare.url, fields: NO_COVER_FIELDS } });
    assert.equal(noSlot.rec.cover.length, 0, 'no letter without a cover slot');
    assert.ok(!plain.cover, `no cover path: ${plain.cover}`);
    assert.deepEqual(filesUnder(join(root, 'data-bare')).filter((f) => /letter|cover/i.test(f)), []);
  }));

// M-002-S31-osdr
test('M-002-S31-osdr a tailored resume that fails check-resume twice flags the item naming the failed check and keeps it out of the batch', () =>
  withRoot(async ({ root, dataDir }) => {
    const { planRow } = await import('../../scripts/fill-plan.mjs');
    const full = row(4.5, 1031);
    const { rec, ctx } = fakes({ root, dataDir, failCheck: 'single-column: the source uses a grid of two tracks' });
    const plan = await planRow(full, { ...ctx, form: { url: full.url, fields: GH_FIELDS } });
    assert.equal(rec.build.length, 2, 'the tailored build plus one rebuild');
    assert.deepEqual([...(rec.build[1].order ?? [])], ['Education', 'Experience', 'Projects', 'Skills'], 'the rebuild uses the untailored order');
    assert.equal(rec.check.length, 2);
    assert.ok((plan.flags ?? []).some((f) => /single-column/.test(String(f?.message ?? f))), JSON.stringify(plan.flags));
    assert.equal(plan.inBatch, false);
  }));

// M-002-S45-osdr
test('M-002-S45-osdr a tailored resume rendered from the template for a fixture posting passes every ATS check and enters the batch', () =>
  withRoot(async ({ root, dataDir }) => {
    const { planRow, atsCheck } = await import('../../scripts/fill-plan.mjs');
    const { parseCv, renderHtml } = await import('../../scripts/build-resume.mjs');
    const html = renderHtml(parseCv(readFileSync(join(PACK_ROOT, 'templates', 'resume', 'sample-cv.md'), 'utf8')));
    writeFileSync(join(root, 't.html'), html);
    writeFileSync(join(root, 't.pdf'), makePdf([htmlLines(html)]));
    const direct = await atsCheck({ pdf: join(root, 't.pdf'), html: join(root, 't.html') });
    assert.equal(direct.ok, true, JSON.stringify(direct));
    assert.deepEqual(direct.problems, []);

    const full = row(4.5, 1045);
    const { rec, ctx } = fakes({ root, dataDir, failCheck: 'real', realResume: true });
    const plan = await planRow(full, { ...ctx, form: { url: full.url, fields: GH_FIELDS } });
    assert.equal(rec.build.length, 1, 'no rebuild when the tailored resume passes');
    assert.deepEqual(plan.flags ?? [], []);
    assert.equal(plan.inBatch, true);
    assert.ok(plan.resume, 'the per-job resume path is on the plan');
  }));
