// dailyTriage with lever T2 on: packRoot is a linked copy of the pack whose docs/lever-verdicts.json holds a T2 pass (the
// same file is also put in the student root). The runner is injected; a claude call with --model sonnet is the standard
// tier and any other claude call is the cheap pre-screen. apply-triage.mjs runs for real on the scratch pipeline.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyTriage } from '../../scripts/daily-triage.mjs';
import { packFarm, soloVerdict, writeVerdicts } from '../helpers/lever-harness.mjs';
import { rowsOf, urlsOf } from '../helpers/script-harness.mjs';
import { PLUS, args, jobUrl, makeRunner, makeTriageRoot, sentUrls, untriaged, verdict } from '../helpers/triage-harness.mjs';

const T2_ON = { T2: soloVerdict('pass', 0.01) };
const PRE = { 1: ['PASS', '4.9'], 2: ['PASS', '4.8'], 3: ['MARGINAL', '3.0'], 4: ['MARGINAL', '3.1'], 5: ['FAIL', '1.0'], 6: ['FAIL', '0.5'] };
const STD = { 1: ['PASS', '4.6'], 2: ['PASS', '4.1'], 3: ['FAIL', '1.2'], 4: ['MARGINAL', '3.2'] };
const modelOf = (argv) => argv[argv.indexOf('--model') + 1];
const idOf = (u) => u.split('/').pop();
const lines = (table, input) => [...sentUrls(input)].filter((u) => table[idOf(u)]).map((u) => verdict(table[idOf(u)][0], u, table[idOf(u)][1])).join('\n');
const urls = (...ns) => ns.map(jobUrl).sort();

async function withT2(fn) {
  const r = makeTriageRoot({ config: PLUS, pending: untriaged(6) });
  let farm = null;
  try {
    farm = packFarm(T2_ON);
    writeVerdicts(r.root, T2_ON);
    await fn(r, farm.dir);
  } finally {
    r.cleanup();
    farm?.cleanup();
  }
}
const sentBy = (calls, pick) => [...new Set(calls.claude.filter((c) => pick(modelOf(c.args))).flatMap((c) => [...sentUrls(c.opts.input)]))].sort();

// M-006-S4-osdr
test('M-006-S4-osdr normal: two-step scoring pre-screens every row with the cheap tier and sends only top picks and borderline rows to the standard tier for their final score', () =>
  withT2(async (r, packRoot) => {
    const { runner, calls } = makeRunner(r, { claude: (argv, opts) => (modelOf(argv) === 'sonnet' ? lines(STD, opts.input) : lines(PRE, opts.input)) });
    await dailyTriage({ ...args(r), packRoot, runner });
    const cheap = calls.claude.filter((c) => modelOf(c.args) !== 'sonnet');
    assert.ok(cheap.length > 0, 'a pre-screen call is made');
    for (const c of cheap) assert.doesNotMatch(String(modelOf(c.args)), /sonnet|opus/, 'the pre-screen runs below the standard tier');
    assert.deepEqual(sentBy(calls, (m) => m !== 'sonnet'), urls(1, 2, 3, 4, 5, 6), 'every row is pre-screened');
    assert.deepEqual(sentBy(calls, (m) => m === 'sonnet'), urls(1, 2, 3, 4), 'only PASS and MARGINAL rows go to the standard tier');
    const pipeline = r.read('data/pipeline.md');
    const pend = rowsOf(pipeline, 'Pending');
    const score = (n) => pend.find((x) => x.url === jobUrl(n))?.notes.get('triage');
    assert.deepEqual([score(1), score(2), score(4)], ['4.6', '4.1', '3.2'], 'final scores come from the standard tier');
    assert.deepEqual(urlsOf(pipeline, 'Skipped').sort(), urls(3, 5, 6));
  }));

// M-006-S24-osdr
test('M-006-S24-osdr error: a failed T2 re-check leaves the pre-screen PASS and MARGINAL rows untriaged while its FAIL rows stand', () =>
  withT2(async (r, packRoot) => {
    const { runner } = makeRunner(r, {
      claude: (argv, opts) => {
        if (modelOf(argv) === 'sonnet') throw Object.assign(new Error('Command failed: claude -p'), { status: 1, stderr: 'Authentication required' });
        return lines(PRE, opts.input);
      },
    });
    await dailyTriage({ ...args(r), packRoot, runner });
    const pipeline = r.read('data/pipeline.md');
    const pend = rowsOf(pipeline, 'Pending');
    for (const n of [1, 2, 3, 4]) assert.equal(pend.find((x) => x.url === jobUrl(n))?.notes.has('triage'), false, `row ${n} stays untriaged`);
    assert.deepEqual(urlsOf(pipeline, 'Skipped').sort(), urls(5, 6), 'pre-screen FAIL rows stand');
  }));
