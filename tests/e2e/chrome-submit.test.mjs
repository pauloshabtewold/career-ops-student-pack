// chrome.mjs fill and submit after the M-002 review fixes: real automation Chrome against the local mock ATS only.
// One Chrome for the file, started through chrome-harness (browser slot gate).
// Cases: an invisible reCAPTCHA badge does not stop the fill (SHOULD-8); a confirmed submit logs apply.submit and the
// mock records it; a submit-time CAPTCHA goes to finish-yourself unlogged; a required-field error is not submitted and
// not logged (MUST-5). Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gate, openChrome, runChromeCli, stopAll } from '../helpers/chrome-harness.mjs';
import { startMockAts } from '../helpers/mock-ats-server.mjs';
import { PACK_ROOT as W, makeRoot } from '../helpers/script-harness.mjs';
import { writeBatches, updateBatch, readBatch } from '../../lib/batch-file.mjs';
import { readActionLog } from '../../lib/action-log.mjs';

const PERSON = { first: 'Jordan', last: 'Testwell', email: 'jordan.testwell@example.com' };

function fields(r) {
  const resume = join(r.root, 'resume-fake.pdf');
  writeFileSync(resume, '%PDF-1.4\n% fake\n%%EOF\n');
  return [
    { selector: '#first_name', label: 'First Name', type: 'text', value: PERSON.first },
    { selector: '#last_name', label: 'Last Name', type: 'text', value: PERSON.last },
    { selector: '#email', label: 'Email', type: 'text', value: PERSON.email },
    { selector: '#resume', label: 'Resume/CV', type: 'file', value: resume },
  ];
}

// One single-item batch for url, its plan file where fill-plan writes it, and the logged approval.
function prepare(r, url, company) {
  const [id] = writeBatches(r.data, { date: '2026-11-03', kind: 'apply', items: [{ company, role: 'Software Engineering Intern', score: 4.2, preview: 'Fake.', link: url }] });
  const file = join(r.data, 'fill-plans', id, '1.json');
  mkdirSync(join(r.data, 'fill-plans', id), { recursive: true });
  writeFileSync(file, JSON.stringify({ batchId: id, item: 1, url, link: url, company, role: 'Software Engineering Intern', score: 4.2, formSelector: '#application_form', submitSelector: '#submit_app', submitText: 'submit application', fields: fields(r) }));
  updateBatch(r.data, id, (b) => ({ ...b, items: b.items.map((it) => ({ ...it, plan: file })) }));
  const ap = spawnSync(process.execPath, [join(W, 'scripts', 'budget.mjs'), 'log', 'batch.approve', '--batch-id', id, '--items', '1', '--approval', 'approve all', '--root', r.root, '--data-dir', r.data], { cwd: W, encoding: 'utf8' });
  assert.equal(ap.status, 0, ap.stdout + ap.stderr);
  return { id, file };
}

const rowsFor = async (r, id) => (await readActionLog(join(r.data, 'action-log.tsv'))).filter((x) => x.detail.includes(`batch=${id};`));

test('[e2e] M-002 fix: badge-only fill proceeds; submit is logged only when the mock confirms it', async (t) => {
  const reason = await gate();
  if (reason) return t.skip(reason);
  const r = makeRoot();
  const ats = await startMockAts();
  try {
    const open = await openChrome({ root: r.root, dataDir: r.data });
    if (open.skip) return t.skip(open.skip);
    assert.equal(open.code, 0, open.stdout + open.stderr);

    await t.test('S8 an invisible reCAPTCHA badge does not stop the fill; the confirmed submit logs apply.submit', async () => {
      const url = `${ats.url}/greenhouse/form?job=31&badge=1`;
      const { id, file } = prepare(r, url, 'Example Co A');
      const fill = await runChromeCli(['fill', '--plan', file], { root: r.root, dataDir: r.data });
      assert.equal(fill.code, 0, fill.stdout + fill.stderr);
      const sub = await runChromeCli(['submit', '--batch-id', id, '--item', '1'], { root: r.root, dataDir: r.data });
      assert.equal(sub.code, 0, sub.stdout + sub.stderr);
      assert.deepEqual(ats.submissions(), [{ job: 31 }]);
      assert.deepEqual((await rowsFor(r, id)).map((x) => x.action), ['batch.approve', 'apply.pending', 'apply.submit']);
    });

    await t.test('M5 a CAPTCHA on submit goes to finish these yourself and is not logged as submitted', async () => {
      const url = `${ats.url}/greenhouse/form?job=32&submitcaptcha=1`;
      const { id, file } = prepare(r, url, 'Example Co B');
      assert.equal((await runChromeCli(['fill', '--plan', file], { root: r.root, dataDir: r.data })).code, 0);
      const sub = await runChromeCli(['submit', '--batch-id', id, '--item', '1'], { root: r.root, dataDir: r.data });
      assert.equal(sub.code, 6, sub.stdout + sub.stderr);
      assert.ok(!ats.submissions().some((s) => s.job === 32));
      assert.ok(!(await rowsFor(r, id)).some((x) => x.action === 'apply.submit'));
      assert.ok(readBatch(r.data, id).finishYourself.some((f) => f.link === url), 'link on finish these yourself');
    });

    await t.test('M5 a required-field error leaves the job unsubmitted, reported and unlogged', async () => {
      const url = `${ats.url}/greenhouse/form?job=33&required=1`;
      const { id, file } = prepare(r, url, 'Example Co C');
      assert.equal((await runChromeCli(['fill', '--plan', file], { root: r.root, dataDir: r.data })).code, 0);
      const sub = await runChromeCli(['submit', '--batch-id', id, '--item', '1'], { root: r.root, dataDir: r.data });
      assert.equal(sub.code, 5, sub.stdout + sub.stderr);
      assert.match(sub.stdout, /not submitted.*School/);
      assert.ok(!ats.submissions().some((s) => s.job === 33));
      assert.ok(!(await rowsFor(r, id)).some((x) => x.action === 'apply.submit'));
    });

    await t.test('M2 a second item whose URL shares a prefix is never submitted through the first tab', async () => {
      const url = `${ats.url}/greenhouse/form?job=3`;
      const { id, file } = prepare(r, url, 'Example Co D');
      // The job=3 tab was never filled: submit refuses instead of clicking the job=31 or job=33 tab.
      const sub = await runChromeCli(['submit', '--batch-id', id, '--item', '1'], { root: r.root, dataDir: r.data });
      assert.equal(sub.code, 3, sub.stdout + sub.stderr);
      assert.ok(!ats.submissions().some((s) => s.job === 3));
      void file;
    });
  } finally {
    await stopAll({ root: r.root, dataDir: r.data });
    await ats.close();
    r.cleanup();
  }
});
