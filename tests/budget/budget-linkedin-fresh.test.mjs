// budget.mjs M-003 ceilings: easy_apply_per_day 12 (check apply.easy_apply, which also needs --batch-id and --item of a
// logged approved batch) and linkedin_fresh_search_per_hour 1 (check linkedin.fresh_search); chrome.mjs submit
// --kind easy-apply clicks nothing when that check refuses. Scratch packs only; fake companies; no browser starts: every
// chrome.mjs submit here is refused by the budget before any browser step, with no slot command in its environment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DAY, PACK_ROOT, TZ, at, liRow, many, makePack, readLog, run } from '../helpers/budget-harness.mjs';

const BATCH = `${DAY}-apply-1`;
const out = (r) => r.stdout + r.stderr;
const easyRows = (n) => many(n, (i) => liRow({ ts: at(DAY, 8, i * 4), action: 'apply.easy_apply', target: `ex-ea-${i}`, company: `Example Co ${i}` }));
const approve = (p, list, { id = BATCH, today = DAY } = {}) => run(p, ['log', 'batch.approve', '--batch-id', id, '--items', list, '--approval', 'approve all'], { today });
const easyCheck = (p, extra) => run(p, ['check', 'apply.easy_apply', '--target', 'ex-new', '--company', 'Example Robotics', ...extra]);

// M-003-S7-osdr
test('M-003-S7-osdr the 13th Easy Apply of a day exits 3 and a second fresh search inside one hour exits 4', async () => {
  const { CEILINGS } = await import('../../scripts/budget.mjs');
  assert.deepEqual({ value: CEILINGS.easy_apply_per_day?.value, tighten: CEILINGS.easy_apply_per_day?.tighten }, { value: 12, tighten: 'down' });
  assert.deepEqual(
    { value: CEILINGS.linkedin_fresh_search_per_hour?.value, tighten: CEILINGS.linkedin_fresh_search_per_hour?.tighten },
    { value: 1, tighten: 'down' },
  );

  const eleven = await makePack({ rows: easyRows(11) });
  const twelve = await makePack({ rows: easyRows(12) });
  const recent = await makePack({ rows: [liRow({ ts: at(DAY, 11, 20), action: 'linkedin.fresh_search', target: 'fresh-search' })] });
  const older = await makePack({ rows: [liRow({ ts: at(DAY, 10, 40), action: 'linkedin.fresh_search', target: 'fresh-search' })] });
  try {
    for (const p of [eleven, twelve]) assert.equal(approve(p, '1,2').code, 0);
    const twelfth = easyCheck(eleven, ['--batch-id', BATCH, '--item', '1']);
    assert.equal(twelfth.code, 0, `the 12th Easy Apply is allowed: ${out(twelfth)}`);
    const thirteenth = easyCheck(twelve, ['--batch-id', BATCH, '--item', '1']);
    assert.equal(thirteenth.code, 3, `the 13th Easy Apply is refused: ${out(thirteenth)}`);

    const again = run(recent, ['check', 'linkedin.fresh_search']);
    assert.equal(again.code, 4, `a fresh search 40 minutes after the last one waits: ${out(again)}`);
    const later = run(older, ['check', 'linkedin.fresh_search']);
    assert.equal(later.code, 0, `a fresh search 80 minutes after the last one is allowed: ${out(later)}`);
  } finally {
    for (const p of [eleven, twelve, recent, older]) p.cleanup();
  }
});

// chrome.mjs submit reads the local date itself (no --today), so the approval for that part is logged on the real date.
const LOCAL_TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function chromeSubmit(p, args) {
  const env = { ...process.env };
  delete env.BROWSER_SLOT_CMD;
  delete env.CI;
  const r = spawnSync(process.execPath, [join(PACK_ROOT, 'scripts', 'chrome.mjs'), 'submit', ...args, '--root', p.root, '--data-dir', p.dataDir], {
    cwd: PACK_ROOT,
    env,
    encoding: 'utf8',
    timeout: 60000,
  });
  return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// M-003-S11-osdr
test('M-003-S11-osdr budget check apply.easy_apply without a logged approved batch item exits 3 and chrome.mjs submit --kind easy-apply clicks nothing', async () => {
  const p = await makePack();
  const live = await makePack();
  try {
    assert.equal(approve(p, '1,2').code, 0);
    const bare = easyCheck(p, []);
    assert.equal(bare.code, 3, `no --batch-id and --item: ${out(bare)}`);
    const outside = easyCheck(p, ['--batch-id', BATCH, '--item', '3']);
    assert.equal(outside.code, 3, `an item outside the approval: ${out(outside)}`);
    const unlogged = easyCheck(p, ['--batch-id', `${DAY}-apply-9`, '--item', '1']);
    assert.equal(unlogged.code, 3, `a batch with no logged approval: ${out(unlogged)}`);
    const inside = easyCheck(p, ['--batch-id', BATCH, '--item', '2']);
    assert.equal(inside.code, 0, `an approved, unspent item passes: ${out(inside)}`);

    const liveBatch = `${LOCAL_TODAY}-apply-1`;
    assert.equal(approve(live, '1,2', { id: liveBatch, today: LOCAL_TODAY }).code, 0);
    const dir = join(live.dataDir, 'fill-plans', liveBatch);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, '3.json'),
      JSON.stringify({ batchId: liveBatch, item: 3, url: 'https://www.linkedin.com/jobs/view/4100000003/', company: 'Example Robotics', role: 'Software Engineering Intern', track: 'swe-intern', score: 4.2 }),
    );
    const before = (await readLog(live)).length;
    const res = chromeSubmit(live, ['--kind', 'easy-apply', '--batch-id', liveBatch, '--item', '3']);
    assert.notEqual(res.code, 0, out(res));
    const rows = await readLog(live);
    assert.equal(rows.length, before, 'nothing is logged when the easy-apply check refuses');
    assert.ok(!rows.some((x) => x.action === 'apply.easy_apply' || x.action === 'apply.submit' || x.action === 'apply.pending'));
  } finally {
    p.cleanup();
    live.cleanup();
  }
});
