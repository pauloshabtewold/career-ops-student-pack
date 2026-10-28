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
    assert.equal(run(p, ['log', 'apply.submit', '--target', 'ex-new', '--company', 'Example Robotics', '--track', 'swe-intern', '--approval', 'submit 1,2']).code, 0);
    const rows = await readLog(p);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.action), ['linkedin.message', 'apply.submit']);
    assert.equal(rows[0].approval, 'send all');
    assert.equal(rows[1].approval, 'submit 1,2');
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
