// M-007 fix round 2, N2-4: read-form takes only the application form's inputs (no search box, no header or nav input),
// a read that finds no form field saves nothing and is retried on the next run, and after 3 such reads the posting is
// left for the student (finish these yourself) by the autopilot and fill-plan. Fake DOM and fake runner only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { EMPTY_READ_TRIES, FIELDS_DIR, emptyReads, formFieldsFile, formGaveUp, recordEmptyRead } from '../../lib/ats-fields.mjs';
import { readFormFields } from '../../lib/cdp.mjs';
import { readForm } from '../../scripts/chrome.mjs';
import { autopilot } from '../../scripts/autopilot.mjs';
import { fillPlans } from '../../scripts/fill-plan.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const URL = 'https://boards.greenhouse.io/examplerobotics/jobs/7101';
const TODAY = '2026-11-03';

// A tiny DOM: elements know their tag, attributes, parent and children; querySelector(All) understands the selectors
// readFormFields uses (tag lists, [type=x] and [role=search]).
function el(tag, attrs = {}, children = []) {
  const node = { tagName: tag.toUpperCase(), id: attrs.id ?? '', name: attrs.name ?? '', type: attrs.type ?? (tag === 'input' ? 'text' : tag), required: false, autocomplete: '', placeholder: '', attrs, children, parent: null };
  for (const c of children) c.parent = node;
  node.getAttribute = (k) => attrs[k] ?? null;
  const matches = (n, sel) => sel.split(',').map((s) => s.trim()).some((s) => {
    const m = /^([a-z]*)(?:\[(\w+)=([\w-]+)\])?$/.exec(s);
    if (!m) return false;
    if (m[1] && n.tagName !== m[1].toUpperCase()) return false;
    return !m[2] || (m[2] === 'type' ? n.type === m[3] : n.attrs[m[2]] === m[3]);
  });
  const all = (n) => n.children.flatMap((c) => [c, ...all(c)]);
  node.querySelectorAll = (sel) => all(node).filter((n) => matches(n, sel));
  node.querySelector = (sel) => node.querySelectorAll(sel)[0] ?? null;
  node.closest = (sel) => {
    for (let n = node; n; n = n.parent) if (n.tagName && matches(n, sel)) return n;
    return null;
  };
  return node;
}

function page() {
  const body = el('body', {}, [
    el('header', {}, [el('input', { id: 'site_q', name: 'q' })]),
    el('nav', {}, [el('input', { id: 'nav_email', name: 'newsletter', type: 'email' })]),
    el('form', { role: 'search' }, [el('input', { id: 'search_jobs', name: 'search', type: 'search' }), el('button', { type: 'submit' })]),
    el('form', { id: 'newsletter' }, [el('input', { id: 'news', name: 'news', type: 'email' })]),
    el('form', { id: 'application_form' }, [
      el('input', { id: 'first_name', name: 'first_name' }),
      el('input', { id: 'email', name: 'email', type: 'email' }),
      el('input', { id: 'resume', name: 'resume', type: 'file' }),
      el('button', { type: 'submit' }),
    ]),
  ]);
  const document = { querySelectorAll: (s) => body.querySelectorAll(s), querySelector: () => null };
  return { document, CSS: { escape: (s) => String(s) } };
}

const vmClient = (ctx) => ({ send: async (method, params) => ({ result: { value: method === 'Runtime.evaluate' ? runInNewContext(params.expression, ctx) : undefined } }) });

// A fake CDP client whose page has no form field at all.
function emptyClient() {
  const send = async (method, params = {}) => {
    if (method === 'Target.createTarget') return { targetId: 'T1' };
    if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
    if (method === 'Runtime.evaluate') return { result: { value: String(params.expression).includes("querySelectorAll('input, select, textarea')") ? [] : null } };
    return {};
  };
  return { send, waitFor: () => Object.assign(Promise.resolve({}), { cancel: () => {} }), close: () => {}, opened: Promise.resolve() };
}

