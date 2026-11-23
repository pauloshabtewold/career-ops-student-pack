// M-006 option A: a draft lever passes the invented-facts check on an agent and draft step when its added items are at
// most what the A/A control arm (the control's draft calls once more, judged against the control the same day) adds on
// that step; 0 with no measurement. The campaign runs the A/A arm by default and rejudge re-applies the bars to a stored
// verdict file with zero runner calls. Fake runners and scratch pack copies only: no agent process, browser or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inventedAllowance } from '../../lib/quality-bars.mjs';
import { leverPins } from '../../lib/levers.mjs';
import { inventedCheck, main, missedBar, runCampaign, runRejudge, runSolo, runStacked } from '../../tools/lever-ab.mjs';
import { SMALL_USAGE, agentReply, fakeAgents, packCopy, resolve, sayer, verdictJson, writeVerdicts } from '../helpers/lever-harness.mjs';

const TODAY = '2026-11-23';
const BARS = Object.freeze({ JUDGE_NOT_WORSE_MIN: 0.5555555555555556, INVENTED_FACTS_MAX: 0 });
const metrics = (invented) => ({ JUDGE_NOT_WORSE_MIN: 1, INVENTED_FACTS_MAX: invented });
const step = (judge, gate = 0, pairs = 12) => ({ pairs, judge_added: judge, gate_added: gate, not_worse: pairs });
// A judge that finds the drafts equal but counts one invented fact in the lever draft: an invented-only miss.
const INVENTED_ONLY = '{"verdict":"tie","not_worse":true,"invented_facts":1}';
const inventedOnly = (opts = {}) => fakeAgents({ ...opts, fail: (call, judging) => (judging ? agentReply('claude', INVENTED_ONLY, SMALL_USAGE, 'claude-fake-judge-1') : null) });

async function withCopy(fn) {
  const p = packCopy();
  try {
    await fn(p.dir);
  } finally {
    p.cleanup();
  }
}
const solo = (dir, fake, out, extra = {}) => runSolo({ root: dir, levers: ['T11'], runner: fake.runner, judge: fake.judge, resolve, say: out.say, seed: 'opt-a', today: TODAY, ...extra });
const verdictFile = (dir) => join(dir, 'docs', 'lever-verdicts.json');
const withAa = (dir, perStep) => {
  const data = verdictJson(dir);
  data.aa = { run_date: TODAY, per_step: perStep };
  writeFileSync(verdictFile(dir), `${JSON.stringify(data, null, 2)}\n`);
};

test('option A: lever-added items equal to the step\'s A/A count pass', () => {
  const aa = { 'claude/cover': step(2, 1) };
  assert.equal(inventedAllowance(aa, 'claude/cover'), 3);
  const check = inventedCheck(3, { 'claude/cover': step(1, 2) }, aa);
  assert.equal(check.steps['claude/cover'].allowance, 3, 'the allowance used is stored on the step record');
  assert.equal(missedBar(metrics(3), BARS, {}, check), null);
});

test('option A: one item over the step\'s A/A count fails and names the step', () => {
  const check = inventedCheck(4, { 'claude/cover': step(2, 2) }, { 'claude/cover': step(3) });
  const m = missedBar(metrics(4), BARS, {}, check);
  assert.equal(m?.bar, 'INVENTED_FACTS_MAX');
  assert.deepEqual(m.steps, ['claude/cover 4 over 3']);
});

test('option A: a step with no A/A measurement fails closed at 0', () => {
  assert.equal(inventedAllowance(undefined, 'codex/reply'), 0);
  assert.equal(inventedAllowance({ 'codex/reply': step(5, 0, 0) }, 'codex/reply'), 0, 'an entry with no pairs is no measurement');
  assert.equal(missedBar(metrics(1), BARS, {}, inventedCheck(1, { 'codex/reply': step(1) }, null))?.bar, 'INVENTED_FACTS_MAX');
  assert.equal(missedBar(metrics(0), BARS, {}, inventedCheck(0, { 'codex/reply': step(0) }, null)), null);
  assert.equal(missedBar(metrics(1), BARS, {}, inventedCheck(1, {}, { 'claude/cover': step(9) }))?.bar, 'INVENTED_FACTS_MAX', 'non-draft items keep the plain bar');
});

test('option A: the allowance applies per step, so a total within the sum still fails when one step is over', () => {
  const aa = { 'claude/cover': step(4), 'codex/cover': step(0) };
  const check = inventedCheck(3, { 'claude/cover': step(2), 'codex/cover': step(1) }, aa);
  assert.deepEqual(check.over, ['codex/cover 1 over 0']);
  assert.equal(missedBar(metrics(3), BARS, {}, check)?.bar, 'INVENTED_FACTS_MAX');
});

