// scripts/outreach-drafts.mjs: drafts go through an injected headless runner (never a real model), a draft naming a
// fact absent from cv.md and the contact data is flagged and kept out of the outreach batch, and with T6 off every
// incoming reply gets an AI reply suggestion. Scratch roots with a synthetic cv.md and placeholder contacts only.
// Rulings: deps.headless replaces lib/headless.mjs runHeadless and returns { text, model, usage }; the flag shows in
// the say() output or the returned value with the word "flag" and the contact or company; batches are read back
// through lib/batch-file.mjs; a reply is { name, company, text }.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftJobs, outreachDrafts } from '../../scripts/outreach-drafts.mjs';
import { listBatches, readBatch } from '../../lib/batch-file.mjs';
import { resolvePaths } from '../../lib/paths.mjs';
import { appendTsv, serializeTsv } from '../../lib/tsv.mjs';
import { LOG_HEADER, at, shiftDate, liRow } from '../helpers/budget-harness.mjs';
import { makeRoot } from '../helpers/script-harness.mjs';
import { A, B, C, ACME, GLOBEX, CONTACT_HEADER, contact } from '../helpers/outreach-harness.mjs';

const DAY = '2026-03-10';
const CV = '# Sample Student\n\nSynthetic fixture resume.\n\nB.S. in Information Systems, expected May 2027.\n\nSkills: Python, SQL, Excel.\n';
const CLEAN = 'Thanks for connecting. I would like to hear how you chose your field when you have time.';
const INVENTED = 'Thanks for connecting. I have built Kubernetes clusters for your platform team.';

// M-004-S9-osdr
test('M-004-S9-osdr a drafted message that names a fact absent from cv.md is flagged', async () => {
  const r = makeRoot();
  try {
    r.write('cv.md', CV);
    r.write('data/contacts.tsv', serializeTsv(CONTACT_HEADER, [contact(shiftDate(DAY, -3), ACME, A, 'accepted'), contact(shiftDate(DAY, -3), GLOBEX, C, 'accepted')]));
    const ago = (days, action, target, company) => liRow({ ts: at(shiftDate(DAY, -days), 12, 0), action, target, company });
    await appendTsv(r.file('data/action-log.tsv'), LOG_HEADER, [
      ago(6, 'linkedin.connect', A, ACME),
      ago(6, 'linkedin.connect', C, GLOBEX),
      ago(3, 'linkedin.accept', A, ACME),
      ago(3, 'linkedin.accept', C, GLOBEX),
    ]);
    const headless = async (opts) => ({ text: String(opts.prompt).includes(ACME) ? INVENTED : CLEAN, model: 'sonnet', usage: null });
    const said = [];
    const result = await outreachDrafts({ paths: resolvePaths({ root: r.root, dataDir: r.data }), today: DAY, replies: [], deps: { headless }, say: (s) => said.push(String(s)) });

    const batches = JSON.stringify(listBatches(r.data).map((id) => readBatch(r.data, id)));
    assert.ok(batches.includes(GLOBEX), `the clean draft is in the outreach batch: ${batches}`);
    assert.ok(!batches.includes(ACME), `the flagged draft is kept out of the batch: ${batches}`);
    const report = [...said, JSON.stringify(result ?? null)].join('\n');
    assert.match(report, /flag/i, `the draft is flagged: ${report}`);
    assert.ok(report.includes(A) || report.includes(ACME), `the flag names the contact: ${report}`);
  } finally {
    r.cleanup();
  }
});

// M-004-S14-osdr
test('M-004-S14-osdr with T6 off every incoming reply including thanks and no replies gets an AI reply suggestion', () => {
  const replies = [
    { name: A, company: ACME, text: 'Thanks so much!' },
    { name: B, company: GLOBEX, text: 'No, we are not hiring right now.' },
    { name: C, company: 'Initech Example', text: 'Could you send your resume and tell me which team interests you?' },
  ];
  const off = draftJobs({ due: [], followups: [], replies, t6On: false });
  assert.equal(off.length, 3, 'T6 off: one suggestion per reply');
  const json = JSON.stringify(off);
  for (const reply of replies) assert.ok(json.includes(reply.name), `${reply.name} gets a suggestion`);

  const on = draftJobs({ due: [], followups: [], replies, t6On: true });
  assert.equal(on.length, 1, 'T6 on: only the reply that needs an answer gets a suggestion');
  assert.ok(JSON.stringify(on).includes(C));
});
