// M-007 fix round 2, N2-2: a plan built before its form was read never reaches a click. The batch line says "form not
// read yet", chrome.mjs submit refuses a plan with no fields (exit 3, "read the form first"), fill-plan --replan rebuilds
// an approved item's plan in place from its read form (fields, cover letter, uploads; same batch id, item and link), a
// rebuilt plan that fails a gate is not written, and the autopilot reads and replans an approved unread item before its
// fill. budget.mjs, resume, letter and model steps are fakes; no browser or network. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { FIELDS_DIR, readFields } from '../../lib/ats-fields.mjs';
import { readBatch } from '../../lib/batch-file.mjs';
import { appendTsv } from '../../lib/tsv.mjs';
import { autopilot } from '../../scripts/autopilot.mjs';
import { EXIT, main as chromeMain, saveFormFields } from '../../scripts/chrome.mjs';
import { UNREAD_PREVIEW, fillPlans, replanItem } from '../../scripts/fill-plan.mjs';
import { LOG_HEADER, row as logRow } from '../helpers/budget-harness.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const TODAY = '2026-11-03';
const LINK = 'https://boards.greenhouse.io/examplerobotics/jobs/7301';
const POSTING = 'Example Robotics hires a Software Engineering Intern. Requirements: Python, SQL and testing for robot tools.';
const FORM = [
  { selector: '#first_name', id: 'first_name', name: 'first_name', type: 'text', label: 'First Name', required: true },
  { selector: '#email', id: 'email', name: 'email', type: 'email', label: 'Email', required: true },
  { selector: '#resume', id: 'resume', name: 'resume', type: 'file', label: 'Resume/CV', required: true },
  { selector: '#cover_letter', id: 'cover_letter', name: 'cover_letter', type: 'file', label: 'Cover Letter' },
];

