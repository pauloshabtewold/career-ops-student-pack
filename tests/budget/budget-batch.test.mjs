// budget.mjs batch approvals: batch.approve logging with the approval_batch_max ceiling, apply.submit checks keyed by
// --batch-id and --item, apply.pending rows, and approvedItem(rows, batchId, item). Scratch packs only; fake companies.
// The clock is pinned to the local date of the run so chrome.mjs submit (which passes no --today) sees the same day.
// Fill plan shape used for chrome.mjs submit (ruling): data/fill-plans/<batchId>/<item>.json holding
// { batchId, item, url, company, role, track, score }.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT, TZ, makePack, readLog, run } from '../helpers/budget-harness.mjs';

const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const BATCH = '2026-11-03-apply-1';
const SUBMIT = ['--target', 'ex-new', '--company', 'Example Robotics', '--track', 'swe-intern', '--score', '4.2', '--batch', '1'];

const items = (n) => Array.from({ length: n }, (_, i) => i + 1).join(',');
const approve = (p, list, { id = BATCH, words = 'approve all' } = {}) =>
  run(p, ['log', 'batch.approve', '--batch-id', id, '--items', list, '--approval', words], { today: TODAY });
const check = (p, item, { id = BATCH } = {}) => run(p, ['check', 'apply.submit', ...SUBMIT, '--batch-id', id, '--item', String(item)], { today: TODAY });
const pending = (p, item, { id = BATCH } = {}) =>
  run(p, ['log', 'apply.pending', '--batch-id', id, '--item', String(item), '--target', 'ex-new', '--company', 'Example Robotics'], { today: TODAY });
const out = (r) => r.stdout + r.stderr;

function writePlan(p, item, { id = BATCH } = {}) {
  const dir = join(p.dataDir, 'fill-plans', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${item}.json`),
    JSON.stringify({ batchId: id, item, url: `https://boards.greenhouse.io/examplerobotics/jobs/${1000 + item}`, company: 'Example Robotics', role: 'Software Engineering Intern', track: 'swe-intern', score: 4.2 }),
  );
}

function chromeSubmit(p, item, { id = BATCH } = {}) {
  const env = { ...process.env };
  delete env.BROWSER_SLOT_CMD;
  delete env.CI;
  const r = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'chrome.mjs'), 'submit', '--batch-id', id, '--item', String(item), '--root', p.root, '--data-dir', p.dataDir], {
    cwd: PACK_ROOT,
    env,
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// M-002-S23-osdr
test('M-002-S23-osdr budget check apply.submit for an item outside any logged approval exits 3 and chrome.mjs submit clicks nothing', async () => {
  const p = await makePack();
  try {
    assert.equal(approve(p, '1,2,3').code, 0);
    const outside = check(p, 4);
    assert.equal(outside.code, 3, out(outside));
    const otherBatch = check(p, 1, { id: '2026-11-03-apply-9' });
    assert.equal(otherBatch.code, 3, out(otherBatch));
    const inside = check(p, 2);
    assert.equal(inside.code, 0, out(inside));

    writePlan(p, 4);
    const before = (await readLog(p)).length;
    const res = chromeSubmit(p, 4);
    assert.equal(res.code, 3, out(res));
    const rows = await readLog(p);
    assert.equal(rows.length, before, 'chrome.mjs submit logs nothing when the budget refuses');
    assert.ok(!rows.some((r) => r.action === 'apply.pending' || r.action === 'apply.submit'));
  } finally {
    p.cleanup();
  }
});

// M-002-S28-osdr
test('M-002-S28-osdr a batch.approve listing 11 items exits 3 naming approval_batch_max and logs nothing while a 10-item approval logs', async () => {
  const p = await makePack();
  try {
    const eleven = approve(p, items(11));
    assert.equal(eleven.code, 3, out(eleven));
    assert.match(out(eleven), /approval_batch_max/);
    assert.equal((await readLog(p)).length, 0);

    const ten = approve(p, items(10));
    assert.equal(ten.code, 0, out(ten));
    const rows = await readLog(p);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'batch.approve');
    assert.equal(rows[0].approval, 'approve all');
  } finally {
    p.cleanup();
  }
});

// M-002-S30-osdr
test('M-002-S30-osdr a second apply.submit check for the same batch-id and item exits 3', async () => {
  const p = await makePack();
  try {
    assert.equal(approve(p, '1,2').code, 0);
    assert.equal(check(p, 1).code, 0);
    const logged = run(p, ['log', 'apply.submit', ...SUBMIT, '--batch-id', BATCH, '--item', '1', '--approval', 'submit 1'], { today: TODAY });
    assert.equal(logged.code, 0, out(logged));
    const again = check(p, 1);
    assert.equal(again.code, 3, out(again));
    assert.equal(check(p, 2).code, 0, 'the other approved item is still unspent');
  } finally {
    p.cleanup();
  }
});

// M-002-S42-osdr
test('M-002-S42-osdr approvedItem treats an item with an apply.pending row as used', async () => {
  const { approvedItem } = await import('../../scripts/budget.mjs');
  const p = await makePack();
  try {
    assert.equal(approve(p, '1,2,3').code, 0);
    let rows = await readLog(p);
    assert.equal(approvedItem(rows, BATCH, 2), true);
    assert.equal(approvedItem(rows, BATCH, 4), false);
    assert.equal(approvedItem(rows, 'another-batch', 2), false);

    const logged = pending(p, 2);
    assert.equal(logged.code, 0, out(logged));
    rows = await readLog(p);
    assert.equal(approvedItem(rows, BATCH, 2), false, 'an apply.pending row spends the item');
    assert.equal(approvedItem(rows, BATCH, 1), true);
    assert.equal(check(p, 2).code, 3);
  } finally {
    p.cleanup();
  }
});