test('option A solo: with the A/A arm an invented-only lever passes; without it the T11 milder arm still runs and both settings fail', async () => {
  await withCopy(async (dir) => {
    const fake = inventedOnly();
    const out = sayer();
    assert.equal(await solo(dir, fake, out, { aaControl: true }), 0, out.lines.join('\n'));
    const data = verdictJson(dir);
    const v = data.levers.T11;
    assert.equal(v.verdict, 'pass', out.lines.join('\n'));
    assert.ok(data.aa.per_step['claude/cover'].judge_added > 0, JSON.stringify(data.aa.per_step));
    assert.equal(v.per_step_first['claude/cover'].allowance, data.aa.per_step['claude/cover'].judge_added + data.aa.per_step['claude/cover'].gate_added);
    assert.match(data.invented_facts_rule, /^option A/);
  });
  await withCopy(async (dir) => {
    const fake = inventedOnly();
    const out = sayer();
    await solo(dir, fake, out);
    const data = verdictJson(dir);
    const v = data.levers.T11;
    assert.equal(data.aa, undefined);
    assert.equal(v.verdict, 'fail', out.lines.join('\n'));
    assert.match(v.missed_at_first_setting, /INVENTED_FACTS_MAX .*option A per step: claude\/cover \d+ over 0/);
    assert.ok(v.per_step_milder['claude/cover'].pairs > 0, 'the milder arm ran after the invented-only miss');
    assert.equal(v.per_step_milder['claude/cover'].allowance, 0);
    assert.equal(typeof v.first_setting.tokens.after, 'number', 'the first setting is kept for rejudge');
  });
});

test('option A stacked: each round applies the allowance per step from data.aa', async () => {
  const pass = { verdict: 'pass', setting: 60, tokens: { before: 100, after: 80 }, quality: { before: { JUDGE_NOT_WORSE_MIN: 1, INVENTED_FACTS_MAX: 0 }, after: { JUDGE_NOT_WORSE_MIN: 1, INVENTED_FACTS_MAX: 0 } } };
  const run = async (aa) => {
    let result = null;
    await withCopy(async (dir) => {
      writeVerdicts(dir, { T11: pass }, { aa: { per_step: aa } });
      const fake = inventedOnly();
      const out = sayer();
      await runStacked({ root: dir, runner: fake.runner, judge: fake.judge, resolve, say: out.say, seed: 'opt-a', today: TODAY });
      const data = verdictJson(dir);
      result = { data, round: data.stacked.rounds[0], lines: out.lines.join('\n') };
    });
    return result;
  };
  const roomy = await run({ 'claude/cover': step(100), 'codex/cover': step(100) });
  assert.match(roomy.data.stacked.status, /^stacked pass after 1 round/, roomy.lines);
  assert.equal(roomy.round.per_step['codex/cover'].allowance, 100);
  const half = await run({ 'claude/cover': step(100) });
  assert.match(half.round.missed_bar, /INVENTED_FACTS_MAX .*codex\/cover \d+ over 0/, half.lines);
  assert.doesNotMatch(half.round.missed_bar, /claude\/cover/);
});

test('campaign runs the A/A arm by default, in the dry-run plan and the estimate; --no-aa-control skips it; no runner call', async () => {
  await withCopy(async (dir) => {
    const fake = fakeAgents();
    const on = sayer();
    assert.equal(await runCampaign({ root: dir, runner: fake.runner, judge: fake.judge, resolve, say: on.say, seed: 's', today: TODAY, dryRun: true }), 0);
    const off = sayer();
    assert.equal(await main(['campaign', '--dry-run', '--no-aa-control', '--root', dir], { runner: fake.runner, judge: fake.judge, resolve, say: off.say }), 0);
    assert.equal(fake.calls.length, 0);
    const text = on.lines.join('\n');
    assert.match(text, /A\/A control re-run \(cover, outreach, reply; campaign default/);
    assert.match(text, /solo: control arm, the A\/A control re-run and each lever arm/);
    assert.doesNotMatch(off.lines.join('\n'), /A\/A control re-run/);
    const judgeOf = (lines) => Number(/estimate per round \(solo[^)]*\): .*opus judge (\d+) tokens/.exec(lines.join('\n'))?.[1]);
    assert.ok(judgeOf(on.lines) > judgeOf(off.lines), `the estimate (and the 1.5x stop on it) includes the A/A arm: ${judgeOf(on.lines)} vs ${judgeOf(off.lines)}`);
  });
});

