import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runParity, defaultStageRunner } from '../../tools/parity.mjs';
import { validateCycle } from '../../lib/cycle-file.mjs';
import { FIXTURE_URL, FIXTURE_COMPANY, FIXTURE_TITLE, PACK_ROOT, CYCLE_JSON, makeSource, makeStudentConfig, makeStudentConfigText, okRunner, tmp, cleanupTmp } from './_source.mjs';

after(cleanupTmp);

const TODAY = '2026-10-27';

function setup({ config } = {}) {
  const source = makeSource();
  const scratch = join(tmp('parity-stage-run-'), 'work');
  const report = join(tmp('parity-stage-report-'), 'report.md');
  const argv = ['--source', source, '--scratch', scratch, '--student-config', config ?? makeStudentConfig(), '--report', report, '--today', TODAY];
  return { source, scratch, report, argv, exits: [], proc: new EventEmitter() };
}

// Runs the harness with a recording runner; handler(call, calls) may return a result or undefined for the ok default.
async function drive(t, handler = () => undefined) {
  const calls = [];
  const runner = async (call) => {
    calls.push(call);
    const custom = await handler(call, calls);
    return custom ?? okRunner(call);
  };
  const code = await runParity(t.argv, { stageRunner: runner, proc: t.proc, exit: (c) => t.exits.push(c) });
  const text = existsSync(t.report) ? readFileSync(t.report, 'utf8') : '';
  return { code, calls, text, lines: text.split('\n') };
}

const result = (stdout, code = 0, stderr = '') => ({ code, status: code, stdout, stderr, output: stdout });
const forStage = (calls, stage, side) => calls.filter((c) => c.stage === stage && c.side === side);
const rowOf = (lines, stage) => lines.find((l) => l.startsWith(`| ${stage} |`)) ?? '';
const ROW_2031 = '- [ ] https://jobs.example.com/openings/s-2031 | Example Co | Software Engineer Intern Summer 2031 | Remote';

// M-004-S1
test('M-004-S1 a baseline stage script under local/ is the path passed to the runner', async () => {
  const r = await drive(setup());
  const baselineCalls = ['cycle', 'prefilter', 'rank-queue', 'fail-audit'].map((s) => forStage(r.calls, s, 'baseline')[0]);
  for (const c of baselineCalls) {
    assert.ok(c, 'baseline call missing');
    assert.equal(c.script, join(c.cwd, 'local', `${c.stage}.mjs`));
  }
  assert.equal(r.code, 0);
});

// M-004-S2
test('M-004-S2 a baseline script found nowhere gives error, no runner call for that side, and exit 1', async () => {
  const r = await drive(setup(), (call) => {
    if (call.stage === 'cycle' && call.side === 'baseline') rmSync(join(call.cwd, 'local', 'fail-audit.mjs'));
  });
  assert.equal(forStage(r.calls, 'fail-audit', 'baseline').length, 0);
  assert.ok(rowOf(r.lines, 'fail-audit').endsWith('| error |'), r.text);
  assert.ok(r.lines.includes('- fail-audit: baseline script missing'), r.text);
  assert.equal(r.code, 1);
});

// M-004-S3
test('M-004-S3 one side exiting nonzero gives error with the exit note and no added row', async () => {
  const r = await drive(setup(), (call) => (call.stage === 'rank-queue' && call.side === 'pack' ? result('[]', 1) : undefined));
  assert.equal(rowOf(r.lines, 'rank-queue'), '| rank-queue | - | - | - | - | - | error |', r.text);
  assert.ok(r.lines.includes('- rank-queue: pack exit 1'), r.text);
  assert.equal(r.code, 1);
});

// M-004-S3
test('M-004-S3 a nonzero baseline exit names the baseline side', async () => {
  const r = await drive(setup(), (call) => (call.stage === 'fail-audit' && call.side === 'baseline' ? result('[]', 2) : undefined));
  assert.equal(rowOf(r.lines, 'fail-audit'), '| fail-audit | - | - | - | - | - | error |', r.text);
  assert.ok(r.lines.includes('- fail-audit: baseline exit 2'), r.text);
  assert.equal(r.code, 1);
});

// M-004-S4
test('M-004-S4 both sides exiting nonzero gives error and not pass', async () => {
  const r = await drive(setup(), (call) => (call.stage === 'fail-audit' ? result('[]', 1) : undefined));
  assert.ok(rowOf(r.lines, 'fail-audit').endsWith('| error |'), r.text);
  assert.ok(!rowOf(r.lines, 'fail-audit').endsWith('| pass |'));
  assert.match(r.text, /- fail-audit: .*exit/);
  assert.equal(r.code, 1);
});

