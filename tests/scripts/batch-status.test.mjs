// scripts/batch.mjs status after the M-002 review: an approved item with an apply.pending row and no submit row reads
// "clicked, not confirmed: check <link>", never "approved, waiting"; finish-these-yourself jobs show their reason. Fake
// data only; no browser, no budget child process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { main } from '../../scripts/batch.mjs';
import { addFinishYourself, updateBatch, writeBatches } from '../../lib/batch-file.mjs';
import { appendTsv } from '../../lib/tsv.mjs';
import { makeRoot } from '../helpers/script-harness.mjs';
import { LOG_HEADER, row } from '../helpers/budget-harness.mjs';

const link = (n) => `https://boards.greenhouse.io/examplerobotics/jobs/${6000 + n}`;

test('S-B status shows a pending row with no submit as clicked, not confirmed, and lists form-refused jobs to finish', async () => {
  const r = makeRoot();
  try {
    const [id] = writeBatches(r.data, { date: '2026-11-03', kind: 'apply', items: [1, 2, 3].map((n) => ({ company: `Example Co ${n}`, role: 'Data Intern', score: 4.1, preview: 'Fake.', link: link(n) })) });
    updateBatch(r.data, id, (b) => ({ ...b, approved: { items: [1, 2, 3], words: 'approve all' } }));
    const now = new Date();
    await appendTsv(join(r.data, 'action-log.tsv'), LOG_HEADER, [
      row({ ts: now, action: 'batch.approve', detail: `batch=${id};items=1,2,3` }),
      row({ ts: now, action: 'apply.pending', company: 'Example Co 1', detail: `batch=${id};item=1` }),
      row({ ts: now, action: 'apply.submit', company: 'Example Co 1', detail: `batch=${id};item=1` }),
      row({ ts: now, action: 'apply.pending', company: 'Example Co 2', detail: `batch=${id};item=2` }),
    ]);
    addFinishYourself(r.data, id, { company: 'Example Co 2', role: 'Data Intern', link: link(2), reason: 'form refused: School' });
    const lines = [];
    assert.equal(await main(['status', id, '--root', r.root, '--data-dir', r.data], { say: (l) => lines.push(l) }), 0);
    const text = lines.join('\n');
    assert.match(text, /1\. Example Co 1 \| Data Intern \| submitted/);
    assert.ok(text.includes(`2. Example Co 2 | Data Intern | clicked, not confirmed: check ${link(2)}`), text);
    assert.match(text, /3\. Example Co 3 \| Data Intern \| approved, waiting/);
    assert.ok(text.includes(`Example Co 2 | Data Intern | ${link(2)} (form refused: School)`), text);
  } finally {
    r.cleanup();
  }
});