test('rejudge makes no runner call and flips an invented-only miss once an A/A measurement allows it; --dry-run writes nothing', async () => {
  await withCopy(async (dir) => {
    const fake = inventedOnly();
    await solo(dir, fake, sayer());
    assert.equal(verdictJson(dir).levers.T11.verdict, 'fail');
    withAa(dir, { 'claude/cover': step(100), 'codex/cover': step(100) });
    const calls = fake.calls.length;
    const before = readFileSync(verdictFile(dir), 'utf8');
    const dry = sayer();
    assert.equal(await main(['rejudge', '--dry-run', '--root', dir], { runner: fake.runner, judge: fake.judge, resolve, say: dry.say }), 0);
    assert.equal(readFileSync(verdictFile(dir), 'utf8'), before, 'dry run writes nothing');
    assert.match(dry.lines.join('\n'), /\| T11 \| fail at 75: .* \| pass at 60 \|/);
    const out = sayer();
    assert.equal(await runRejudge({ root: dir, data: join(dir, 'docs'), say: out.say, today: TODAY }), 0);
    assert.equal(fake.calls.length, calls, 'no runner call');
    const data = verdictJson(dir);
    const v = data.levers.T11;
    assert.equal(v.verdict, 'pass', out.lines.join('\n'));
    assert.equal(v.setting, 60);
    assert.equal(v.missed_bar, null);
    assert.equal(v.per_step_first['claude/cover'].allowance, 100);
    assert.equal(v.bars_sha256, leverPins(dir).barsSha);
    assert.equal(data.rejudged.date, TODAY);
  });
});

test('rejudge keeps a judge miss failing whatever the allowance', async () => {
  await withCopy(async (dir) => {
    const fake = fakeAgents({ missAlways: true });
    await solo(dir, fake, sayer());
    withAa(dir, { 'claude/cover': step(100), 'codex/cover': step(100) });
    const calls = fake.calls.length;
    const out = sayer();
    assert.equal(await runRejudge({ root: dir, say: out.say, today: TODAY }), 0);
    assert.equal(fake.calls.length, calls);
    const v = verdictJson(dir).levers.T11;
    assert.equal(v.verdict, 'fail', out.lines.join('\n'));
    assert.match(v.missed_bar, /^JUDGE_NOT_WORSE_MIN/);
    assert.doesNotMatch(v.missed_bar, /INVENTED_FACTS_MAX/, 'the invented items are within the allowance now');
  });
});

test('rejudge replays the stored stacked rounds: a round that now holds every bar is the final set and its drops come back', async () => {
  await withCopy(async (dir) => {
    const q = { before: { JUDGE_NOT_WORSE_MIN: 1, INVENTED_FACTS_MAX: 0 }, after: { JUDGE_NOT_WORSE_MIN: 1, INVENTED_FACTS_MAX: 0 } };
    const pass = { verdict: 'pass', setting: null, tokens: { before: 100, after: 80 }, quality: q, per_step_first: { 'claude/outreach': step(0) } };
    writeVerdicts(dir, {
      T5: { ...pass, verdict: 'fail', solo_verdict: 'pass', missed_bar: 'dropped in stacked round 1: INVENTED_FACTS_MAX 2 against 0' },
      T11: { ...pass, setting: 60, per_step_first: { 'claude/cover': step(0) } },
    }, {
      aa: { per_step: { 'claude/outreach': step(2) } },
      stacked: {
        status: 'stacked pass after 2 rounds: T11 on together',
        rounds: [
          { round: 1, levers: ['T5', 'T11'], metrics: { JUDGE_NOT_WORSE_MIN: 1, INVENTED_FACTS_MAX: 2 }, per_step: { 'claude/outreach': step(2), 'claude/cover': step(0) } },
          { round: 2, levers: ['T11'], metrics: { JUDGE_NOT_WORSE_MIN: 1, INVENTED_FACTS_MAX: 0 }, per_step: { 'claude/cover': step(0) } },
        ],
        final: ['T11'],
      },
    });
    const out = sayer();
    assert.equal(await runRejudge({ root: dir, say: out.say, today: TODAY }), 0);
    const data = verdictJson(dir);
    assert.equal(data.stacked.status, 'stacked pass after 1 round: T5, T11 on together', out.lines.join('\n'));
    assert.deepEqual(data.stacked.final, ['T5', 'T11']);
    assert.equal(data.stacked.rounds.length, 1);
    assert.equal(data.stacked.rounds[0].per_step['claude/outreach'].allowance, 2);
    assert.equal(data.levers.T5.verdict, 'pass');
    assert.equal(data.levers.T5.solo_verdict, undefined);
  });
});
