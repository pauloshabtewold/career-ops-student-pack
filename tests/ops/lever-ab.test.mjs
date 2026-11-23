// tools/lever-ab.mjs with root set to a scratch copy of the pack (P0 baseline included) and fake runners that return
// canned usage numbers: no claude, codex or API call is made and every agent path is a fake one. Rulings: metrics, bars and
// base passed to missedBar are keyed by the bar keys of lib/quality-bars.mjs (as noise.json is) and missedBar returns
// nothing when every bar holds; the judge passed to runSolo and runStacked answers calls of the same shape as the runner;
// lever-ab reads templates/headless-brief.md from its root; each stacked round lists its levers under `levers`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { formLeverMetrics, missedBar, resumeLeverMetrics, runSolo, runStacked, soloLoss } from '../../tools/lever-ab.mjs';
import { createMeter } from '../../tools/quality-baseline.mjs';
import { readVerdicts, resolve as resolveLever } from '../../lib/levers.mjs';
import { EFFECTIVE } from '../../lib/quality-bars.mjs';
import {
  FAKE_MODELS,
  GATED,
  HUGE_USAGE,
  P0_MODELS,
  TUNING,
  codeOf,
  fakeAgents,
  findKey,
  leversOn,
  markBrief,
  numbersIn,
  packCopy,
  quotaReply,
  resolve,
  roundsOf,
  sayer,
  soloVerdict,
  verdictJson,
  verdictOf,
  verdictText,
  wordOf,
  writeVerdicts,
} from '../helpers/lever-harness.mjs';

const TODAY = '2026-11-22';
const STATED_BARS = Object.freeze({ OVERLAP_MIN: 0.9, INVENTED_FACTS_MAX: 0, JUDGE_NOT_WORSE_MIN: 0.9, FORM_ACCURACY: 0, CLASSIFY_ACCURACY: 0, REPLY_SORT_ACCURACY: 0, SCAM_FP_MAX: 0.02 });
const BASE_ACC = Object.freeze({ FORM_ACCURACY: 1, CLASSIFY_ACCURACY: 1, REPLY_SORT_ACCURACY: 1 });
const metricsAt = (overlap) => ({ OVERLAP_MIN: overlap, INVENTED_FACTS_MAX: 0, JUDGE_NOT_WORSE_MIN: 0.95, FORM_ACCURACY: 1, CLASSIFY_ACCURACY: 1, REPLY_SORT_ACCURACY: 1, SCAM_FP_MAX: 0 });
const BAR_KEY = /OVERLAP_MIN|INVENTED_FACTS_MAX|JUDGE_NOT_WORSE_MIN|FORM_ACCURACY|CLASSIFY_ACCURACY|REPLY_SORT_ACCURACY|SCAM_FP_MAX/;

async function withCopy(fn) {
  const p = packCopy();
  try {
    await fn(p.dir);
  } finally {
    p.cleanup();
  }
}
const solo = (dir, fake, out, levers, extra = {}) => runSolo({ root: dir, levers, runner: fake.runner, judge: fake.judge, resolve, say: out.say, seed: 'lever-seed', today: TODAY, ...extra });
const stacked = (dir, fake, out) => runStacked({ root: dir, runner: fake.runner, judge: fake.judge, resolve, say: out.say, seed: 'lever-seed', today: TODAY });
const resolvedIn = (dir, id) => resolveLever(id, { verdicts: readVerdicts(dir), overrides: {} }).on;

// M-006-S1-osdr
test('M-006-S1-osdr normal: lever-ab with fake runners writes a pass verdict at 95 percent overlap', () => {
  assert.equal(missedBar(metricsAt(0.95), STATED_BARS, BASE_ACC) ?? null, null, 'overlap 0.95 with every other bar holding misses nothing');
});

