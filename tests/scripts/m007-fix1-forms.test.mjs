// M-007 fix round 1, M-1 and S-3: chrome.mjs read-form reads a posting's form (read-only) into data/form-fields as
// { ats, url, fields }, fill-plan reads that folder by default through readFields (a list or { fields }), and the
// autopilot reads the ranked rows' forms before fill-plan when the automation Chrome is up. The browser is a fake CDP
// client whose Runtime.evaluate answers the page scripts; resume, letter and model steps are injected fakes. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { FIELDS_DIR, formFieldsFile, readFields } from '../../lib/ats-fields.mjs';
import { readBatch } from '../../lib/batch-file.mjs';
import { readForm, saveFormFields } from '../../scripts/chrome.mjs';
import { fillPlans } from '../../scripts/fill-plan.mjs';
import { autopilot } from '../../scripts/autopilot.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const TODAY = '2026-11-03';
const URL = 'https://boards.greenhouse.io/examplerobotics/jobs/7001';
const CV = '# Jordan Testwell\n\njordan.testwell@example.com | 555-0100\n\n## Education\nB.S. Computer Science, Example State University, May 2027\n\n## Experience\n- Software Intern, Example Robotics, Jun 2025 - Aug 2025: built a Python scheduling tool\n\n## Skills\nPython, SQL\n';
// What readFormFields returns for a Greenhouse-style form: selectors from ids, labels, types, no values.
const PAGE_FIELDS = [
  { selector: '#first_name', id: 'first_name', name: 'first_name', type: 'text', label: 'First Name', required: true, autocomplete: '' },
  { selector: '#last_name', id: 'last_name', name: 'last_name', type: 'text', label: 'Last Name', required: true, autocomplete: '' },
  { selector: '#email', id: 'email', name: 'email', type: 'email', label: 'Email', required: true, autocomplete: '' },
  { selector: '#resume', id: 'resume', name: 'resume', type: 'file', label: 'Resume/CV', required: true, autocomplete: '' },
  { selector: '#cover_letter', id: 'cover_letter', name: 'cover_letter', type: 'file', label: 'Cover Letter', required: false, autocomplete: '' },
];

