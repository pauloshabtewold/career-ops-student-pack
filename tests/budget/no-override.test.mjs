import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { BUDGET_CLI, DAY, PACK_ROOT, at, baseConfig, makePack, readLog, row, run } from '../helpers/budget-harness.mjs';

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
    assert.equal(run(p, ['log', 'batch.approve', '--batch-id', 'b1', '--items', '1,2', '--approval', 'submit 1,2']).code, 0);
    assert.equal(run(p, ['log', 'linkedin.message', '--target', 'ex-new', '--company', 'Example Robotics', '--approval', 'send all', '--batch-id', 'b1', '--item', '2']).code, 0);
    assert.equal(run(p, ['log', 'apply.submit', '--target', 'ex-new', '--company', 'Example Robotics', '--track', 'swe-intern', '--batch-id', 'b1', '--item', '1']).code, 0);
    const rows = await readLog(p);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.action), ['batch.approve', 'linkedin.message', 'apply.submit']);
    assert.equal(rows[0].approval, 'submit 1,2');
    assert.equal(rows[1].approval, 'send all');
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

test('a LinkedIn send logged with the approval words but no approved batch item exits 2 and writes nothing', async () => {
  const p = await makePack();
  try {
    assert.equal(run(p, ['log', 'linkedin.connect', '--target', 'ex-new', '--company', 'Example Robotics', '--approval', 'send all']).code, 2);
    assert.equal(run(p, ['check', 'linkedin.message', '--target', 'ex-new', '--company', 'Example Robotics', '--length', '100']).code, 3);
    assert.equal((await readLog(p)).filter((r) => r.action !== 'budget.clamp').length, 0);
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

// apply.pending is a compare-and-set under the action-log lock: it refuses an unapproved item and an item already used,
// and of two concurrent pending logs for one item exactly one is written.
const pendingArgs = (item, id = 'b-cas') => ['log', 'apply.pending', '--batch-id', id, '--item', String(item), '--target', 'ex-cas', '--company', 'Example Robotics'];

function runAsync(p, argv) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BUDGET_CLI, ...argv, '--root', p.root, '--data-dir', p.dataDir, '--today', DAY], { cwd: PACK_ROOT });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

test('M-002 log apply.pending refuses an unapproved item and a used item with exit 3 and writes nothing', async () => {
  const p = await makePack();
  try {
    assert.equal(run(p, pendingArgs(1)).code, 3, 'no approval logged');
    assert.equal((await readLog(p)).filter((r) => r.action === 'apply.pending').length, 0);
    assert.equal(run(p, ['log', 'batch.approve', '--batch-id', 'b-cas', '--items', '1,2', '--approval', 'approve all']).code, 0);
    assert.equal(run(p, pendingArgs(1)).code, 0);
    const again = run(p, pendingArgs(1));
    assert.equal(again.code, 3, again.stdout + again.stderr);
    assert.equal(run(p, pendingArgs(3)).code, 3, 'item outside the approval');
    const rows = (await readLog(p)).filter((r) => r.action === 'apply.pending');
    assert.equal(rows.length, 1);
    assert.match(rows[0].detail, /batch=b-cas;item=1/);
  } finally {
    p.cleanup();
  }
});

test('M-002 two concurrent apply.pending logs for one approved item: exactly one succeeds', async () => {
  const p = await makePack();
  try {
    assert.equal(run(p, ['log', 'batch.approve', '--batch-id', 'b-cas', '--items', '1', '--approval', 'approve all']).code, 0);
    for (let round = 0; round < 3; round++) {
      const id = `b-race-${round}`;
      assert.equal(run(p, ['log', 'batch.approve', '--batch-id', id, '--items', '1', '--approval', 'approve all']).code, 0);
      const codes = (await Promise.all([runAsync(p, pendingArgs(1, id)), runAsync(p, pendingArgs(1, id)), runAsync(p, pendingArgs(1, id))])).map((r) => r.code).sort();
      assert.deepEqual(codes, [0, 3, 3], `round ${round}`);
      assert.equal((await readLog(p)).filter((r) => r.action === 'apply.pending' && r.detail.includes(`batch=${id};`)).length, 1);
    }
  } finally {
    p.cleanup();
  }
});

// A pending row with no apply.submit for its item counts as a submit for every cap, so a click whose log failed never
// loosens the daily or per-company ceiling; a pending row with its apply.submit counts once, and the item being
// checked is not counted against itself.
test('M-002 unmatched apply.pending rows count against the submit caps', async () => {
  const { evaluate } = await import('../../scripts/budget.mjs');
  const now = at(DAY, 15);
  const mk = (action, item, hour) => ({ ...row({ ts: at(DAY, hour), action, target: `ex-${item}`, company: 'Example Robotics', detail: `batch=b-cap;item=${item}` }), ms: at(DAY, hour).getTime() });
  const args = (item) => ({ company: 'Example Robotics', score: 4.2, batch: 1, batchId: 'b-cap', item });
  const config = baseConfig({ limits: { per_company_per_day: 1 } });
  const decide = (history, item) => evaluate({ action: 'apply.submit', args: args(item), history, config, session: 's1', now }).status;
  assert.equal(decide([], 2), 'ok');
  assert.equal(decide([mk('apply.pending', 1, 10)], 2), 'refused', 'a pending click with no submit log uses the company slot');
  assert.equal(decide([mk('apply.pending', 2, 10)], 2), 'ok', 'the item being checked is not counted against itself');
  const two = baseConfig({ limits: { per_company_per_day: 2 } });
  const pair = [mk('apply.pending', 1, 10), mk('apply.submit', 1, 10)];
  assert.equal(evaluate({ action: 'apply.submit', args: args(2), history: pair, config: two, session: 's1', now }).status, 'ok', 'pending plus its submit count once');
  assert.equal(evaluate({ action: 'apply.submit', args: args(3), history: [...pair, mk('apply.pending', 2, 11)], config: two, session: 's1', now }).status, 'refused');
});