// M-006-S7-osdr
test('M-006-S7-osdr error: lever-ab names the lever and missed bar at 85 percent overlap and leaves it off', async () => {
  assert.match(JSON.stringify(missedBar(metricsAt(0.85), STATED_BARS, BASE_ACC)), /OVERLAP_MIN/);
  await withCopy(async (dir) => {
    markBrief(dir);
    const fake = fakeAgents();
    const out = sayer();
    await codeOf(solo(dir, fake, out, ['T10']), out.lines);
    assert.notEqual(wordOf(verdictOf(verdictJson(dir), 'T10')), 'pass', 'a degraded T10 does not pass');
    assert.ok(out.lines.some((l) => l.includes('T10') && BAR_KEY.test(l)), `a line names T10 and its missed bar:\n${out.lines.join('\n')}`);
    assert.equal(resolvedIn(dir, 'T10'), false, 'T10 stays off');
  });
});

// M-006-S10-osdr
test('M-006-S10-osdr normal: with every passing lever on together the stacked run that misses a bar drops the lever costing the most quality and reruns until all bars hold', async () => {
  assert.ok(soloLoss(soloVerdict('pass', 0.15)) > soloLoss(soloVerdict('pass', 0.01)), 'a larger quality drop is a larger solo loss');
  await withCopy(async (dir) => {
    markBrief(dir);
    writeVerdicts(dir, { T10: soloVerdict('pass', 0.15), T11: soloVerdict('pass', 0.01) });
    const fake = fakeAgents();
    const out = sayer();
    await codeOf(stacked(dir, fake, out), out.lines);
    const rounds = roundsOf(verdictJson(dir));
    assert.equal(rounds.length, 2, `two stacked rounds recorded:\n${out.lines.join('\n')}`);
    assert.deepEqual(leversOn(rounds[0]).sort(), ['T10', 'T11']);
    assert.deepEqual(leversOn(rounds[1]), ['T11'], 'T10, the larger solo loss, is dropped');
    assert.doesNotMatch(verdictText(dir), /blocked-on-user/);
  });
});

// M-006-S11-osdr
test('M-006-S11-osdr error: lever-ab exits 3 naming lib/quality-bars.mjs when its sha256 differs from the P0 manifest and runs no arm', async () => {
  await withCopy(async (dir) => {
    appendFileSync(join(dir, 'lib', 'quality-bars.mjs'), '\n// changed after the P0 freeze\n');
    const fake = fakeAgents();
    const out = sayer();
    const code = await codeOf(solo(dir, fake, out, ['jd_trim']), out.lines);
    assert.equal(code, 3);
    assert.ok(out.lines.join('\n').includes('lib/quality-bars.mjs'), out.lines.join('\n'));
    assert.equal(fake.calls.length, 0, 'no arm runs');
  });
});

// M-006-S12-osdr
test('M-006-S12-osdr normal: every lever verdict holds the lever-off control arm metrics measured at the same resolved model ids as its lever arm', async () => {
  await withCopy(async (dir) => {
    const fake = fakeAgents({ models: P0_MODELS });
    const out = sayer();
    await codeOf(solo(dir, fake, out, ['jd_trim']), out.lines);
    const v = verdictOf(verdictJson(dir), 'jd_trim');
    assert.ok(v, `jd_trim has a verdict:\n${out.lines.join('\n')}`);
    const control = findKey(v, /control/i);
    assert.ok(numbersIn(control).length > 0, 'the verdict holds control-arm metrics');
    const base = String(findKey(v, /base/i) ?? '');
    assert.match(base, /p0|baseline/i, 'ids equal to P0: the P0 baseline is the comparison base');
    assert.doesNotMatch(base, /control/i);
    const text = JSON.stringify(v);
    for (const id of [P0_MODELS.claude, P0_MODELS.codex]) assert.ok(text.includes(id), `verdict records ${id}`);
  });
});

