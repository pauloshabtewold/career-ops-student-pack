// Assumed: dailyTriage chunks the rows in calls of 20, writes one scheduled ledger row (data/triage-usage.tsv) and one
// 'daily triage chunk k of m' digest line after each chunk, and a same-day failure stops later runs. The runner is injected;
// apply-triage.mjs runs for real on the scratch pipeline.md. Digest: data/digest/student-<date>.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyTriage } from '../../scripts/daily-triage.mjs';
import { PLUS, TODAY, args, digestFile, jobUrl, makeRunner, makeTriageRoot, readLedger, sentUrls, untriaged, verdict, writeLedger, claudeArgs } from '../helpers/triage-harness.mjs';
import { rowsOf } from '../helpers/script-harness.mjs';

const BUDGET = (daily) => `${PLUS}triage_budget:\n  daily: ${daily}\n`;
const withRoot = async (opts, fn) => {
  const r = makeTriageRoot(opts);
  try {
    await fn(r);
  } finally {
    r.cleanup();
  }
};
const passAll = (_argv, opts) => [...sentUrls(opts.input)].map((u) => verdict('PASS', u)).join('\n');
const sizes = (calls) => calls.claude.map((c) => sentUrls(c.opts.input).size);
const failWith = (stderr) => () => {
  throw Object.assign(new Error('Command failed: claude -p'), { status: 1, stderr });
};
const triagedCount = (r) => rowsOf(r.read('data/pipeline.md'), 'Pending').filter((x) => x.notes.has('triage')).length;
const digestLines = (r) => r.read(digestFile(r)).split('\n');
const rowOf = (source, rows, outcome = 'ok', date = TODAY) => ({ date, source, rows: String(rows), outcome });

// M-002-S1
test('M-002-S1 a legacy limits.triage_daily 50 with 25 untriaged rows makes 2 claude calls of 20 and 5 rows and applies both', () =>
  withRoot({ config: `${PLUS}limits:\n  triage_daily: 50\n`, pending: untriaged(25) }, async (r) => {
    const { runner, calls } = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r), runner });
    assert.deepEqual(sizes(calls), [20, 5]);
    assert.equal(triagedCount(r), 25);
    assert.deepEqual(readLedger(r), [rowOf('scheduled', 20), rowOf('scheduled', 5)]);
  }));

// M-002-S1
test('M-002-S1 the digest has a progress line per chunk, then the summary with both totals and a cost line', () =>
  withRoot({ config: BUDGET(50), pending: untriaged(25) }, async (r) => {
    const { runner } = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r), runner });
    const lines = digestLines(r);
    const at = (re) => lines.findIndex((l) => re.test(l));
    const c1 = at(/daily triage chunk 1 of 2: triaged 20, passed 20, ignored 0/);
    const c2 = at(/daily triage chunk 2 of 2: triaged 5, passed 5, ignored 0/);
    const sum = at(/^- daily triage: triaged 25, passed 25, ignored 0/);
    const cost = at(/^- daily triage cost: 25 rows sent today \(counted against the budget of 50\); estimate:/);
    assert.ok(c1 >= 0 && c2 > c1 && sum > c2 && cost > sum, lines.join('\n'));
  }));

// M-002-S2
test('M-002-S2 every claude call of a chunked run carries --setting-sources project and --strict-mcp-config before --model, with the prompt on stdin', () =>
  withRoot({ config: BUDGET(50), pending: untriaged(25) }, async (r) => {
    const { runner, calls } = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r), runner });
    assert.equal(calls.claude.length, 2);
    for (const c of calls.claude) {
      assert.deepEqual(c.args, claudeArgs('sonnet'));
      assert.ok(sentUrls(c.opts.input).size > 0);
    }
  }));

// M-002-S5
test('M-002-S5 with the default budget and 20 rows already in today\'s ledger no fetch and no agent call happens and the digest says the budget is used', () =>
  withRoot({ config: PLUS, pending: untriaged(30) }, async (r) => {
    writeLedger(r, [rowOf('scheduled', 12), rowOf('session', 8)]);
    const before = r.read('data/pipeline.md');
    const { runner, calls } = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r), runner });
    assert.equal(calls.fetch.length, 0);
    assert.equal(calls.claude.length, 0);
    assert.equal(r.read('data/pipeline.md'), before);
    assert.match(r.read(digestFile(r)), /daily triage: budget of 20 rows already used today \(20 sent\); the next run is tomorrow/);
  }));

// M-002-S5
test('M-002-S5 with 12 rows already logged today the run sends only 8 rows', () =>
  withRoot({ config: PLUS, pending: untriaged(30) }, async (r) => {
    writeLedger(r, [rowOf('session', 12)]);
    const { runner, calls } = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r), runner });
    assert.deepEqual(sizes(calls), [8]);
    assert.equal(calls.fetch.length, 8);
    assert.deepEqual(readLedger(r), [rowOf('session', 12), rowOf('scheduled', 8)]);
  }));

