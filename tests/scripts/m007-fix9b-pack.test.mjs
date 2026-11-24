// M-007 fix round 9b, submit-pick rule v4 item D: a plan whose form read saved no submit text (an older read) or an
// empty one is refused with 'no-button' and goes to finish these yourself with "saved form read is too old; read the
// form again" and its link, before any budget call, apply.pending row or click. A plan with the right text still
// submits. Fake DOM shaped like the live-mock Greenhouse form, fake CDP client and fake runner; no browser, network or
// model call. Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import * as chrome from '../../scripts/chrome.mjs';
import { readBatch, updateBatch, writeBatches } from '../../lib/batch-file.mjs';
import { appendTsv } from '../../lib/tsv.mjs';
import { LOG_HEADER, row as logRow } from '../helpers/budget-harness.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const GH = 'https://boards.greenhouse.io/examplerobotics/jobs/7902';
const STALE_REASON = 'saved form read is too old; read the form again';
const FIELDS = [{ selector: '#first_name', key: 'candidate.first_name', label: 'First Name', type: 'text', value: 'Jordan' }];

// A small DOM for the page scripts (as in the fix9 tests).
function el(tag, attrs = {}, children = []) {
  const node = { tagName: tag.toUpperCase(), attrs, children, parentElement: null };
  node.id = attrs.id ?? '';
  node.type = attrs.type ?? (tag === 'input' ? 'text' : tag === 'button' ? 'submit' : tag);
  node.innerText = attrs.text ?? '';
  node.value = attrs.value ?? '';
  for (const c of children) c.parentElement = node;
  node.getAttribute = (k) => (k in attrs ? attrs[k] : null);
  const matches = (x, sel) => sel.split(',').map((s) => s.trim()).some((s) => {
    const m = /^([a-z]*)(?:#([\w-]+))?$/.exec(s);
    return Boolean(m) && (!m[1] || x.tagName === m[1].toUpperCase()) && (!m[2] || x.attrs.id === m[2]);
  });
  const all = (x) => x.children.flatMap((c) => [c, ...all(c)]);
  node.querySelectorAll = (sel) => all(node).filter((x) => matches(x, sel));
  node.querySelector = (sel) => node.querySelectorAll(sel)[0] ?? null;
  node.closest = (sel) => {
    for (let x = node; x; x = x.parentElement) if (matches(x, sel)) return x;
    return null;
  };
  node.contains = (other) => {
    for (let x = other; x; x = x.parentElement) if (x === node) return true;
    return false;
  };
  return node;
}

// The live-mock Greenhouse form: #application_form holding the filled fields and the typed "Submit Application" button.
function liveMockCtx() {
  const form = el('form', { id: 'application_form' }, [el('input', { id: 'first_name' }), el('input', { id: 'email', type: 'email' }), el('button', { id: 'submit_app', type: 'submit', text: 'Submit Application' })]);
  const body = el('body', {}, [el('main', {}, [form])]);
  el('html', {}, [body]);
  const document = { body, querySelectorAll: (s) => body.querySelectorAll(s), querySelector: (s) => body.querySelector(s) };
  return { document, CSS: { escape: (s) => String(s) } };
}

// A filled tab for clickSubmit over the fake DOM: page scripts run in the DOM, clicks are recorded.
function submitTab(ctx) {
  const clicked = [];
  for (const b of ctx.document.querySelectorAll('button')) b.click = () => clicked.push(b.id);
  const send = async (method, params = {}) => {
    if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'T1', type: 'page', url: GH }] };
    if (method === 'Target.attachToTarget') return { sessionId: 'S1' };
    if (method !== 'Runtime.evaluate') return {};
    const e = String(params.expression);
    if (e === 'location.href') return { result: { value: GH } };
    if (e.includes('signin:') && e.includes('confirm:')) return { result: { value: { confirm: 0, signin: 0, password: 0 } } };
    if (e.includes('el.click()') || e.includes('formHasField') || e.includes('.contains(')) return { result: { value: runInNewContext(e, ctx) } };
    if (e.includes('autocomplete') && e.includes('tagName')) return { result: { value: { tag: 'button', type: 'submit', autocomplete: '' } } };
    return { result: { value: null } };
  };
  return { client: { send }, clicked };
}

