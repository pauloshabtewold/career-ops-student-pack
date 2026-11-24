// M-007 fix round 1, gaps the personal review found that the pack shares: the 0-5 fit is the triage score, not
// rank-queue's weighted rank (path choice, batch page, budget score); a row with no job text is never tailored; the
// resume keyword overlap is reported, never a flag that drops the item. Resume, letter and model steps are recording
// fakes. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBatch } from '../../lib/batch-file.mjs';
import { KEYWORD_FLOOR, check, keywordOverlap } from '../../lib/self-check.mjs';
import { fillPlans, fitScore } from '../../scripts/fill-plan.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const TODAY = '2026-11-03';
const CV = '# Jordan Testwell\n\njordan.testwell@example.com | 555-0100\n\n## Education\nB.S. Computer Science, Example State University, May 2027\n\n## Experience\n- Software Intern, Example Robotics, Jun 2025 - Aug 2025: built a Python scheduling tool\n\n## Skills\nPython, SQL\n';
const SHORT_JOB = 'Example Robotics is hiring a Software Engineering Intern to build Python tools and write SQL.';
// A realistic-length posting: many unique words a student resume never has.
const LONG_JOB = [
  'About the team: our platform group builds reliable infrastructure for warehouse automation across three continents.',
  'Responsibilities include collaborating with product managers, designing distributed services, reviewing pull requests, writing documentation, mentoring peers, participating in on-call rotations, improving observability dashboards, profiling latency regressions, and partnering with hardware engineers on firmware integration.',
  'Qualifications: pursuing a degree in computer science or a related discipline; familiarity with Python, SQL, containers, message queues, cloud providers, continuous integration, and agile ceremonies; strong written communication; curiosity; ownership; resilience.',
  'Benefits: competitive stipend, relocation assistance, wellness reimbursement, commuter subsidies, flexible scheduling, hackathons, lunch-and-learn sessions, volunteering days, and an inclusive community of employee resource groups.',
].join(' ');
const FIELDS = [
  { selector: '#first_name', id: 'first_name', name: 'first_name', type: 'text', label: 'First Name', required: true },
  { selector: '#resume', id: 'resume', name: 'resume', type: 'file', label: 'Resume/CV', required: true },
];

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-cross-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\nonboarding:\n  complete: true\n');
  writeFileSync(join(root, 'config', 'profile.yml'), 'candidate:\n  full_name: "Jordan Testwell"\n');
  writeFileSync(join(root, 'cv.md'), CV);
  return { root, dataDir, paths: { root, dataDir, packRoot: PACK_ROOT }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function fakes(dataDir) {
  const steps = [];
  return {
    steps,
    deps: {
      fieldsFor: () => FIELDS,
      headless: async (opts) => (steps.push(opts.step), { text: '', usage: null, model: 'sonnet' }),
      buildResume: async (opts) => {
        mkdirSync(opts.outDir, { recursive: true });
        writeFileSync(join(opts.outDir, 'resume.html'), '<html><body><h1>Jordan Testwell</h1></body></html>');
        writeFileSync(join(opts.outDir, 'resume.pdf'), '%PDF-1.4\n%%EOF\n');
        return { code: 0, html: join(opts.outDir, 'resume.html'), pdf: join(opts.outDir, 'resume.pdf') };
      },
      atsCheck: async () => ({ ok: true, problems: [] }),
    },
  };
}

const row = (over) => ({ url: 'https://boards.greenhouse.io/examplerobotics/jobs/8001', company: 'Example Robotics', role: 'Software Engineering Intern', track: 'intern', ...over });

test('personal M-1: a rank-queue row (score 70, triage 3.6) takes the lean path, plans fit 3.6 and keeps the rank apart', async () => {
  const r = scratch();
  try {
    const f = fakes(r.dataDir);
    const res = await fillPlans({ paths: r.paths, rows: [row({ score: 70, triage: 3.6, jobText: SHORT_JOB })], today: TODAY, deps: f.deps, say: () => {} });
    assert.ok(!f.steps.includes('tailor-resume'), `no tailoring call on the lean path: ${f.steps}`);
    const batch = readBatch(r.dataDir, res.ids[0]);
    const plan = JSON.parse(readFileSync(batch.items[0].plan, 'utf8'));
    assert.equal(plan.score, 3.6, 'budget.mjs gets --score 3.6');
    assert.equal(plan.rank, 70);
    assert.match(readFileSync(join(r.dataDir, 'batches', `${res.ids[0]}.md`), 'utf8'), /\| fit 3\.6 \|/);
    assert.equal(fitScore({ score: 4.2 }), 4.2, 'a hand-made row without triage keeps its score');
  } finally {
    r.cleanup();
  }
});

test('personal M-4: a full-path row with no job text is never tailored with an empty posting', async () => {
  const r = scratch();
  try {
    const f = fakes(r.dataDir);
    await fillPlans({ paths: r.paths, rows: [row({ score: 60, triage: 4.6 })], today: TODAY, deps: f.deps, say: () => {} });
    assert.ok(!f.steps.includes('tailor-resume'), `${f.steps}`);
    const g = fakes(r.dataDir);
    await fillPlans({ paths: r.paths, rows: [row({ score: 60, triage: 4.6, jobText: SHORT_JOB })], today: TODAY, deps: g.deps, say: () => {} });
    assert.ok(g.steps.includes('tailor-resume'), 'with job text the full path still tailors');
  } finally {
    r.cleanup();
  }
});

test('personal M-2: a realistic posting below the keyword floor is batched, with the overlap reported as a note', async () => {
  assert.ok(keywordOverlap(CV, LONG_JOB) < KEYWORD_FLOOR, `overlap ${keywordOverlap(CV, LONG_JOB)}`);
  const res = check({ company: 'Example Robotics', role: 'Intern', fields: [], resumeText: CV, jobText: LONG_JOB });
  assert.equal(res.ok, true);
  assert.deepEqual(res.flags, []);
  assert.match(res.notes[0], /reported only/);
  const r = scratch();
  try {
    const said = [];
    const out = await fillPlans({ paths: r.paths, rows: [row({ score: 3.8, jobText: LONG_JOB })], today: TODAY, deps: fakes(r.dataDir).deps, say: (l) => said.push(l) });
    assert.equal(out.ready, 1, said.join('\n'));
    assert.ok(said.some((l) => /note: resume shares \d+% of the job's keywords/.test(l)), said.join('\n'));
  } finally {
    r.cleanup();
  }
});
