// M-007 fix round 1, S-1: chrome.mjs submit refuses (exit 3, "fill it again") an approved item whose plan has a text
// field but whose last fill typed none (no fill sentinel). S-4: the batch approval footer says what goes out now, with no
// third ask. budget.mjs is a fake runner that passes every check; the automation Chrome is never reached (a liveness
// probe would print "not running" and exit 7). Fake data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateBatch, writeBatches } from '../../lib/batch-file.mjs';
import { appendTsv } from '../../lib/tsv.mjs';
import { main as batchMain } from '../../scripts/batch.mjs';
import { EXIT, main, unfilled } from '../../scripts/chrome.mjs';
import { LOG_HEADER, row } from '../helpers/budget-harness.mjs';

const LINK = 'https://boards.greenhouse.io/examplerobotics/jobs/9001';
const TEXT_FIELD = { selector: '#first_name', key: 'candidate.first_name', label: 'First Name', type: 'text', value: 'Jordan' };
const UPLOAD = { selector: '#resume', key: 'upload.resume', label: 'Resume', type: 'file', slot: 'resume' };

async function approvedPlan(plan) {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-submit-'));
  const dataDir = join(root, 'data');
  mkdirSync(join(root, 'config'), { recursive: true });
  writeFileSync(join(root, 'config', 'student.yml'), 'timezone: America/Chicago\n');
  const [id] = writeBatches(dataDir, { date: '2026-11-03', kind: 'apply', items: [{ company: 'Example Robotics', role: 'Intern', score: 4.1, preview: 'Fake.', link: LINK }] });
  const file = join(dataDir, 'fill-plans', id, '1.json');
  mkdirSync(join(dataDir, 'fill-plans', id), { recursive: true });
  writeFileSync(file, JSON.stringify({ batchId: id, item: 1, url: LINK, link: LINK, company: 'Example Robotics', role: 'Intern', score: 4.1, ...plan }));
  updateBatch(dataDir, id, (b) => ({ ...b, items: b.items.map((it) => ({ ...it, plan: file })) }));
  await appendTsv(join(dataDir, 'action-log.tsv'), LOG_HEADER, [row({ ts: '2026-11-03T18:00:00.000Z', action: 'batch.approve', approval: 'approve all', detail: `batch=${id};items=1` })]);
  return { root, dataDir, id, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

async function submit(r) {
  const said = [];
  const budget = [];
  const code = await main(['submit', '--batch-id', r.id, '--item', '1', '--root', r.root, '--data-dir', r.dataDir], {
    say: (l) => said.push(String(l)),
    runner: (cmd, args) => (budget.push(args[2]), { code: 0, stdout: 'ok', stderr: '' }),
  });
  return { code, text: said.join('\n'), budget };
}

test('S-1 submit refuses an approved item with a text field and no fill sentinel: exit 3, "fill it again", nothing clicked', async () => {
  const r = await approvedPlan({ fields: [TEXT_FIELD, UPLOAD] });
  try {
    const res = await submit(r);
    assert.equal(res.code, EXIT.refused, res.text);
    assert.match(res.text, /fill it again/);
    assert.match(res.text, /nothing was clicked/);
    assert.ok(!res.budget.includes('apply.pending'), 'no pending row was logged');
  } finally {
    r.cleanup();
  }
});

test('S-4 after "approve all except 2" the footer says what goes out now and asks nothing more', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pack-m007-approve-'));
  const dataDir = join(root, 'data');
  try {
    for (const kind of ['apply', 'outreach']) {
      const [id] = writeBatches(dataDir, { date: '2026-11-03', kind, items: [1, 2, 3].map((n) => ({ company: `Example Co ${n}`, role: 'Intern', score: 4.1, preview: 'Fake.', link: `${LINK}${n}` })) });
      const said = [];
      const code = await batchMain(['approve', id, 'approve all except 2', '--root', root, '--data-dir', dataDir], { say: (l) => said.push(String(l)), runner: () => ({ code: 0, stdout: '', stderr: '' }) });
      assert.equal(code, 0, said.join('\n'));
      const verb = kind === 'apply' ? 'submitting' : 'sending';
      assert.ok(said.includes(`Next: I'm ${verb} items 1, 3 of ${id} now; nothing else goes out`), said.join('\n'));
      assert.ok(said.includes(`Type: show the status of ${id}`), said.join('\n'));
      assert.ok(!said.some((l) => /^Type: (submit|send) the approved/.test(l)), 'no third ask');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('S-1 a filled tab (sentinel set) or a plan with no text field passes this check and goes on to the browser', async () => {
  for (const plan of [{ fields: [TEXT_FIELD], tab: { targetId: 'T1', url: LINK, sentinel: { selector: '#first_name', value: 'Jordan' } } }, { fields: [UPLOAD] }]) {
    const r = await approvedPlan(plan);
    try {
      const res = await submit(r);
      assert.equal(res.code, EXIT.notRunning, `${JSON.stringify(plan)}: ${res.text}`);
    } finally {
      r.cleanup();
    }
  }
  assert.equal(unfilled({ fields: [{ ...TEXT_FIELD, selector: undefined }] }), false, 'a field with no selector is never typed, so it is not counted');
});