function scratch(config = '') {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-fix2-replan-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), `timezone: America/Chicago\nonboarding:\n  complete: true\n${config}`);
  writeFileSync(join(root, 'config', 'profile.yml'), 'candidate:\n  full_name: "Jordan Testwell"\n  email: "jordan.testwell@example.com"\n');
  writeFileSync(join(root, 'cv.md'), '# Jordan Testwell\n\njordan.testwell@example.com\n\n## Experience\n- Software Intern, Example Robotics: built a Python tool\n\n## Skills\nPython, SQL\n');
  return { root, dataDir, paths: { root, dataDir, packRoot: PACK_ROOT }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const deps = (r, extra = {}) => ({
  fieldsFor: (row) => readFields(join(r.dataDir, FIELDS_DIR), row.url),
  headless: async () => ({ text: '' }),
  writeCover: async () => {
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
  ...extra,
});

const ROW = { url: LINK, company: 'Example Robotics', title: 'Software Engineering Intern', score: 41, triage: 3.8, track: 'intern', jobText: POSTING };

// A batch planned while no form was read, approved.
async function unreadApproved(r) {
  const res = await fillPlans({ paths: r.paths, rows: [ROW], today: TODAY, deps: deps(r), say: () => {} });
  const id = res.ids[0];
  await appendTsv(join(r.dataDir, 'action-log.tsv'), LOG_HEADER, [logRow({ ts: '2026-11-03T18:00:00.000Z', action: 'batch.approve', approval: 'approve all', detail: `batch=${id};items=1` })]);
  return { id, planFile: readBatch(r.dataDir, id).items[0].plan };
}

// M-007-fix2-N2-2a
test('M-007-fix2-N2-2a a plan built before its form was read shows "form not read yet" on the batch page, never "no cover letter slot"', async () => {
  const r = scratch();
  try {
    const { id } = await unreadApproved(r);
    const item = readBatch(r.dataDir, id).items[0];
    assert.equal(item.preview, UNREAD_PREVIEW);
    assert.equal(UNREAD_PREVIEW, 'form not read yet (fields and cover letter are added before submit)');
    assert.ok(!readFileSync(join(r.dataDir, 'batches', `${id}.md`), 'utf8').includes('no cover letter slot'));
  } finally {
    r.cleanup();
  }
});

// M-007-fix2-N2-2b
test('M-007-fix2-N2-2b chrome.mjs submit refuses an approved plan with no fields: exit 3, read the form first, nothing clicked', async () => {
  const r = scratch();
  try {
    const { id } = await unreadApproved(r);
    const said = [];
    const budget = [];
    const code = await chromeMain(['submit', '--batch-id', id, '--item', '1', '--root', r.root, '--data-dir', r.dataDir], {
      say: (l) => said.push(String(l)),
      runner: (cmd, args) => (budget.push(args[2]), { code: 0, stdout: 'ok', stderr: '' }),
    });
    assert.equal(code, EXIT.refused, said.join('\n'));
    assert.match(said.join('\n'), /read the form first/);
    assert.match(said.join('\n'), /fill-plan\.mjs --replan --batch-id/);
    assert.ok(!budget.includes('apply.pending'), 'no pending row');
  } finally {
    r.cleanup();
  }
});

// M-007-fix2-N2-2c
test('M-007-fix2-N2-2c --replan rebuilds the approved item in place from its read form with the letter and both uploads', async () => {
  const r = scratch();
  try {
    const { id, planFile } = await unreadApproved(r);
    assert.equal((await replanItem({ paths: r.paths, batchId: id, item: 1, today: TODAY, deps: deps(r) })).code, 3, 'no read form: not rebuilt');
    saveFormFields(r.dataDir, LINK, FORM);
    const res = await replanItem({ paths: r.paths, batchId: id, item: 1, today: TODAY, deps: deps(r, { fetchJob: async () => POSTING }) });
    assert.equal(res.code, 0, res.reasons.join('; '));
    const plan = JSON.parse(readFileSync(planFile, 'utf8'));
    assert.equal(plan.batchId, id);
    assert.equal(plan.item, 1);
    assert.equal(plan.link, LINK);
    assert.equal(plan.score, 3.8, 'the fit score is kept');
    assert.ok(plan.cover && existsSync(plan.cover), 'a cover letter for the cover slot');
    assert.deepEqual(plan.uploads.map((u) => u.selector).sort(), ['#cover_letter', '#resume']);
    assert.deepEqual(plan.fields.filter((f) => !f.slot).map((f) => [f.selector, f.value]), [['#first_name', 'Jordan'], ['#email', 'jordan.testwell@example.com']]);
  } finally {
    r.cleanup();
  }
});

// M-007-fix2-N2-2d
test('M-007-fix2-N2-2d a rebuilt plan that fails a gate is not written and the reason comes back', async () => {
  const r = scratch();
  try {
    const { id, planFile } = await unreadApproved(r);
    const before = readFileSync(planFile, 'utf8');
    saveFormFields(r.dataDir, LINK, FORM);
    const res = await replanItem({ paths: r.paths, batchId: id, item: 1, today: TODAY, deps: deps(r, { atsCheck: async () => ({ ok: false, problems: ['text layer: email missing'] }) }) });
    assert.equal(res.code, 3);
    assert.match(res.reasons.join(' '), /email missing/);
    assert.equal(readFileSync(planFile, 'utf8'), before, 'the old plan stays, so submit still refuses it');
  } finally {
    r.cleanup();
  }
});

// M-007-fix2-N2-2e
test('M-007-fix2-N2-2e the autopilot reads the form and replans an approved unread item before its fill and submit', async () => {
  const r = scratch('chrome_in_schedule: yes\ndaily_target: 5\nscore_floor: 3.0\n');
  try {
    const { id, planFile } = await unreadApproved(r);
    const order = [];
    const runner = (cmd, args) => {
      const script = basename(String(args[0]));
      order.push(script === 'chrome.mjs' || script === 'fill-plan.mjs' ? `${script} ${args[1]}` : script);
      if (script === 'rank-queue.mjs') return '[]';
      if (script === 'chrome.mjs' && args[1] === 'read-form') saveFormFields(r.dataDir, LINK, FORM);
      if (script === 'fill-plan.mjs' && args[1] === '--replan') {
        const plan = JSON.parse(readFileSync(planFile, 'utf8'));
        writeFileSync(planFile, JSON.stringify({ ...plan, fields: FORM.map((f) => ({ ...f, value: f.type === 'file' ? undefined : 'x' })), uploads: [] }));
      }
      if (script === 'chrome.mjs' && args[1] === 'fill') {
        const plan = JSON.parse(readFileSync(planFile, 'utf8'));
        writeFileSync(planFile, JSON.stringify({ ...plan, tab: { targetId: 'T1', url: LINK, sentinel: { selector: '#first_name', value: 'x' } } }));
        return 'chrome: filled 2 field(s) on boards.greenhouse.io';
      }
      return '';
    };
    await autopilot({ paths: r.paths, today: TODAY, deps: { runner, chromeOpen: () => true, out: () => {} } });
    const seq = order.filter((o) => /^(chrome|fill-plan)\.mjs (read-form|--replan|fill|submit)$/.test(o));
    assert.deepEqual(seq, ['chrome.mjs read-form', 'fill-plan.mjs --replan', 'chrome.mjs fill', 'chrome.mjs submit'], order.join('\n'));
    assert.ok(id);
  } finally {
    r.cleanup();
  }
});

// M-007-fix2-N2-2f
test('M-007-fix2-N2-2f modes/apply-loop.md names read-form, --replan, fill and submit for an approved unread item', () => {
  const text = readFileSync(join(PACK_ROOT, 'modes', 'apply-loop.md'), 'utf8');
  assert.match(text, /form not read yet/);
  assert.match(text, /fill-plan\.mjs --replan --batch-id <batch-id> --item <n>/);
});