// M-004-S5
test('M-004-S5 pack cycle stdout is written to pack-root data student-cycle.json before pack prefilter runs', async () => {
  let seen = null;
  const r = await drive(setup(), (call) => {
    if (call.stage === 'prefilter' && call.side === 'pack') {
      const file = join(call.cwd, 'data', 'student-cycle.json');
      seen = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    }
  });
  assert.ok(seen, 'student-cycle.json missing at pack prefilter time');
  assert.deepEqual(validateCycle(seen), JSON.parse(CYCLE_JSON));
  assert.equal(r.code, 0);
});

// M-004-S6
test('M-004-S6 a cycle error makes prefilter and apply-triage error with depends on a failed stage', async () => {
  const r = await drive(setup(), (call) => (call.stage === 'cycle' && call.side === 'pack' ? result(CYCLE_JSON, 1) : undefined));
  assert.ok(rowOf(r.lines, 'cycle').endsWith('| error |'), r.text);
  for (const stage of ['prefilter', 'apply-triage']) {
    assert.ok(rowOf(r.lines, stage).endsWith('| error |'), `${stage}\n${r.text}`);
    assert.ok(r.lines.includes(`- ${stage}: depends on a failed stage`), r.text);
    assert.equal(forStage(r.calls, stage, 'pack').length, 0, `${stage} pack call made`);
  }
  assert.equal(r.code, 1);
});

// M-004-S7
test('M-004-S7 real pack cycle and prefilter with the copied fixture flag a Summer 2031 row as term not in cycle', async () => {
  const t = setup();
  writeFileSync(join(t.source, 'data', 'pipeline.md'), `# Pipeline\n\n## Pending\n\n${ROW_2031}\n\n## Flagged\n\n## Skipped\n\n## Processed\n`);
  let prefilterOut = null;
  const r = await drive(t, async (call) => {
    if (call.side === 'pack' && (call.stage === 'cycle' || call.stage === 'prefilter')) {
      const res = await defaultStageRunner(call);
      if (call.stage === 'prefilter') prefilterOut = res.stdout;
      return res;
    }
    return undefined;
  });
  assert.ok(prefilterOut !== null, 'pack prefilter did not run');
  assert.match(prefilterOut, /FAIL/);
  assert.match(prefilterOut, /term not in cycle/);
  assert.ok(r.text.length > 0);
});

// M-004-S8
test('M-004-S8 handshake-import without the TSV is skipped with a warning and exit stays 0', async () => {
  const r = await drive(setup());
  assert.equal(rowOf(r.lines, 'handshake-import'), '| handshake-import | - | - | - | - | - | skipped |', r.text);
  assert.ok(r.lines.includes('Warnings:'));
  assert.ok(r.lines.includes('- handshake-import: no TSV input'), r.text);
  assert.equal(r.code, 0);
});

// M-004-S9
test('M-004-S9 a stage with zero rows on both sides keeps pass and is listed under Warnings', async () => {
  const r = await drive(setup());
  assert.equal(rowOf(r.lines, 'rank-queue'), '| rank-queue | 0 | 0 | 0 | 0 | 0 | pass |', r.text);
  assert.ok(r.lines.includes('- rank-queue: no input rows on either side'), r.text);
  assert.equal(r.code, 0);
});

// M-004-S10
test('M-004-S10 rank-queue and fail-audit receive --n 100000 on both sides', async () => {
  const r = await drive(setup());
  for (const stage of ['rank-queue', 'fail-audit']) {
    for (const side of ['baseline', 'pack']) {
      const c = forStage(r.calls, stage, side)[0];
      assert.ok(c, `${stage} ${side} call missing`);
      const i = c.args.indexOf('--n');
      assert.ok(i >= 0 && c.args[i + 1] === '100000', `${stage} ${side}: ${c.args.join(' ')}`);
    }
  }
});

const VISA_CONFIG = () =>
  makeStudentConfigText('onboarding:\n  complete: true\npresets: [software-cs]\ntracks:\n  - kind: internship\n    graduation: 2029-05\njudgment_keywords: [visa]\n');
const auditRow = (reason) => JSON.stringify([{ url: 'https://jobs.example.com/openings/v-1', company: 'Example Co', title: 'Role', reason }]);

// M-004-S10
test('M-004-S10 a baseline-only reason matching the config judgment_keywords fails the fail-audit stage', async () => {
  const r = await drive(setup({ config: VISA_CONFIG() }), (call) => (call.stage === 'fail-audit' && call.side === 'baseline' ? result(auditRow('Visa sponsorship unavailable')) : undefined));
  assert.ok(rowOf(r.lines, 'fail-audit').endsWith('| fail |'), r.text);
  assert.equal(r.code, 1);
});

