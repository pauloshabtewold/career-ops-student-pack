// Covers M-002-S7..S10: compareFailAudit with audit options and runParity honoring audit.exclude_reasons.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compareFailAudit } from '../../tools/parity-compare.mjs';
import { runParity } from '../../tools/parity.mjs';
import { makeSource, makeStudentConfigText, okRunner, tmp, cleanupTmp } from './_source.mjs';

after(cleanupTmp);

const failRow = (n, reason) => ({ url: `https://jobs.example.com/openings/f-${n}`, company: `Fail Co ${n}`, title: `Role ${n}`, reason });

// M-002-S7
test('M-002-S7 excludeReasons explains a baseline-only row matching a keyword and an exclusion pattern', () => {
  const baseline = JSON.stringify([failRow(1, 'Graduation window held by Manual Hold')]);
  const withKnob = compareFailAudit('fail-audit', baseline, '[]', { keywords: ['grad'], excludeReasons: ['manual hold'] });
  assert.equal(withKnob.missing, 1);
  assert.equal(withKnob.explained, 1);
  assert.equal(withKnob.verdict, 'explained');
  const without = compareFailAudit('fail-audit', baseline, '[]', { keywords: ['grad'] });
  assert.equal(without.explained, 0);
  assert.equal(without.verdict, 'fail');
});

// M-002-S8
test('M-002-S8 keywordMatch substring leaves undergrad only residual and word mode explains it', () => {
  const baseline = JSON.stringify([failRow(1, 'undergrad only')]);
  const sub = compareFailAudit('fail-audit', baseline, '[]', { keywords: ['grad'], keywordMatch: 'substring' });
  assert.equal(sub.explained, 0);
  assert.equal(sub.verdict, 'fail');
  const word = compareFailAudit('fail-audit', baseline, '[]', { keywords: ['grad'], keywordMatch: 'word' });
  assert.equal(word.explained, 1);
  assert.equal(word.verdict, 'explained');
});

// M-002-S10
test('M-002-S10 compareFailAudit with only keywords keeps the earlier counts and verdicts', () => {
  const keywords = ['grad', 'term'];
  const common = failRow(1, 'Graduation window too late');
  const baseline = JSON.stringify([common, failRow(2, 'Compensation is fine'), failRow(3, 'Title pre-filter: sales')]);
  const pack = JSON.stringify([common, failRow(4, 'title pre-filter: recruiter')]);
  const r = compareFailAudit('fail-audit', baseline, pack, { keywords });
  assert.equal(r.added, 1);
  assert.equal(r.missing, 2);
  assert.equal(r.explained, 3);
  assert.equal(r.verdict, 'explained');
  const f = compareFailAudit('fail-audit', JSON.stringify([failRow(1, 'Graduation window too late')]), '[]', { keywords });
  assert.equal(f.missing, 1);
  assert.equal(f.explained, 0);
  assert.equal(f.verdict, 'fail');
});

const TODAY = '2026-10-27';
const CONFIG_BASE = 'onboarding:\n  complete: true\npresets: [software-cs]\ntracks:\n  - kind: internship\n    graduation: 2029-05\njudgment_keywords: [visa]\n';
const baselineRow = JSON.stringify([{ url: 'https://jobs.example.com/openings/v-1', company: 'Globex', title: 'Role', reason: 'Visa waiver unavailable' }]);

async function runWith(configText) {
  const source = makeSource();
  const scratch = join(tmp('parity-audit-run-'), 'work');
  const report = join(tmp('parity-audit-report-'), 'report.md');
  const argv = ['--source', source, '--scratch', scratch, '--student-config', makeStudentConfigText(configText), '--report', report, '--today', TODAY];
  const exits = [];
  const runner = async (call) => {
    if (call.stage === 'fail-audit') {
      const stdout = call.side === 'baseline' ? baselineRow : '[]';
      return { code: 0, status: 0, stdout, stderr: '', output: stdout };
    }
    return okRunner(call);
  };
  const code = await runParity(argv, { stageRunner: runner, proc: new EventEmitter(), exit: (c) => exits.push(c) });
  const text = existsSync(report) ? readFileSync(report, 'utf8') : '';
  return { code, text, row: text.split('\n').find((l) => l.startsWith('| fail-audit |')) ?? '' };
}

// M-002-S9
test('M-002-S9 runParity with audit.exclude_reasons explains the baseline-only row and exits 0', async () => {
  const r = await runWith(`${CONFIG_BASE}audit:\n  exclude_reasons:\n    - visa waiver\n`);
  assert.ok(r.row.endsWith('| explained |'), r.text);
  assert.equal(r.code, 0);
});

// M-002-S9
test('M-002-S9 runParity without the knob fails fail-audit and exits 1', async () => {
  const r = await runWith(CONFIG_BASE);
  assert.ok(r.row.endsWith('| fail |'), r.text);
  assert.equal(r.code, 1);
});