function scratch(config = '') {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-fix2-forms-'));
  const dataDir = join(root, 'data');
  mkdirSync(dataDir);
  mkdirSync(join(root, 'config'));
  writeFileSync(join(root, 'config', 'student.yml'), `timezone: America/Chicago\n${config}`);
  writeFileSync(join(root, 'cv.md'), '# Jordan Testwell\n\njordan.testwell@example.com\n\n## Skills\nPython\n');
  return { root, dataDir, paths: { root, dataDir, packRoot: PACK_ROOT }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

// M-007-fix2-N2-4a
test('M-007-fix2-N2-4a readFormFields reads only the application form: no header, nav, search or newsletter input', async () => {
  const fields = await readFormFields(vmClient(page()), 'S1');
  assert.deepEqual(Array.from(fields, (f) => f.id), ['first_name', 'email', 'resume']);
});

// M-007-fix2-N2-4b
test('M-007-fix2-N2-4b readForm on a page with no form field stops as empty, and the try counter gives up after 3', async () => {
  assert.deepEqual(await readForm(emptyClient(), URL), { stop: 'empty' });
  const r = scratch();
  try {
    const dir = join(r.dataDir, FIELDS_DIR);
    assert.equal(EMPTY_READ_TRIES, 3);
    for (let n = 1; n <= 3; n++) {
      assert.equal(formGaveUp(dir, URL), false, `not given up before read ${n}`);
      assert.equal(recordEmptyRead(dir, URL), n);
    }
    assert.equal(emptyReads(dir, URL), 3);
    assert.equal(formGaveUp(dir, URL), true);
    assert.ok(!existsSync(formFieldsFile(dir, URL)), 'no fields file is saved for an empty read');
  } finally {
    r.cleanup();
  }
});

// M-007-fix2-N2-4c
test('M-007-fix2-N2-4c the autopilot re-reads a posting with no saved form and lists it under finish these yourself after 3 empty reads', async () => {
  const r = scratch('chrome_in_schedule: yes\ndaily_target: 5\nscore_floor: 3.0\n');
  const other = 'https://boards.greenhouse.io/examplerobotics/jobs/7102';
  const ranked = [{ url: URL, company: 'Example Robotics', title: 'Intern', score: 47, triage: 4.5 }, { url: other, company: 'Example Labs', title: 'Intern', score: 46, triage: 4.4 }];
  const reads = [];
  const runner = (cmd, args) => {
    const script = basename(String(args[0]));
    if (script === 'chrome.mjs' && args[1] === 'read-form') reads.push(args[3]);
    return script === 'rank-queue.mjs' ? JSON.stringify(ranked) : '';
  };
  try {
    const dir = join(r.dataDir, FIELDS_DIR);
    recordEmptyRead(dir, other);
    const first = await autopilot({ paths: r.paths, today: TODAY, deps: { runner, chromeOpen: () => true, out: () => {} } });
    assert.deepEqual(reads.sort(), [URL, other].sort(), 'a posting with one empty read is read again');
    for (let n = 0; n < 3; n++) recordEmptyRead(dir, URL);
    reads.length = 0;
    // The first run put both rows on a review batch; without it they are ranked again.
    rmSync(join(r.dataDir, 'batches'), { recursive: true, force: true });
    const second = await autopilot({ paths: r.paths, today: TODAY, deps: { runner, chromeOpen: () => true, out: () => {} } });
    assert.deepEqual(reads, [other], 'the posting with 3 empty reads is not read again');
    assert.ok(second.lines.some((l) => l.includes('finish these yourself') && l.includes(URL)), second.lines.join('\n'));
    assert.ok(!first.lines.some((l) => l.includes('finish these yourself')), first.lines.join('\n'));
  } finally {
    r.cleanup();
  }
});

// M-007-fix2-N2-4d
test('M-007-fix2-N2-4d fill-plan keeps a posting with 3 empty reads out as finish these yourself, with no model call', async () => {
  const r = scratch();
  try {
    for (let n = 0; n < 3; n++) recordEmptyRead(join(r.dataDir, FIELDS_DIR), URL);
    const said = [];
    let calls = 0;
    const res = await fillPlans({ paths: r.paths, rows: [{ url: URL, company: 'Example Robotics', role: 'Intern', score: 4.5, jobText: 'Example Robotics is hiring an intern to build Python tools for robots.' }], today: TODAY, deps: { headless: async () => { calls++; return { text: '' }; }, buildResume: async () => { calls++; return { code: 1 }; } }, say: (l) => said.push(l) });
    assert.equal(res.ready, 0);
    assert.equal(calls, 0, 'nothing was built or called');
    assert.ok(said.some((l) => /kept out: finish these yourself: no application form found in 3 reads/.test(l)), said.join('\n'));
  } finally {
    r.cleanup();
  }
});
