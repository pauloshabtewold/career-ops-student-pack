import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUDGET_CLI, makePack, readLog, run } from '../helpers/budget-harness.mjs';

// M-002-S19
test('M-002-S19 budget.mjs source holds no process.env reference', () => {
  const src = readFileSync(BUDGET_CLI, 'utf8');
  assert.doesNotMatch(src, /process\s*\.\s*env/);
  assert.doesNotMatch(src, /process\s*\[\s*['"`]env['"`]\s*\]/);
});

test('M-002-S19 --force, --override and --max exit 2', async () => {
  const p = await makePack();
  try {
    for (const flag of [['--force'], ['--override'], ['--max', '999']]) {
      const r = run(p, ['check', 'linkedin.profile_view', '--target', 'ex-new', ...flag]);
      assert.equal(r.code, 2, flag.join(' '));
    }
    assert.equal(run(p, ['log', 'linkedin.profile_view', '--target', 'ex-new', '--force']).code, 2);
    assert.equal((await readLog(p)).length, 0);
  } finally {
    p.cleanup();
  }
});

test('M-002-S19 an unknown flag exits 2', async () => {
  const p = await makePack();
  try {
    assert.equal(run(p, ['check', 'linkedin.profile_view', '--target', 'ex-new', '--bogus']).code, 2);
  } finally {
    p.cleanup();
  }
});

// M-002-S20
test('M-002-S20 log of a send or submit action without a matching approval exits 2 and writes nothing', async () => {
  const p = await makePack();
  try {
    const sends = [
      ['log', 'linkedin.message', '--target', 'ex-new', '--company', 'Example Robotics'],
      ['log', 'apply.submit', '--target', 'ex-new', '--company', 'Example Robotics', '--track', 'swe-intern'],
    ];
    for (const argv of sends) {
      assert.equal(run(p, argv).code, 2, `${argv[1]} without approval`);
      for (const bad of ['yes', 'send', 'submit', 'send all please', 'send 1;2', 'approve all']) {
        assert.equal(run(p, [...argv, '--approval', bad]).code, 2, `${argv[1]} with "${bad}"`);
      }
    }
    assert.equal((await readLog(p)).length, 0);
  } finally {
    p.cleanup();
  }
});

test('M-002-S20 log accepts send or submit approvals with all or item numbers and writes the row', async () => {
  const p = await makePack();
  try {
    assert.equal(run(p, ['log', 'linkedin.message', '--target', 'ex-new', '--company', 'Example Robotics', '--approval', 'send all']).code, 0);
    assert.equal(run(p, ['log', 'batch.approve', '--batch-id', 'b1', '--items', '1,2', '--approval', 'submit 1,2']).code, 0);
    assert.equal(run(p, ['log', 'apply.submit', '--target', 'ex-new', '--company', 'Example Robotics', '--track', 'swe-intern', '--batch-id', 'b1', '--item', '1']).code, 0);
    const rows = await readLog(p);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.action), ['linkedin.message', 'batch.approve', 'apply.submit']);
    assert.equal(rows[0].approval, 'send all');
    assert.equal(rows[1].approval, 'submit 1,2');
    assert.match(rows[2].detail, /batch=b1;item=1/);
  } finally {
    p.cleanup();
  }
});

test('M-002-S20 log of a non-send action needs no approval', async () => {
  const p = await makePack();
  try {
    assert.equal(run(p, ['log', 'linkedin.profile_view', '--target', 'ex-new']).code, 0);
    assert.equal((await readLog(p)).length, 1);
  } finally {
    p.cleanup();
  }
});

test('a submit check with a logged approved item passes and the same item after its submit refuses', async () => {
  const p = await makePack();
  try {
    const check = ['check', 'apply.submit', '--company', 'Example Robotics', '--track', 'swe-intern', '--score', '4.2', '--batch', '1', '--batch-id', 'b2', '--item', '1'];
    assert.equal(run(p, check).code, 3, 'no approval logged yet');
    assert.equal(run(p, ['log', 'batch.approve', '--batch-id', 'b2', '--items', '1', '--approval', 'approve all']).code, 0);
    assert.equal(run(p, check).code, 0);
    assert.equal(run(p, ['log', 'apply.submit', '--target', 'ex-b2', '--company', 'Example Robotics', '--track', 'swe-intern', '--batch-id', 'b2', '--item', '1']).code, 0);
    assert.equal(run(p, check).code, 3, 'the item was already used');
  } finally {
    p.cleanup();
  }
});

// Batch approval gate: the CLI check of apply.submit (evaluateCheck) needs an unused, logged batch.approve item, while
// evaluate() alone stays the ceiling decision.
test('M-002 evaluateCheck refuses apply.submit without --batch-id and --item, for an unlisted item and for a used item, unlogged', async () => {
  const { evaluate, evaluateCheck } = await import('../../scripts/budget.mjs');
  const { DAY, at, row, shiftDate, baseConfig } = await import('../helpers/budget-harness.mjs');
  const seasoned = row({ ts: at(shiftDate(DAY, -60), 12, 0), action: 'apply.submit', target: 'ex-old', company: 'Old Example Co', session: 's0', detail: 'track=swe-intern' });
  const approval = row({ ts: at(DAY, 8, 0), action: 'batch.approve', approval: 'approve all', detail: 'batch=b1;items=1,2' });
  const args = { target: 'ex-new', company: 'Example Robotics', track: 'swe-intern', score: 4.2, batch: 1, batchId: 'b1', item: 1 };
  const ev = (a, history) => evaluateCheck({ action: 'apply.submit', args: a, history, config: baseConfig(), session: 's1', now: at(DAY, 15, 0) });
  const history = [seasoned, approval];

  const missing = ev({ ...args, batchId: undefined, item: undefined }, history);
  assert.equal(missing.status, 'refused');
  assert.equal(missing.unlogged, true, 'a missing approval refuses only this item and writes no budget.refusal row');
  assert.equal(ev({ ...args, item: 3 }, history).status, 'refused');
  assert.equal(ev(args, history).status, 'ok');
  const used = row({ ts: at(DAY, 9, 0), action: 'apply.submit', target: 'ex-u', company: 'Example Co u', detail: 'track=swe-intern;batch=b1;item=1' });
  assert.equal(ev(args, [...history, used]).status, 'refused');
  assert.equal(ev({ ...args, item: 2 }, [...history, used]).status, 'ok');
  assert.equal(evaluate({ action: 'apply.submit', args: { ...args, batchId: undefined, item: undefined }, history, config: baseConfig(), session: 's1', now: at(DAY, 15, 0) }).status, 'ok');
});

test('M-002 log apply.submit without --batch-id and --item exits 2 and logs nothing', async () => {
  const p = await makePack();
  try {
    const r = run(p, ['log', 'apply.submit', '--target', 'ex-new', '--company', 'Example Robotics', '--track', 'swe-intern', '--score', '4.2', '--batch', '1', '--approval', 'submit 1']);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.equal((await readLog(p)).length, 0);
  } finally {
    p.cleanup();
  }
});