// M-002-S5
test('M-002-S5 ledger rows of an earlier date do not reduce today\'s budget', () =>
  withRoot({ config: PLUS, pending: untriaged(30) }, async (r) => {
    writeLedger(r, [rowOf('scheduled', 20, 'ok', '2026-10-26')]);
    const { runner, calls } = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r), runner });
    assert.deepEqual(sizes(calls), [20]);
  }));

// M-002-S6
test('M-002-S6 a daily budget of "all" with 45 untriaged rows sends 3 calls of 20, 20 and 5 rows', () =>
  withRoot({ config: BUDGET('all'), pending: untriaged(45) }, async (r) => {
    const { runner, calls } = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r), runner });
    assert.deepEqual(sizes(calls), [20, 20, 5]);
    assert.equal(triagedCount(r), 45);
    assert.match(r.read(digestFile(r)), /daily triage chunk 3 of 3: triaged 5/);
    assert.match(r.read(digestFile(r)), /the budget of all\); estimate:/);
  }));

// M-002-S8
test('M-002-S8 a second chunk whose claude call exits 1 keeps the first chunk\'s verdicts, names the failure and the rows left, and records 20 ok and 5 failed', () =>
  withRoot({ config: BUDGET(50), pending: untriaged(25) }, async (r) => {
    let n = 0;
    const { runner } = makeRunner(r, { claude: (a, o) => (++n === 2 ? failWith('Authentication required\nsecond line')(a, o) : passAll(a, o)) });
    await dailyTriage({ ...args(r), runner });
    const pending = rowsOf(r.read('data/pipeline.md'), 'Pending');
    assert.equal(pending.filter((x) => x.notes.has('triage')).length, 20);
    for (let i = 21; i <= 25; i++) assert.equal(pending.find((x) => x.url === jobUrl(i)).notes.has('triage'), false, `row ${i} stays untriaged`);
    const digest = r.read(digestFile(r));
    assert.match(digest, /daily triage stopped at chunk 2 of 2: .*Authentication required.*; 5 rows wait for a later day/);
    assert.doesNotMatch(digest, /second line/);
    assert.match(digest, /daily triage: triaged 20, passed 20, ignored 0/);
    assert.deepEqual(readLedger(r), [rowOf('scheduled', 20), rowOf('scheduled', 5, 'failed')]);
  }));

// M-002-S8
test('M-002-S8 a failing first chunk leaves pipeline.md unchanged with the daily triage skipped note and one failed ledger row', () =>
  withRoot({ config: BUDGET(50), pending: untriaged(25) }, async (r) => {
    const before = r.read('data/pipeline.md');
    const { runner, calls } = makeRunner(r, { claude: failWith('Authentication required') });
    await dailyTriage({ ...args(r), runner });
    assert.equal(calls.claude.length, 1);
    assert.equal(r.read('data/pipeline.md'), before);
    assert.match(r.read(digestFile(r)), /daily triage skipped: .*Authentication required/);
    assert.deepEqual(readLedger(r), [rowOf('scheduled', 20, 'failed')]);
  }));

// M-002-S8
test('M-002-S8 a missing claude binary starts no call, so the ledger gets no row', () =>
  withRoot({ config: BUDGET(50), pending: untriaged(3) }, async (r) => {
    const { runner } = makeRunner(r, {
      claude: () => {
        throw Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
      },
    });
    await dailyTriage({ ...args(r), runner });
    assert.deepEqual(readLedger(r), []);
  }));

// M-002-S11
test('M-002-S11 after a run whose chunk failed, a same-day rerun makes no fetch and no agent call and says the daily triage stopped earlier', () =>
  withRoot({ config: BUDGET(50), pending: untriaged(25) }, async (r) => {
    let n = 0;
    const first = makeRunner(r, { claude: (a, o) => (++n === 2 ? failWith('Authentication required')(a, o) : passAll(a, o)) });
    await dailyTriage({ ...args(r), runner: first.runner });
    const before = r.read('data/pipeline.md');
    const second = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r), runner: second.runner });
    assert.equal(second.calls.fetch.length, 0);
    assert.equal(second.calls.claude.length, 0);
    assert.equal(r.read('data/pipeline.md'), before);
    assert.match(r.read(digestFile(r)), /daily triage stopped earlier today after a failure; the next run is tomorrow/);
  }));

