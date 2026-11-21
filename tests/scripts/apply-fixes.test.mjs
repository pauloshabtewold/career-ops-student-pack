// M-002 review fixes outside chrome.mjs: fill-plan keeps one work folder per run, stops with exit 4 and no batch on a
// refused browser slot, and uploads the letter the self-check fixed; setup-flow reads the student's lever off switch;
// a second batch approval adds items. Every resume, letter and approval step is an injected fake (the CLI case uses a
// slot command that cannot start, so nothing renders); no agent or browser runs. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fillPlans, planRow } from '../../scripts/fill-plan.mjs';
import { EXIT_WAIT } from '../../scripts/build-resume.mjs';
import { CACHE_FILE, setupFlow } from '../../scripts/setup-flow.mjs';
import { main as batchMain } from '../../scripts/batch.mjs';
import { listBatches, readBatch, writeBatches } from '../../lib/batch-file.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const TODAY = '2026-11-03';
const CV = '# Jordan Testwell\n\njordan.testwell@example.com | 555-0100\n\n## Education\nB.S. Computer Science, Example State University, May 2027\n\n## Experience\n- Software Intern, Example Robotics, Jun 2025 - Aug 2025: built a Python scheduling tool\n\n## Projects\n- Fake budgeting app in SQL\n\n## Skills\nPython, SQL\n';
const JOB_TEXT = 'Example Robotics is hiring a Software Engineering Intern. You will build Python tools and write SQL.';
const FIELDS = [
  { label: 'First Name', name: 'first_name', type: 'text', required: true },
  { label: 'Email', name: 'email', type: 'email', required: true },
  { label: 'Resume/CV', name: 'resume', type: 'file', required: true },
  { label: 'Cover Letter', name: 'cover_letter', type: 'file' },
];
const row = (n) => ({ url: `https://boards.greenhouse.io/examplerobotics/jobs/${5000 + n}`, company: 'Example Robotics', role: 'Software Engineering Intern', score: 3.6, track: 'swe-intern', jobText: JOB_TEXT });

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'pack-apply-fixes-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\nonboarding:\n  complete: true\n');
  writeFileSync(join(root, 'config', 'profile.yml'), 'candidate:\n  full_name: "Jordan Testwell"\n  email: "jordan.testwell@example.com"\n');
  writeFileSync(join(root, 'cv.md'), CV);
  return { root, dataDir, paths: { root, dataDir, packRoot: PACK_ROOT }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// Recording fakes. buildResume writes resume.pdf into outDir, the fixed name the real build-resume uses, tagged with
// the build number; letter(n) is the letter text for the n-th cover call.
function fakes(dataDir, { letter = () => 'Dear hiring team at Example Robotics,\n\nI am applying for the Software Engineering Intern role.\n\nJordan Testwell\n', build = null } = {}) {
  const rec = { build: [], cover: [] };
  return {
    rec,
    deps: {
      fieldsFor: () => FIELDS,
      headless: async () => ({ text: '', usage: null, model: 'sonnet' }),
      writeCover: async (opts) => {
        rec.cover.push(opts);
        const dir = join(dataDir, 'letters');
        mkdirSync(dir, { recursive: true });
        const path = join(dir, `letter-${rec.cover.length}.txt`);
        writeFileSync(path, letter(rec.cover.length));
        return path;
      },
      buildResume: async (opts) => {
        rec.build.push(opts);
        if (build) return build(opts);
        mkdirSync(opts.outDir, { recursive: true });
        const html = join(opts.outDir, 'resume.html');
        const pdf = join(opts.outDir, 'resume.pdf');
        writeFileSync(html, '<html><body><h1>Jordan Testwell</h1></body></html>');
        writeFileSync(pdf, `%PDF-1.4\n% fake build ${rec.build.length}\n%%EOF\n`);
        return { code: 0, html, pdf };
      },
      atsCheck: async () => ({ ok: true, problems: [] }),
    },
  };
}

const planOf = (dataDir, id) => JSON.parse(readFileSync(readBatch(dataDir, id).items[0].plan, 'utf8'));

test('S3 a second fill-plan run on the same day never overwrites the resume an earlier batch uploads', async () => {
  const r = scratch();
  try {
    const first = await fillPlans({ paths: r.paths, rows: [row(1)], today: TODAY, deps: fakes(r.dataDir).deps, say: () => {} });
    assert.equal(first.ids.length, 1, 'first run batched its item');
    const resume1 = planOf(r.dataDir, first.ids[0]).resume;
    const before = readFileSync(resume1, 'utf8');
    const second = await fillPlans({ paths: r.paths, rows: [row(2)], today: TODAY, deps: fakes(r.dataDir).deps, say: () => {} });
    assert.equal(second.ids.length, 1, 'second run batched its item');
    const resume2 = planOf(r.dataDir, second.ids[0]).resume;
    assert.notEqual(resume2, resume1, 'each run renders into its own folder');
    assert.equal(readFileSync(resume1, 'utf8'), before, 'the first batch still uploads its own resume');
  } finally {
    r.cleanup();
  }
});

test('S4 a refused browser slot stops fill-plan with exit 4 at the first row, before any letter, and writes no batch', async () => {
  const r = scratch();
  try {
    const { rec, deps } = fakes(r.dataDir, { build: (opts) => ({ code: EXIT_WAIT, html: join(opts.outDir, 'resume.html'), pdf: null, error: 'waiting for a browser slot (hook exit 1)' }) });
    const lines = [];
    const res = await fillPlans({ paths: r.paths, rows: [row(1), row(2)], today: TODAY, deps, say: (l) => lines.push(l) });
    assert.equal(EXIT_WAIT, 4);
    assert.equal(res.code, 4);
    assert.equal(rec.build.length, 1, 'the run stops at the first refusal');
    assert.equal(rec.cover.length, 0, 'no letter model call');
    assert.deepEqual(listBatches(r.dataDir), [], 'no batch written');
    assert.ok(lines.some((l) => /waiting for a browser slot/.test(l)), lines.join('\n'));
  } finally {
    r.cleanup();
  }
});

test('S4 fill-plan.mjs exits 4 and writes no batch when the browser slot command refuses', () => {
  const r = scratch();
  try {
    const rows = join(r.root, 'rows.json');
    writeFileSync(rows, JSON.stringify([row(1)]));
    // A slot command that cannot start counts as a refusal, so the real build-resume renders nothing.
    const env = { ...process.env, BROWSER_SLOT_CMD: 'career-ops-test-no-such-slot-command' };
    const out = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'fill-plan.mjs'), '--rows', rows, '--root', r.root, '--data-dir', r.dataDir, '--today', TODAY], { cwd: PACK_ROOT, encoding: 'utf8', env, timeout: 60000 });
    assert.equal(out.status, 4, out.stdout + out.stderr);
    assert.deepEqual(listBatches(r.dataDir), []);
  } finally {
    r.cleanup();
  }
});