// M-006-S13-osdr
test('M-006-S13-osdr edge: when a P5 resolved model id differs from its P0 id the verdict names the control arm as comparison base and lists both id sets', async () => {
  await withCopy(async (dir) => {
    const fake = fakeAgents({ models: FAKE_MODELS });
    const out = sayer();
    await codeOf(solo(dir, fake, out, ['jd_trim']), out.lines);
    const v = verdictOf(verdictJson(dir), 'jd_trim');
    assert.ok(v, `jd_trim has a verdict:\n${out.lines.join('\n')}`);
    assert.match(String(findKey(v, /base/i) ?? ''), /control/i);
    const text = JSON.stringify(v);
    for (const id of [P0_MODELS.claude, P0_MODELS.codex, FAKE_MODELS.claude, FAKE_MODELS.codex]) assert.ok(text.includes(id), `verdict records ${id}`);
  });
});

// M-006-S14-osdr
test('M-006-S14-osdr error: when reported usage passes 1.5 times the printed estimate lever-ab stops before the next arm and exits 5 with a blocked-on-user line', async () => {
  let full = 0;
  await withCopy(async (dir) => {
    const fake = fakeAgents();
    await codeOf(solo(dir, fake, sayer(), ['jd_trim']));
    full = fake.calls.length;
  });
  await withCopy(async (dir) => {
    const fake = fakeAgents({ usage: HUGE_USAGE });
    const out = sayer();
    const code = await codeOf(solo(dir, fake, out, ['jd_trim']), out.lines);
    assert.equal(code, 5);
    assert.match(out.lines.join('\n'), /blocked-on-user \S/);
    assert.ok(fake.calls.length > 0 && fake.calls.length < full, `stopped early: ${fake.calls.length} of ${full} calls`);
  });
});

// M-006-S15-osdr
test('M-006-S15-osdr error: a quota error from the codex or claude runner stops lever-ab with exit 5 and a blocked-on-user line naming the agent', async () => {
  for (const agent of ['codex', 'claude']) {
    await withCopy(async (dir) => {
      const fake = fakeAgents({ fail: (call, judging) => ((call?.agent ?? 'claude') === agent || (judging && agent === 'claude') ? quotaReply(agent) : null) });
      const out = sayer();
      const code = await codeOf(solo(dir, fake, out, ['jd_trim']), out.lines);
      assert.equal(code, 5, agent);
      assert.match(out.lines.join('\n'), new RegExp(`blocked-on-user.*${agent}`, 'i'), agent);
    });
  }
});

// M-006-S16-osdr
test('M-006-S16-osdr edge: after 3 stacked rounds that miss a bar every tuning lever and T3 T6 T7 T8 T14 T16 resolve off and the verdict file says blocked-on-user', async () => {
  await withCopy(async (dir) => {
    writeVerdicts(dir, { T5: soloVerdict('pass', 0.04), T9: soloVerdict('pass', 0.03), T10: soloVerdict('pass', 0.02), T11: soloVerdict('pass', 0.01), T13: soloVerdict('pass', 0) });
    const fake = fakeAgents({ missAlways: true });
    const out = sayer();
    await codeOf(stacked(dir, fake, out), out.lines);
    assert.equal(roundsOf(verdictJson(dir)).length, 3, out.lines.join('\n'));
    assert.match(verdictText(dir), /blocked-on-user/);
    for (const id of [...TUNING, ...GATED]) assert.equal(resolvedIn(dir, id), false, `${id} off`);
    for (const id of ['T1', 'T13', 'T15']) assert.equal(resolvedIn(dir, id), true, `${id} keeps its solo verdict`);
  });
});

// M-006-S17-osdr
test('M-006-S17-osdr normal: lever-ab prints the token estimate per round for Claude and Codex and the Opus judge before any runner call', async () => {
  await withCopy(async (dir) => {
    const out = sayer();
    let before = null;
    const fake = fakeAgents({ onCall: () => (before ??= out.lines.slice()), fail: (call) => quotaReply(call?.agent ?? 'claude') });
    await codeOf(solo(dir, fake, out, ['jd_trim']), out.lines);
    assert.ok(before, 'a runner call was made');
    const printed = before.join('\n');
    assert.match(printed, /estimate/i);
    for (const re of [/claude/i, /codex/i, /opus|judge/i, /\d/]) assert.match(printed, re);
  });
});