// M-002-S11
test('M-002-S11 the next day the failed chunk\'s rows are sent first', () =>
  withRoot({ config: BUDGET(50), pending: untriaged(25) }, async (r) => {
    let n = 0;
    const first = makeRunner(r, { claude: (a, o) => (++n === 2 ? failWith('Authentication required')(a, o) : passAll(a, o)) });
    await dailyTriage({ ...args(r), runner: first.runner });
    const next = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r, { today: '2026-10-28' }), runner: next.runner });
    assert.equal(next.calls.claude.length, 1);
    assert.deepEqual([...sentUrls(next.calls.claude[0].opts.input)].sort(), [21, 22, 23, 24, 25].map(jobUrl).sort());
    assert.equal(triagedCount(r), 25);
  }));

// M-002-S13
test('M-002-S13 when the third agent call starts, the digest holds the progress lines of chunks 1 and 2 and the ledger holds 2 scheduled rows', () =>
  withRoot({ config: BUDGET('all'), pending: untriaged(45) }, async (r) => {
    const seen = [];
    const claude = (a, o) => {
      seen.push({ digest: r.exists(digestFile(r)) ? r.read(digestFile(r)) : '', ledger: readLedger(r) });
      return passAll(a, o);
    };
    const { runner } = makeRunner(r, { claude });
    await dailyTriage({ ...args(r), runner });
    assert.equal(seen.length, 3);
    assert.doesNotMatch(seen[0].digest, /daily triage chunk/);
    assert.deepEqual(seen[0].ledger, []);
    assert.match(seen[1].digest, /daily triage chunk 1 of 3/);
    assert.doesNotMatch(seen[1].digest, /daily triage chunk 2 of 3/);
    assert.deepEqual(seen[1].ledger, [rowOf('scheduled', 20)]);
    assert.match(seen[2].digest, /daily triage chunk 1 of 3/);
    assert.match(seen[2].digest, /daily triage chunk 2 of 3/);
    assert.deepEqual(seen[2].ledger, [rowOf('scheduled', 20), rowOf('scheduled', 20)]);
  }));

// M-002-S15
test('M-002-S15 a failing claude call writes a note naming --setting-sources project and --strict-mcp-config, docs/usage-cost.md and the sign-in hint', () =>
  withRoot({ config: PLUS, pending: untriaged(2) }, async (r) => {
    const { runner } = makeRunner(r, { claude: failWith('Authentication required') });
    await dailyTriage({ ...args(r), runner });
    const digest = r.read(digestFile(r));
    assert.match(digest, /--setting-sources project/);
    assert.match(digest, /--strict-mcp-config/);
    assert.match(digest, /docs\/usage-cost\.md/);
    assert.match(digest, /Authentication required/);
    assert.match(digest, /sign/i);
  }));

// M-002-S16
test('M-002-S16 a daily budget of "all" with 0 untriaged rows makes no fetch and no agent call and writes triaged 0 and a cost line for 0 rows', () =>
  withRoot({ config: BUDGET('all'), pending: [] }, async (r) => {
    const { runner, calls } = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r), runner });
    assert.equal(calls.fetch.length, 0);
    assert.equal(calls.claude.length, 0);
    const digest = r.read(digestFile(r));
    assert.match(digest, /daily triage: triaged 0, passed 0, ignored 0/);
    assert.match(digest, /daily triage cost: 0 rows sent today \(counted against the budget of all\); estimate:/);
  }));

// M-002-S16
test('M-002-S16 a daily budget of "all" with 21 untriaged rows sends 2 calls of 20 and 1 rows', () =>
  withRoot({ config: BUDGET('all'), pending: untriaged(21) }, async (r) => {
    const { runner, calls } = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r), runner });
    assert.deepEqual(sizes(calls), [20, 1]);
  }));

// M-002-S10
test('M-002-S10 a daily budget of 0 writes the daily triage off note and starts no agent', () =>
  withRoot({ config: `${PLUS}limits:\n  triage_daily: 0\n`, pending: untriaged(5) }, async (r) => {
    const { runner, calls } = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r), runner });
    assert.equal(calls.claude.length + calls.codex.length + calls.fetch.length, 0);
    assert.match(r.read(digestFile(r)), /daily triage off/);
  }));

// M-002-S10
test('M-002-S10 automation scheduled-discovery starts nothing and says there is nothing to do', () =>
  withRoot({ config: 'automation: scheduled-discovery\n', pending: untriaged(5) }, async (r) => {
    const said = [];
    const { runner, calls } = makeRunner(r, { claude: passAll });
    await dailyTriage({ ...args(r, { say: (l) => said.push(l) }), runner });
    assert.equal(calls.claude.length + calls.codex.length + calls.fetch.length, 0);
    assert.match(said.join('\n'), /nothing to do/);
    assert.equal(readLedger(r).length, 0);
  }));