test('S7 the letter file a plan uploads is the one the self-check fixed', async () => {
  const r = scratch();
  try {
    const sloppy = 'Dear hiring team at  Example Robotics,\n\nI am am applying for the Software Engineering Intern role.\n\nJordan Testwell\n';
    const { deps } = fakes(r.dataDir, { letter: () => sloppy });
    const plan = await planRow(row(1), { ...deps, root: r.root, dataDir: r.dataDir, today: TODAY, answers: {}, candidate: { full_name: 'Jordan Testwell' }, cv: CV, presets: [], form: { url: row(1).url, fields: FIELDS }, outDir: join(r.dataDir, 'work', '1') });
    assert.ok(plan.selfCheck.fixed.length > 0, 'the self-check reports a fix');
    const uploaded = readFileSync(plan.cover, 'utf8');
    assert.notEqual(uploaded, sloppy);
    assert.doesNotMatch(uploaded, / {2}|\bam am\b/);
  } finally {
    r.cleanup();
  }
});

test('S5 setup-flow reads config/levers.yml: T15 off writes no profile cache, on by default writes one', async () => {
  const run = async (levers) => {
    const r = scratch();
    try {
      if (levers) writeFileSync(join(r.root, 'config', 'levers.yml'), levers);
      const deps = {
        ...fakes(r.dataDir).deps,
        chrome: async () => ({ code: 0 }),
        schedule: async () => ({ code: 0 }),
        say: () => {},
      };
      await setupFlow({ paths: r.paths, flags: { slotCmd: '' }, today: TODAY, deps });
      return existsSync(join(r.dataDir, CACHE_FILE));
    } finally {
      r.cleanup();
    }
  };
  assert.equal(await run(null), true, 'T15 is a plumbing lever, on by default');
  assert.equal(await run('T15: off\n'), false, 'the student turned T15 off');
});

test('N4 a second approval adds items to the batch instead of replacing the first', async () => {
  const r = scratch();
  try {
    const [id] = writeBatches(r.dataDir, { date: TODAY, kind: 'apply', items: [1, 2, 3].map((n) => ({ company: `Example Co ${n}`, role: 'Data Intern', score: 4.1, preview: 'Fake.', link: row(n).url })) });
    const logged = [];
    const runner = (_node, args) => (logged.push(args[args.indexOf('--items') + 1]), { code: 0, stdout: '', stderr: '' });
    const argv = (words) => ['approve', id, words, '--root', r.root, '--data-dir', r.dataDir, '--today', TODAY];
    assert.equal(await batchMain(argv('submit 1'), { runner, say: () => {} }), 0);
    assert.equal(await batchMain(argv('submit 3'), { runner, say: () => {} }), 0);
    assert.deepEqual(logged, ['1', '3']);
    assert.deepEqual(readBatch(r.dataDir, id).approved.items, [1, 3]);
  } finally {
    r.cleanup();
  }
});