// An approved batch item whose plan names the live-mock form and its submit, with the given saved text.
async function approvedPlan(text) {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-fix9b-'));
  const dataDir = join(root, 'data');
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\n');
  const [id] = writeBatches(dataDir, { date: '2026-11-03', kind: 'apply', items: [{ company: 'Example Robotics', role: 'Intern', score: 4.1, preview: 'Fake.', link: GH }] });
  const planFile = join(dataDir, 'fill-plans', id, '1.json');
  mkdirSync(join(dataDir, 'fill-plans', id), { recursive: true });
  const plan = { batchId: id, item: 1, url: GH, link: GH, company: 'Example Robotics', role: 'Intern', score: 4.1, formSelector: '#application_form', submitSelector: '#submit_app', ...text, fields: FIELDS };
  writeFileSync(planFile, JSON.stringify(plan));
  updateBatch(dataDir, id, (b) => ({ ...b, items: b.items.map((it) => ({ ...it, plan: planFile })) }));
  await appendTsv(join(dataDir, 'action-log.tsv'), LOG_HEADER, [logRow({ ts: '2026-11-03T18:00:00.000Z', action: 'batch.approve', approval: 'approve all', detail: `batch=${id};items=1` })]);
  return { root, dataDir, id, plan: { ...plan, planFile }, paths: { root, dataDir, packRoot: PACK_ROOT }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const budgetRunner = (calls) => (cmd, args) => (calls.push(args[2]), { code: 0, stdout: 'ok', stderr: '' });

async function clickWith(r) {
  const tab = submitTab(liveMockCtx());
  const budget = [];
  const plan = { ...r.plan, tab: { targetId: 'T1', url: GH } };
  const clicked = await chrome.clickSubmit(tab.client, { plan, paths: r.paths, item: 1, runner: budgetRunner(budget), wait: async () => {} });
  return { clicked, budget, clicks: tab.clicked };
}

async function submitCmd(r) {
  const said = [];
  const budget = [];
  const plan = { ...r.plan, tab: { targetId: 'T1', url: GH, sentinel: { selector: '#first_name', value: 'Jordan' } } };
  writeFileSync(r.plan.planFile, JSON.stringify(plan));
  const code = await chrome.main(['submit', '--batch-id', r.id, '--item', '1', '--root', r.root, '--data-dir', r.dataDir], { say: (l) => said.push(String(l)), runner: budgetRunner(budget) });
  return { code, text: said.join('\n'), budget };
}

// M-007-fix9b-V4-D-none and M-007-fix9b-V4-D-empty
for (const [name, text] of [['none', {}], ['empty', { submitText: '' }]]) {
  test(`M-007-fix9b-V4-D-${name} a plan whose read saved ${name === 'none' ? 'no' : 'an empty'} submit text is refused: no budget call, no apply.pending, no click, finish these yourself with the link`, async () => {
    const r = await approvedPlan(text);
    try {
      const click = await clickWith(r);
      assert.equal(click.clicked.state, 'no-button', JSON.stringify(click.clicked));
      assert.equal(click.clicked.reason, STALE_REASON, JSON.stringify(click.clicked));
      assert.deepEqual(click.clicks, [], 'nothing clicked');
      assert.deepEqual(click.budget, [], 'no apply.pending row');

      const res = await submitCmd(r);
      assert.equal(res.code, chrome.EXIT.refused, res.text);
      assert.deepEqual(res.budget, [], `no budget call at all: ${res.text}`);
      assert.match(res.text, /nothing was clicked/);
      assert.ok(res.text.includes(STALE_REASON) && res.text.includes(GH), res.text);
      const finish = readBatch(r.dataDir, r.id).finishYourself ?? [];
      assert.ok(finish.some((f) => f.link === GH && f.reason === STALE_REASON), JSON.stringify(finish));
    } finally {
      r.cleanup();
    }
  });
}

// M-007-fix9b-V4-D-keep
test('M-007-fix9b-V4-D-keep a plan whose saved text matches the live-mock button still logs apply.pending and clicks it', async () => {
  const r = await approvedPlan({ submitText: 'submit application' });
  try {
    const click = await clickWith(r);
    assert.equal(click.clicked.state, 'clicked', JSON.stringify(click.clicked));
    assert.deepEqual(click.clicks, ['submit_app']);
    assert.deepEqual(click.budget, ['apply.pending']);

    const res = await submitCmd(r);
    assert.deepEqual(res.budget, ['apply.submit'], `the budget check runs: ${res.text}`);
    assert.equal(res.code, chrome.EXIT.notRunning, res.text);
    assert.deepEqual(readBatch(r.dataDir, r.id).finishYourself ?? [], []);
  } finally {
    r.cleanup();
  }
});
