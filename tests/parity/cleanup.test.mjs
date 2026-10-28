import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runParity, installCleanup } from '../../tools/parity.mjs';
import { FIXTURE_URL, FIXTURE_COMPANY, FIXTURE_TITLE, okRunner, makeSource, makeStudentConfig, snapshot, tmp, cleanupTmp } from './_source.mjs';

after(cleanupTmp);

function setup() {
  const source = makeSource();
  const base = tmp('parity-run-');
  const scratch = join(base, 'work');
  const reportDir = tmp('parity-report-');
  const report = join(reportDir, 'report.md');
  const argv = ['--source', source, '--scratch', scratch, '--student-config', makeStudentConfig(), '--report', report, '--today', '2026-10-27'];
  const exits = [];
  const exit = (code) => { exits.push(code); };
  return { source, scratch, report, argv, exits, exit, proc: new EventEmitter() };
}

async function settle(promiseLike) {
  try {
    return { value: await promiseLike };
  } catch (error) {
    return { error };
  }
}

// M-007-S5
test('M-007-S5 a successful run removes the scratch dir and returns 0', async () => {
  const t = setup();
  const before = snapshot(t.source);
  const res = await settle(runParity(t.argv, { stageRunner: okRunner, proc: t.proc, exit: t.exit }));
  assert.equal(res.error, undefined);
  assert.equal(res.value, 0);
  assert.ok(!existsSync(t.scratch));
  assert.deepEqual(snapshot(t.source), before);
});

// M-007-S5
test('M-007-S5 signal handlers are removed or inert after a successful run', async () => {
  const t = setup();
  await runParity(t.argv, { stageRunner: okRunner, proc: t.proc, exit: t.exit });
  t.proc.emit('SIGINT');
  assert.ok(!existsSync(t.scratch));
});

// M-007-S6
test('M-007-S6 the written report holds no URL, company, title or path from the input data', async () => {
  const t = setup();
  await runParity(t.argv, { stageRunner: okRunner, proc: t.proc, exit: t.exit });
  assert.ok(existsSync(t.report), 'report was not written');
  const text = readFileSync(t.report, 'utf8');
  assert.ok(text.length > 0);
  for (const secret of [FIXTURE_URL, FIXTURE_COMPANY, FIXTURE_TITLE, 'example.com', t.source, t.scratch, join(t.scratch, '..')]) {
    assert.ok(!text.includes(secret), `report leaked ${secret}`);
  }
  assert.ok(!/https?:\/\//.test(text));
  assert.match(text, /pass/);
});

// M-007-S7
test('M-007-S7 a throwing stage removes the scratch dir and ends nonzero', async () => {
  const t = setup();
  const boom = async () => { throw new Error('stage exploded'); };
  const res = await settle(runParity(t.argv, { stageRunner: boom, proc: t.proc, exit: t.exit }));
  const nonzero = res.error !== undefined || (typeof res.value === 'number' && res.value !== 0) || t.exits.some((c) => c !== 0);
  assert.ok(nonzero, 'a throwing stage must not look like success');
  assert.ok(!existsSync(t.scratch));
});

// M-007-S7
test('M-007-S7 SIGINT mid-run removes scratch and calls exit(130)', async () => {
  const t = setup();
  let sawScratch = false;
  const runner = async () => {
    sawScratch = existsSync(t.scratch);
    t.proc.emit('SIGINT');
    return { code: 0, status: 0, stdout: '', stderr: '', output: '' };
  };
  await settle(runParity(t.argv, { stageRunner: runner, proc: t.proc, exit: t.exit }));
  assert.ok(sawScratch, 'scratch should exist while a stage runs');
  assert.ok(t.exits.includes(130), `exit calls: ${t.exits}`);
  assert.ok(!existsSync(t.scratch));
});

// M-007-S7
test('M-007-S7 SIGTERM mid-run removes scratch and calls exit(143)', async () => {
  const t = setup();
  const runner = async () => {
    t.proc.emit('SIGTERM');
    return { code: 0, status: 0, stdout: '', stderr: '', output: '' };
  };
  await settle(runParity(t.argv, { stageRunner: runner, proc: t.proc, exit: t.exit }));
  assert.ok(t.exits.includes(143), `exit calls: ${t.exits}`);
  assert.ok(!existsSync(t.scratch));
});

// M-007-S7
test('M-007-S7 installCleanup removes only the given scratch on SIGINT, SIGTERM and uncaughtException', () => {
  const cases = [['SIGINT', 130], ['SIGTERM', 143], ['uncaughtException', 1]];
  for (const [event, code] of cases) {
    const scratch = tmp('parity-cleanup-');
    const bystander = tmp('parity-bystander-');
    const proc = new EventEmitter();
    const exits = [];
    installCleanup(scratch, proc, (c) => exits.push(c));
    proc.emit(event, new Error('boom'));
    assert.deepEqual(exits, [code], event);
    assert.ok(!existsSync(scratch), event);
    assert.ok(existsSync(bystander), event);
  }
});

// M-007-S7
test('M-007-S7 signal handlers fire once only', () => {
  const scratch = tmp('parity-once-');
  const proc = new EventEmitter();
  const exits = [];
  installCleanup(scratch, proc, (c) => exits.push(c));
  proc.emit('SIGINT');
  proc.emit('SIGINT');
  assert.deepEqual(exits, [130]);
});

// M-004-S14
test('M-004-S14 installCleanup kills children while scratch exists, then removes scratch, then exits', () => {
  const cases = [['SIGINT', 130], ['SIGTERM', 143], ['uncaughtException', 1]];
  for (const [event, code] of cases) {
    const scratch = tmp('parity-order-');
    const proc = new EventEmitter();
    const log = [];
    installCleanup(scratch, proc, (c) => log.push(`exit:${c}:${existsSync(scratch)}`), () => log.push(`kill:${existsSync(scratch)}`));
    proc.emit(event, new Error('boom'));
    assert.deepEqual(log, ['kill:true', `exit:${code}:false`], event);
  }
});

// M-004-S19
test('M-004-S19 a throwing stage prints one fixed stderr line without the path or URL and returns 1', async (t) => {
  const tt = setup();
  const secretPath = join(tt.scratch, 'baseline', 'data', 'secret-rows.md');
  const secretUrl = 'https://jobs.example.test/openings/secret-77';
  const lines = [];
  t.mock.method(console, 'error', (...a) => lines.push(a.join(' ')));
  const runner = async () => {
    throw new TypeError(`cannot read ${secretPath} for ${secretUrl}`);
  };
  const code = await runParity(tt.argv, { stageRunner: runner, proc: tt.proc, exit: tt.exit });
  assert.equal(code, 1);
  assert.deepEqual(lines, ['parity run failed (TypeError); scratch copy removed']);
  assert.ok(!lines.join('\n').includes(secretPath));
  assert.ok(!lines.join('\n').includes(secretUrl));
  assert.ok(!existsSync(tt.scratch));
});
