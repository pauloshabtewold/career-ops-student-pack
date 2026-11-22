// scripts/batch.mjs approve through the CLI in a scratch root: the reply is parsed by lib/approval-grammar.mjs and logged
// as budget.mjs batch.approve; budget check apply.submit then passes for an approved item. Fake companies only.
// Batch items (ruling): { company, role, score, preview, link }; the batch id comes from listBatches(dataDir).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { TZ, readLog, run as runBudget } from '../helpers/budget-harness.mjs';
import { PACK_ROOT, makeRoot } from '../helpers/script-harness.mjs';

const LOCAL_TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function batchCli(r, args) {
  const out = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'batch.mjs'), ...args, '--root', r.root, '--data-dir', r.data], { cwd: PACK_ROOT, encoding: 'utf8', timeout: 60000 });
  return { code: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '', text: `${out.stdout ?? ''}${out.stderr ?? ''}` };
}

async function withBatch(n, fn) {
  const { writeBatches, listBatches } = await import('../../lib/batch-file.mjs');
  const r = makeRoot();
  try {
    writeBatches(r.data, {
      date: LOCAL_TODAY,
      kind: 'apply',
      items: Array.from({ length: n }, (_, i) => ({ company: `Example Co ${i + 1}`, role: 'Software Engineering Intern', score: 4.2, preview: `Fake letter preview ${i + 1}.`, link: `https://boards.greenhouse.io/exampleco${i + 1}/jobs/${100 + i}` })),
    });
    const ids = listBatches(r.data).map((b) => (typeof b === 'string' ? b : b.id));
    assert.equal(ids.length, 1, 'one batch file written');
    await fn(r, ids[0]);
  } finally {
    r.cleanup();
  }
}

const pack = (r) => ({ root: r.root, dataDir: r.data, logFile: join(r.data, 'action-log.tsv') });

// M-002-S6-osdr
test('M-002-S6-osdr approve all logs batch.approve and budget check apply.submit then passes for item 2 of that batch', () =>
  withBatch(3, async (r, id) => {
    const res = batchCli(r, ['approve', id, 'approve all']);
    assert.equal(res.code, 0, res.text);
    const rows = await readLog(pack(r));
    const approvals = rows.filter((x) => x.action === 'batch.approve');
    assert.equal(approvals.length, 1, JSON.stringify(rows));
    assert.equal(approvals[0].approval, 'approve all');

    const submit = ['check', 'apply.submit', '--target', 'ex-2', '--company', 'Example Co 2', '--track', 'swe-intern', '--score', '4.2', '--batch', '1'];
    const ok = runBudget(pack(r), [...submit, '--batch-id', id, '--item', '2'], { today: LOCAL_TODAY });
    assert.equal(ok.code, 0, ok.stdout + ok.stderr);
    const outside = runBudget(pack(r), [...submit, '--batch-id', id, '--item', '4'], { today: LOCAL_TODAY });
    assert.equal(outside.code, 3, 'item 4 is not part of the three-item batch');
  }));

// M-002-S41-osdr
test('M-002-S41-osdr batch.mjs approve with an unknown batch id exits 2 and with an unreadable reply exits 5', () =>
  withBatch(3, async (r, id) => {
    const unknown = batchCli(r, ['approve', '2026-01-01-apply-99', 'approve all']);
    assert.equal(unknown.code, 2, unknown.text);
    assert.equal((await readLog(pack(r))).length, 0);

    const unreadable = batchCli(r, ['approve', id, 'maybe the blue ones later']);
    assert.equal(unreadable.code, 5, unreadable.text);
    assert.equal((await readLog(pack(r))).length, 0, 'nothing logged for an unreadable reply');
  }));