// M-006-S19-osdr
test('M-006-S19-osdr normal: the stacked run puts solo-passing judged and form and resume and rule and mechanical levers on together', async () => {
  const passing = ['T11', 'T3', 'T4', 'T16', 'T13', 'T17'];
  await withCopy(async (dir) => {
    writeVerdicts(dir, { ...Object.fromEntries(passing.map((id) => [id, soloVerdict('pass', 0.01)])), T5: soloVerdict('fail', 0.2) });
    const fake = fakeAgents();
    const out = sayer();
    await codeOf(stacked(dir, fake, out), out.lines);
    const first = roundsOf(verdictJson(dir))[0];
    assert.ok(first, out.lines.join('\n'));
    assert.deepEqual(leversOn(first).sort(), [...passing].sort());
  });
});

// M-006-S20-osdr
test('M-006-S20-osdr edge: with no solo-passing lever the stacked run makes no runner call and the status says no stacked run was made', async () => {
  await withCopy(async (dir) => {
    writeVerdicts(dir, { T5: soloVerdict('fail', 0.2), T11: soloVerdict('pending'), T3: soloVerdict('fail', 0.1) });
    const fake = fakeAgents();
    const out = sayer();
    await codeOf(stacked(dir, fake, out), out.lines);
    assert.equal(fake.calls.length, 0);
    assert.match(verdictText(dir), /no stacked run/i);
  });
});

// M-006-S21-osdr
test('M-006-S21-osdr edge: when drops empty the passing set after 2 rounds the status names 2 rounds and never 3', async () => {
  await withCopy(async (dir) => {
    writeVerdicts(dir, { T10: soloVerdict('pass', 0.02), T11: soloVerdict('pass', 0.01) });
    const fake = fakeAgents({ missAlways: true });
    const out = sayer();
    await codeOf(stacked(dir, fake, out), out.lines);
    assert.equal(roundsOf(verdictJson(dir)).length, 2, out.lines.join('\n'));
    const text = verdictText(dir);
    assert.match(text, /\b2 (stacked )?rounds\b/);
    assert.doesNotMatch(text, /\b3 (stacked )?rounds\b/);
  });
});

// M-006-S22-osdr
test('M-006-S22-osdr normal: T3 is judged by the field accuracy of its learned maps on the fixture forms against the base arm', async () => {
  await withCopy(async (dir) => {
    const m = await formLeverMetrics(dir, { FORM_ACCURACY: 1 });
    assert.equal(typeof m?.FORM_ACCURACY, 'number');
    assert.ok(m.FORM_ACCURACY >= 0 && m.FORM_ACCURACY <= 1, `field accuracy ${m.FORM_ACCURACY}`);
  });
  assert.match(JSON.stringify(missedBar({ FORM_ACCURACY: 0.7 }, { FORM_ACCURACY: 0 }, { FORM_ACCURACY: 0.8 })), /FORM_ACCURACY/, 'below the base arm misses');
  assert.equal(missedBar({ FORM_ACCURACY: 0.8 }, { FORM_ACCURACY: 0 }, { FORM_ACCURACY: 0.8 }) ?? null, null, 'equal to the base arm holds');
});

// M-006-S23-osdr
test('M-006-S23-osdr error: a T4 reused resume that fails the ATS check misses the bar at the tested similarity threshold', async () => {
  await withCopy(async (dir) => {
    const run = async (atsCheck) => {
      const fake = fakeAgents();
      const metrics = await resumeLeverMetrics({ root: dir, threshold: 0.85, agents: { claude: resolve('claude'), codex: resolve('codex') }, runner: fake.runner, meter: createMeter(1e12), models: { claude: FAKE_MODELS.claude, codex: FAKE_MODELS.codex }, judge: fake.judge, seed: 's23-seed', atsCheck });
      return JSON.stringify(missedBar(metrics, EFFECTIVE, {}) ?? null);
    };
    assert.match(await run(() => ['missing section heading: Experience']), /ats/i, 'a reused resume failing the ATS check misses the T4 bar');
    assert.doesNotMatch(await run(() => []), /ats/i, 'a clean ATS check misses no ATS bar');
  });
});