// M-004-S10
test('M-004-S10 a baseline-only reason outside the config judgment_keywords is explained', async () => {
  const r = await drive(setup({ config: VISA_CONFIG() }), (call) => (call.stage === 'fail-audit' && call.side === 'baseline' ? result(auditRow('Graduation window too late')) : undefined));
  assert.ok(rowOf(r.lines, 'fail-audit').endsWith('| explained |'), r.text);
  assert.equal(r.code, 0);
});

// M-004-S11
test('M-004-S11 one Pending row moved to Flagged with stats flagged 1 gives merge-staging explained 2', async () => {
  const r = await drive(setup(), (call) => {
    if (call.stage === 'merge-staging' && call.side === 'pack') {
      const file = join(call.cwd, 'data', 'pipeline.md');
      const text = readFileSync(file, 'utf8').split('\n');
      const rowLine = text.find((l) => l.startsWith('- [ ]'));
      const moved = text.filter((l) => l !== rowLine).join('\n').replace('## Flagged\n', `## Flagged\n\n${rowLine}\n`);
      writeFileSync(file, moved);
      return result('{"flagged":1}');
    }
  });
  assert.equal(rowOf(r.lines, 'merge-staging'), '| merge-staging | 1 | 1 | 1 | 1 | 2 | explained |', r.text);
  assert.equal(r.code, 0);
});

// M-004-S15
test('M-004-S15 a report from stage output carrying the URL, company, title and source path holds none of them', async () => {
  const t = setup();
  const leak = `${FIXTURE_URL} ${FIXTURE_COMPANY} ${FIXTURE_TITLE} ${t.source}`;
  const r = await drive(t, async (call) => {
    const ok = await okRunner(call);
    return result(`${ok.stdout}${call.stage === 'rank-queue' || call.stage === 'fail-audit' || call.stage === 'cycle' ? '' : `${leak}\n`}`, 0, leak);
  });
  assert.ok(r.text.length > 0);
  for (const secret of [FIXTURE_URL, FIXTURE_COMPANY, FIXTURE_TITLE, t.source, t.scratch]) {
    assert.ok(!r.text.includes(secret), `report leaked ${secret}`);
  }
});

// M-004-S16
test('M-004-S16 makeStudentConfig copies the shipped fixture', () => {
  const copy = makeStudentConfig();
  assert.equal(readFileSync(copy, 'utf8'), readFileSync(join(PACK_ROOT, 'tests', 'fixtures', 'parity', 'student.yml'), 'utf8'));
});

// M-004-S17
test('M-004-S17 a pack script missing from the pack copy gives error, no pack call, and exit 1', async () => {
  let packDir = null;
  const r = await drive(setup(), (call) => {
    if (call.side === 'pack' && packDir === null) packDir = call.cwd;
    if (call.stage === 'rank-queue' && call.side === 'pack') rmSync(join(packDir, 'student', 'scripts', 'fail-audit.mjs'));
  });
  assert.equal(forStage(r.calls, 'fail-audit', 'pack').length, 0);
  assert.ok(rowOf(r.lines, 'fail-audit').endsWith('| error |'), r.text);
  assert.ok(r.lines.includes('- fail-audit: pack script missing'), r.text);
  assert.equal(r.code, 1);
});

// M-004-S18
test('M-004-S18 non-JSON pack cycle stdout gives malformed pack output and no student-cycle.json', async () => {
  let cycleFileAtRank = null;
  const r = await drive(setup(), (call) => {
    if (call.stage === 'cycle' && call.side === 'pack') return result('not json');
    if (call.stage === 'rank-queue' && call.side === 'pack') cycleFileAtRank = existsSync(join(call.cwd, 'data', 'student-cycle.json'));
  });
  assert.ok(rowOf(r.lines, 'cycle').endsWith('| error |'), r.text);
  assert.ok(r.lines.includes('- cycle: malformed pack output'), r.text);
  assert.equal(cycleFileAtRank, false);
  assert.equal(forStage(r.calls, 'prefilter', 'pack').length, 0);
  assert.ok(r.lines.includes('- prefilter: depends on a failed stage'), r.text);
  assert.ok(r.lines.includes('- apply-triage: depends on a failed stage'), r.text);
  assert.equal(r.code, 1);
});

// M-004-S21
test('M-004-S21 the baseline prefilter call gets --today and finds no harness-written student-cycle.json', async () => {
  let cycleFileSeen = null;
  const r = await drive(setup(), (call) => {
    if (call.stage === 'prefilter' && call.side === 'baseline') cycleFileSeen = existsSync(join(call.cwd, 'data', 'student-cycle.json'));
  });
  const c = forStage(r.calls, 'prefilter', 'baseline')[0];
  assert.ok(c, 'baseline prefilter call missing');
  const i = c.args.indexOf('--today');
  assert.ok(i >= 0 && c.args[i + 1] === TODAY, c.args.join(' '));
  assert.equal(cycleFileSeen, false);
});