// A fake CDP client: page scripts are told apart by what they read. clicks counts any click or value set.
function fakeClient({ captcha = null, fields = PAGE_FIELDS } = {}) {
  const calls = [];
  const send = async (method, params = {}) => {
    calls.push(method);
    if (method === 'Target.createTarget') return { targetId: 'T1' };
    if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
    if (method === 'Runtime.evaluate') {
      const expr = String(params.expression ?? '');
      if (/recaptcha/i.test(expr)) return { result: { value: captcha } };
      if (expr.includes("querySelectorAll('input, select, textarea')")) return { result: { value: fields } };
      if (expr.includes('application/ld+json')) return { result: { value: { ld: [], main: '' } } };
      calls.push(`unexpected script: ${expr.slice(0, 40)}`);
      return { result: { value: null } };
    }
    return {};
  };
  const waitFor = () => Object.assign(Promise.resolve({}), { cancel: () => {} });
  return { send, waitFor, close: () => {}, opened: Promise.resolve(), calls };
}

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-forms-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\nonboarding:\n  complete: true\n');
  writeFileSync(join(root, 'config', 'profile.yml'), 'candidate:\n  full_name: "Jordan Testwell"\n  email: "jordan.testwell@example.com"\n');
  writeFileSync(join(root, 'cv.md'), CV);
  return { root, dataDir, paths: { root, dataDir, packRoot: PACK_ROOT }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const deps = (dataDir, extra = {}) => ({
  headless: async () => ({ text: '', usage: null, model: 'sonnet' }),
  writeCover: async () => {
    mkdirSync(join(dataDir, 'letters'), { recursive: true });
    const path = join(dataDir, 'letters', 'letter.txt');
    writeFileSync(path, 'Dear hiring team at Example Robotics,\n\nI am applying for the Software Engineering Intern role.\n\nJordan Testwell\n');
    return path;
  },
  buildResume: async (opts) => {
    mkdirSync(opts.outDir, { recursive: true });
    writeFileSync(join(opts.outDir, 'resume.html'), '<html><body><h1>Jordan Testwell</h1></body></html>');
    writeFileSync(join(opts.outDir, 'resume.pdf'), '%PDF-1.4\n%%EOF\n');
    return { code: 0, html: join(opts.outDir, 'resume.html'), pdf: join(opts.outDir, 'resume.pdf') };
  },
  atsCheck: async () => ({ ok: true, problems: [] }),
  ...extra,
});

test('M-1 readForm returns the page fields with selectors and runs only read scripts (no click, no typing)', async () => {
  const client = fakeClient();
  const res = await readForm(client, URL);
  assert.deepEqual(res, { fields: PAGE_FIELDS });
  assert.ok(!client.calls.some((c) => /unexpected|Input\.|DOM\.setFileInputFiles/.test(c)), client.calls.join('\n'));
  assert.ok(client.calls.includes('Target.closeTarget'), 'the read tab is closed again');
});

test('M-1 readForm stops at a visible CAPTCHA and at a password field before anything is kept', async () => {
  assert.deepEqual(await readForm(fakeClient({ captcha: 'captcha widget' }), URL), { stop: 'captcha', detail: 'captcha widget' });
  const signIn = [{ selector: '#user', id: 'user', name: 'user', type: 'email', label: 'Email' }, { selector: '#pw', id: 'pw', name: 'pw', type: 'password', label: 'Password' }];
  assert.deepEqual(await readForm(fakeClient({ fields: signIn }), URL), { stop: 'password' });
});

test('M-1 a read form saved as { ats, url, fields } gives a fill plan with selectors, a cover letter and a resume upload', async () => {
  const r = scratch();
  try {
    const { fields } = await readForm(fakeClient(), URL);
    const file = saveFormFields(r.dataDir, URL, fields);
    assert.equal(file, formFieldsFile(join(r.dataDir, FIELDS_DIR), URL));
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(saved.ats, 'greenhouse');
    assert.equal(saved.url, URL);
    const row = { url: URL, company: 'Example Robotics', role: 'Software Engineering Intern', score: 3.6, track: 'swe-intern', jobText: 'Example Robotics is hiring a Software Engineering Intern to build Python tools.' };
    const fieldsFor = (x) => readFields(join(r.dataDir, FIELDS_DIR), x.url);
    const res = await fillPlans({ paths: r.paths, rows: [row], today: TODAY, deps: deps(r.dataDir, { fieldsFor }), say: () => {} });
    assert.equal(res.ids.length, 1, 'the item is batched');
    const plan = JSON.parse(readFileSync(readBatch(r.dataDir, res.ids[0]).items[0].plan, 'utf8'));
    const typed = plan.fields.filter((f) => !f.slot);
    assert.deepEqual(typed.map((f) => [f.selector, f.value]), [['#first_name', 'Jordan'], ['#last_name', 'Testwell'], ['#email', 'jordan.testwell@example.com']]);
    assert.ok(plan.cover && existsSync(plan.cover), `a cover letter was written: ${plan.cover}`);
    assert.deepEqual(plan.uploads.map((u) => u.selector).sort(), ['#cover_letter', '#resume']);
    assert.ok(plan.uploads.find((u) => u.selector === '#resume').path.endsWith('resume.pdf'));
  } finally {
    r.cleanup();
  }
});

test('S-3 readFields takes a plain list and the fields of { ats, url, fields }; anything else is no fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-m007-readfields-'));
  try {
    const list = [{ label: 'Email', name: 'email', type: 'email' }];
    const write = (url, text) => writeFileSync(formFieldsFile(dir, url), text);
    write('https://example.com/jobs/1', JSON.stringify(list));
    write('https://example.com/jobs/2', JSON.stringify({ ats: null, url: 'https://example.com/jobs/2', fields: list }));
    write('https://example.com/jobs/3', JSON.stringify({ ats: null, fields: 'not a list' }));
    write('https://example.com/jobs/4', '{ not json');
    assert.deepEqual(readFields(dir, 'https://example.com/jobs/1'), list);
    assert.deepEqual(readFields(dir, 'https://example.com/jobs/2'), list);
    assert.deepEqual(readFields(dir, 'https://example.com/jobs/3'), []);
    assert.deepEqual(readFields(dir, 'https://example.com/jobs/4'), []);
    assert.deepEqual(readFields(dir, 'https://example.com/jobs/5'), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('S-3 fill-plan main reads data/form-fields by default and accepts the { ats, url, fields } shape', () => {
  const r = scratch();
  try {
    saveFormFields(r.dataDir, URL, PAGE_FIELDS);
    const rowsFile = join(r.root, 'rows.json');
    writeFileSync(rowsFile, JSON.stringify([{ url: URL, company: 'Example Robotics', role: 'Software Engineering Intern', score: 3.6 }]));
    // A slot command that cannot start makes the resume render wait (exit 4) before any model call, after the fields
    // were read: a TypeError from the object shape would end the run with a stack trace instead.
    const env = { BROWSER_SLOT_CMD: join(r.root, 'no-such-slot-command') };
    const base = ['--rows', rowsFile, '--root', r.root, '--data-dir', r.dataDir, '--today', TODAY];
    for (const args of [base, [...base, '--fields-dir', join(r.dataDir, FIELDS_DIR)]]) {
      const res = spawnRun(args, env);
      assert.ok(!/TypeError|fields\.map/.test(res.text), res.text);
      assert.equal(res.code, 4, `the run reached the resume render: ${res.text}`);
    }
  } finally {
    r.cleanup();
  }
});

test('M-1 the autopilot reads each ranked row\'s form with chrome.mjs read-form before fill-plan when Chrome is up', async () => {
  const r = scratch();
  writeFileSync(join(r.root, 'config', 'student.yml'), 'timezone: America/Chicago\nchrome_in_schedule: yes\ndaily_target: 5\nscore_floor: 3.0\n');
  const done = 'https://boards.greenhouse.io/examplerobotics/jobs/7002';
  saveFormFields(r.dataDir, done, PAGE_FIELDS);
  const ranked = [{ url: URL, company: 'Example Robotics', title: 'Intern', score: 47, triage: 4.5 }, { url: done, company: 'Example Labs', title: 'Intern', score: 46, triage: 4.4 }];
  const order = [];
  const runner = (cmd, args) => {
    const script = basename(String(args[0]));
    order.push(script === 'chrome.mjs' ? `chrome.mjs ${args[1]} ${args[3] ?? ''}`.trim() : script);
    if (script === 'rank-queue.mjs') return JSON.stringify(ranked);
    return '';
  };
  try {
    await autopilot({ paths: r.paths, today: TODAY, deps: { runner, chromeOpen: () => true, out: () => {} } });
    const reads = order.filter((o) => o.startsWith('chrome.mjs read-form'));
    assert.deepEqual(reads, [`chrome.mjs read-form ${URL}`], 'only the row with no saved form is read');
    assert.ok(order.indexOf(reads[0]) < order.indexOf('fill-plan.mjs'), order.join('\n'));
  } finally {
    r.cleanup();
  }
});

test('M-1 the autopilot reads no form when the automation Chrome is not up', async () => {
  const r = scratch();
  writeFileSync(join(r.root, 'config', 'student.yml'), 'timezone: America/Chicago\nchrome_in_schedule: yes\ndaily_target: 5\nscore_floor: 3.0\n');
  const order = [];
  const runner = (cmd, args) => {
    order.push(args.slice(0, 2).map(String).map((a) => basename(a)).join(' '));
    return basename(String(args[0])) === 'rank-queue.mjs' ? JSON.stringify([{ url: URL, company: 'Example Robotics', title: 'Intern', score: 47, triage: 4.5 }]) : '';
  };
  try {
    await autopilot({ paths: r.paths, today: TODAY, deps: { runner, chromeOpen: () => false, out: () => {} } });
    assert.ok(!order.some((o) => o.includes('read-form')), order.join('\n'));
  } finally {
    r.cleanup();
  }
});

function spawnRun(args, env) {
  const res = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'fill-plan.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60000 });
  return { code: res.status, text: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}
