// M-006 carry-overs: invented feelings in the A/B quality metric (probes; lib/fact-gate.mjs unchanged), the outcome-mail
// search terms against the pack's own fixtures, the r4 autopilot and digest wording NITs, the quota wordings of the real
// runners, unmeasured usage, and the off paths of the new product levers. No agent process, browser or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check as factCheck } from '../../lib/fact-gate.mjs';
import { footerLines } from '../../lib/digest.mjs';
import { applyPromptLevers, bulkEffort } from '../../lib/headless.mjs';
import { trimJobText } from '../../lib/jd-trim.mjs';
import { OUTCOME_QUERY, planWait } from '../../scripts/autopilot.mjs';
import { t5Opener } from '../../scripts/outreach-drafts.mjs';
import { QUOTA_RE, readReply, unsupportedFeelings } from '../../tools/lever-ab.mjs';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const CV = '# Sam Example\n\n## Experience\n- Built a scheduling tool for a campus club in Python.\n- Enjoyed mentoring new members of the robotics club.\n';
const OFF = { verdicts: null, overrides: {} };
const ON = (id, setting = null) => ({ verdicts: { levers: { [id]: { verdict: 'pass', setting } } }, overrides: {} });

test('probe: an invented feeling the resume does not state counts as unsupported in the A/B metric', () => {
  assert.deepEqual(unsupportedFeelings('I enjoyed finding a practical way to save people time.', { cv: CV }), ['I enjoyed finding a practical way to save people time.']);
  assert.equal(unsupportedFeelings('What I enjoyed most was cleaning the survey data.', { cv: CV }).length, 1);
  // The fact gate checks facts (names, numbers, tools); feelings are counted by the A/B metric, so the gate stays as it is.
  assert.deepEqual(factCheck('I enjoyed finding a practical way to save people time.', { cv: CV }), []);
});

test('probe: a wish or a feeling the resume states is not counted', () => {
  assert.deepEqual(unsupportedFeelings('I would love to hear how you got started there.', { cv: CV }), []);
  assert.deepEqual(unsupportedFeelings("I'd enjoy a short chat about your team.", { cv: CV }), []);
  assert.deepEqual(unsupportedFeelings('I enjoyed mentoring new members of the robotics club.', { cv: CV }), []);
});

test('the outcome query reaches every labeled outcome fixture mail and still negates nothing', () => {
  const terms = [...OUTCOME_QUERY.matchAll(/"([^"]+)"|\b([a-z]+)\b/gi)].map((m) => (m[1] ?? m[2]).toLowerCase()).filter((t) => !['newer_than', 'or', 'd'].includes(t));
  assert.ok(!/(^|\s)-["\w]/.test(OUTCOME_QUERY), OUTCOME_QUERY);
  const mails = JSON.parse(readFileSync(join(PACK_ROOT, 'tests', 'fixtures', 'quality', 'outcome-mails.json'), 'utf8'));
  for (const [i, m] of mails.entries()) {
    if (m.label === 'other') continue;
    const text = `${m.subject} ${m.text}`.toLowerCase();
    assert.ok(terms.some((t) => new RegExp(`\\b${t}\\b`).test(text)), `fixture ${i + 1} (${m.label}) matches a query term`);
  }
});

test('N-r4-1: the held-items footer no longer says no form was read', () => {
  const why = footerLines({ fillWaiting: 2 }).find((l) => l.startsWith('Why:'));
  assert.match(why, /filled completely/);
  assert.doesNotMatch(why, /no form was read/);
  assert.match(why, /I'll fill each form first, approve\?$/);
});

test('N-r4-4: a field label with page line breaks stays on one waiting line', () => {
  const line = planWait({ fields: [{ id: 'a' }], blocked: ['Social\nSecurity\n  number'] });
  assert.equal(line, 'waits for you: fields only you fill (Social Security number)');
});

test('quota and rate-limit wordings of claude and codex stop the A/B; a reply without usage stays unmeasured', () => {
  for (const text of ['Claude AI usage limit reached', 'rate_limit_error', 'API Error: 429', 'You exceeded your current quota', 'Rate limit reached for gpt', 'overloaded_error: Overloaded']) assert.match(text, QUOTA_RE, text);
  assert.doesNotMatch('the posting says you will rate our limited edition', QUOTA_RE);
  assert.equal(readReply('claude', { status: 0, text: 'ok' }).usage, null);
});

test('levers off: prompts, effort, job text and outreach openers are exactly the v0.11.0 ones', () => {
  assert.equal(applyPromptLevers({ prompt: 'TASK\n\ndata', instructions: 'TASK', wordLimit: 90, levers: OFF }), 'TASK\n\ndata');
  assert.equal(bulkEffort('codex', true, 'medium', OFF), 'medium');
  assert.equal(t5Opener({ action: 'warm-opener', contact: { company: 'Example Co', role: 'Software Engineer' } }, false), '');
});

test('levers on: T10 swaps the instructions, T11 adds its tested limit, T12 lowers codex bulk effort, T5 opens with the base', () => {
  const lean = applyPromptLevers({ prompt: 'TASK\n\ndata', instructions: 'TASK', levers: ON('T10') });
  assert.ok(lean.startsWith('You are doing one step') && lean.endsWith('data') && !lean.includes('TASK'));
  assert.match(applyPromptLevers({ prompt: 'p', wordLimit: 90, levers: ON('T11', 60) }), /at most 60 words/);
  assert.equal(bulkEffort('codex', true, 'medium', ON('T12')), 'low');
  assert.equal(t5Opener({ action: 'warm-opener', contact: { company: 'Example Co', role: 'Software Engineer' } }, true), 'I am interested in the work your team does at Example Co and would like to hear how you got started there.');
  assert.equal(t5Opener({ action: 'warm-opener', contact: { company: 'Example Co', role: '' } }, true), '', 'unknown contact type keeps the off path');
});

test('jd_trim keeps the requirement and location sections and falls back to the first characters', () => {
  const text = 'About us\nWe make robots.\nRequirements\nPython and SQL coursework.\nLocation\nRemote, US.\nPerks\nSnacks.';
  assert.equal(trimJobText(text), 'Requirements\nPython and SQL coursework.\nLocation\nRemote, US.');
  assert.equal(trimJobText('no headings here at all', { fallbackChars: 9 }), 'no headin');
});

// Fix round 1 (review r1): judge noise, vacuous arms, stacked gating, stop wordings, strict judge, loss ranking.
test('M1: base noise the lever does not add is not counted; the lever draft\'s extra invented facts are', async () => {
  const { parseJudge } = await import('../../tools/lever-ab.mjs');
  assert.equal(parseJudge('{"verdict":"tie","invented_1":1,"invented_2":1}', true).added, 0);
  assert.equal(parseJudge('{"verdict":"2","invented_1":3,"invented_2":1}', true).added, 2);
  assert.equal(parseJudge('{"verdict":"1","invented_1":0,"invented_2":2}', true).notWorse, true);
});

test('S2: the real judge must answer 1, 2 or tie with numeric counts; not_worse is read only from an injected test judge', async () => {
  const { parseJudge } = await import('../../tools/lever-ab.mjs');
  assert.equal(parseJudge('{"verdict":"2","not_worse":true,"invented_1":0,"invented_2":0}', true).notWorse, false);
  assert.equal(parseJudge('{"verdict":"lever","invented_1":0,"invented_2":0}', true).word, 'unreadable');
  assert.equal(parseJudge('{"verdict":"tie"}', true).notWorse, false, 'missing counts read as unreadable');
  assert.equal(parseJudge('{"verdict":"tie","not_worse":true,"invented_facts":0}', true, { lenient: true }).notWorse, true);
});

test('M2: an arm that measured nothing is never a pass', async () => {
  const { vacuous } = await import('../../tools/lever-ab.mjs');
  assert.match(vacuous({ arm: { calls: 4 }, metrics: {}, needAgents: ['codex'], agents: { claude: '/x' } }), /codex not found/);
  assert.match(vacuous({ arm: { calls: 0 }, metrics: {} }), /no call/);
  assert.match(vacuous({ arm: { calls: 3 }, metrics: { OVERLAP_MIN: 1 }, required: ['OVERLAP_MIN', 'SCAM_FP_MAX'] }), /SCAM_FP_MAX/);
  assert.match(vacuous({ arm: { calls: 3 }, metrics: { JUDGE_NOT_WORSE_MIN: 1, INVENTED_FACTS_MAX: 0 }, required: [], missing: ['claude/a/cover-1'] }), /no base output/);
  assert.equal(vacuous({ arm: { calls: 3 }, metrics: { OVERLAP_MIN: 1, SCAM_FP_MAX: 0 }, required: ['OVERLAP_MIN', 'SCAM_FP_MAX'] }), null);
});

test('M3: a lever-ab verdict file turns a solo pass on only after a completed stacked pass that includes it', async () => {
  const { resolve } = await import('../../lib/levers.mjs');
  const pins = { bars_sha256: 'b'.repeat(64), sample_hash: 's'.repeat(64) };
  const levers = { T5: { verdict: 'pass', ...pins }, T11: { verdict: 'pass', ...pins }, T13: { verdict: 'pass' } };
  const at = (stacked) => ({ verdicts: { levers, stacked }, overrides: {} });
  for (const status of ['pending: solo verdicts changed; run stacked', 'running: stacked round 2', 'blocked-on-user: claude reported a quota, limit or rate-limit error']) assert.equal(resolve('T5', at({ status, final: ['T5'] })).on, false, status);
  assert.equal(resolve('T5', at({ status: 'stacked pass after 1 round: T5 on together', final: ['T5'] })).on, true);
  assert.equal(resolve('T11', at({ status: 'stacked pass after 1 round: T5 on together', final: ['T5'] })).on, false, 'not in the final set');
  assert.equal(resolve('T13', at({ status: 'running', final: [] })).on, true, 'plumbing keeps its solo verdict');
});

test('S1: limit, quota and sign-in wordings and a non-zero exit code all stop the A/B', async () => {
  const { SIGN_IN_RE } = await import('../../tools/lever-ab.mjs');
  for (const text of ['5-hour limit reached', 'weekly limit reached', 'Session limit reached', "You've hit your limit", 'usage_limit_reached']) assert.match(text, QUOTA_RE, text);
  assert.match('Authentication required', SIGN_IN_RE);
  assert.match(readReply('codex', { exitCode: 1, stdout: '', text: '' }).error, /exited 1|codex/);
  assert.notEqual(readReply('claude', { code: 2, text: 'x' }).error, null);
});

test('M7: soloLoss ranks a larger drop above a smaller one and a gain lowest; bulkEffort lowers only with T12 on', async () => {
  const { soloLoss } = await import('../../tools/lever-ab.mjs');
  const q = (before, after) => ({ quality: { before: { OVERLAP_MIN: before }, after: { OVERLAP_MIN: after } } });
  assert.ok(soloLoss(q(1, 0.8)) > soloLoss(q(1, 0.95)));
  assert.ok(soloLoss(q(0.9, 0.95)) < soloLoss(q(1, 1)), 'a gain ranks below no change');
  assert.equal(bulkEffort({ agent: 'codex', bulk: true, effort: 'medium', verdicts: { levers: { T12: { verdict: 'pass' } } } }), 'low');
  assert.equal(bulkEffort({ agent: 'codex', bulk: true, effort: 'medium', verdicts: null }), 'medium');
  assert.equal(bulkEffort({ agent: 'claude', bulk: true, effort: 'medium', verdicts: { levers: { T12: { verdict: 'pass' } } } }), 'medium');
});

test('T2 shares one re-check with the A/B; a premium pre-screen stays at the standard tier', async () => {
  const { mergeRecheck, recheckUrls, tierFor } = await import('../../scripts/daily-triage.mjs');
  const lines = ['TRIAGE: PASS | https://example.com/jobs/1 | 4.9 | fits', 'TRIAGE: FAIL | https://example.com/jobs/2 | 1.0 | no', 'TRIAGE: MARGINAL | https://example.com/jobs/3 | 3.0 | maybe'];
  assert.deepEqual([...recheckUrls(lines)], ['https://example.com/jobs/1', 'https://example.com/jobs/3']);
  assert.deepEqual(mergeRecheck(lines, new Map([['https://example.com/jobs/1', 'TRIAGE: PASS | https://example.com/jobs/1 | 4.5 | fits']])), ['TRIAGE: PASS | https://example.com/jobs/1 | 4.5 | fits', lines[1]]);
  assert.equal(tierFor({ spend_tier: 'premium' }, 'prescreen').model, 'sonnet');
  assert.equal(tierFor({ spend_tier: 'premium' }).model, 'opus');
});

test('T5 reads the contact role from contacts.tsv; the outreach verifier keeps a fresh round tag per round (no T10 day tag)', async () => {
  const mod = await import('../../scripts/outreach-drafts.mjs');
  assert.equal(mod.contactRoles([{ name: 'Ana Example', company: 'Example Co', role: 'Technical Recruiter' }]).get('ana example|example co'), 'Technical Recruiter');
  assert.equal(mod.roundTagFor, undefined, 'no per-day round tag');
  assert.doesNotMatch(readFileSync(join(PACK_ROOT, 'scripts', 'outreach-drafts.mjs'), 'utf8'), /outreach-round-tag/);
});

// Fix round 2 (review r2): plumbing trials, A/A noise and per-step counts, T12 off the final score, holdout shapes,
// stacked reuse, stale verdicts, the committed verdict file.
const fix2 = async () => {
  const lab = await import('../../tools/lever-ab.mjs');
  const h = await import('../helpers/lever-harness.mjs');
  return { ...lab, h };
};
const withPack = async (fn) => {
  const { h } = await fix2();
  const p = h.packCopy();
  try {
    await fn(p.dir, h);
  } finally {
    p.cleanup();
  }
};

test('R2-M1: T1, T13 and T15 get measured plumbing verdicts with zero runner calls; economy_tier and T12 are a fail, not wired', async () => {
  const { runSolo } = await fix2();
  await withPack(async (dir, h) => {
    const fake = h.fakeAgents();
    const out = h.sayer();
    const ids = ['T1', 'T13', 'T15', 'economy_tier', 'T12'];
    const code = await runSolo({ root: dir, levers: ids, runner: fake.runner, judge: fake.judge, resolve: h.resolve, say: out.say, seed: 's', today: '2026-11-22' });
    assert.equal(code, 0, out.lines.join('\n'));
    assert.equal(fake.calls.length, 0, 'no runner call');
    const data = h.verdictJson(dir);
    for (const id of ['T1', 'T13', 'T15']) {
      const v = data.levers[id];
      assert.equal(v.verdict, 'pass', `${id}: ${JSON.stringify(v)}`);
      assert.ok(Number.isFinite(v.tokens.before) && Number.isFinite(v.tokens.after) && v.tokens.after < v.tokens.before, `${id} saves tokens: ${JSON.stringify(v.tokens)}`);
      assert.equal(v.quality.after.PLUMBING_EQUAL, 1);
      assert.equal(v.quality.before.PLUMBING_EQUAL, 1);
    }
    assert.ok(data.levers.T1.tokens.per_agent.claude && data.levers.T13.tokens.per_agent.codex, 'priced per agent at P0 triage tokens per row');
    for (const id of ['economy_tier', 'T12']) {
      const v = data.levers[id];
      assert.equal(v.verdict, 'fail');
      assert.match(v.basis, /not measured: not wired/);
      assert.deepEqual([v.tokens.before, v.tokens.after], [0, 0]);
      assert.deepEqual(v.quality, { before: 'not wired', after: 'not wired' });
    }
  });
});

test('R2-M1: a plumbing trial whose output changes fails to the off path', async () => {
  const { missedBar, EXTRA_BARS } = await fix2();
  assert.match(JSON.stringify(missedBar({ PLUMBING_EQUAL: 0.98 }, EXTRA_BARS)), /PLUMBING_EQUAL/);
  assert.equal(missedBar({ PLUMBING_EQUAL: 1 }, EXTRA_BARS), null);
  const { resolve } = await import('../../lib/levers.mjs');
  assert.equal(resolve('T13', { verdicts: { levers: { T13: { verdict: 'fail' } }, stacked: { status: 'running', final: [] } }, overrides: {} }).on, false);
});

test('R2-M1: the token report shows the plumbing savings and a T1 triage row', async () => {
  const { writeReport } = await fix2();
  await withPack(async (dir, h) => {
    h.writeVerdicts(dir, { T1: { verdict: 'pass', tokens: { before: 900, after: 500, per_agent: { claude: { before: 1000, after: 600 }, codex: { before: 800, after: 400 } }, unit: 'P0 triage tokens per row' } }, T15: { verdict: 'pass', tokens: { before: 70, after: 20, unit: 'session tokens (characters parsed / 4)' } } }, { stacked: { status: 'pending', rounds: [], final: [] } });
    const md = await writeReport({ root: dir });
    assert.match(md, /\| M1 \| triage of unchanged postings \| 1000 \| 600 \| 800 \| 400 \|.*T1 pass \|/);
    assert.match(md, /\| setup \| setup \| 70 \| 20 \| 70 \| 20 \|.*no AI cost of its own/);
    assert.match(md, /\| triage \| claude \| \d+ \| [^|]+ \| T1, T13, T2, jd_trim, batch_size \|/);
  });
});

test('R2-M2: the free A/A noise of the P0 baseline per draft step, and per-step added counts from judged pairs', async () => {
  const { aaNoise, perStepCounts } = await fix2();
  const noise = aaNoise(PACK_ROOT);
  for (const k of ['claude/cover', 'claude/outreach', 'claude/reply', 'codex/cover', 'codex/outreach', 'codex/reply']) {
    assert.ok(noise[k]?.pairs > 0, `${k}: ${JSON.stringify(noise[k])}`);
    assert.equal(typeof noise[k].gate_added, 'number');
    assert.equal(typeof noise[k].p0_judge_invented, 'number');
  }
  assert.ok(Object.values(noise).some((s) => s.gate_added > 0), 'the P0 A/A arms differ by some added items');
  assert.deepEqual(perStepCounts([
    { key: 'claude/nursing/reply-1', judge_added: 1, gate_added: ['x', 'y'], not_worse: true },
    { key: 'claude/nursing/reply-2', judge_added: 0, gate_added: [], not_worse: false },
    { key: 'digest-1', judge_added: 4, gate_added: [] },
  ]), { 'claude/reply': { pairs: 2, judge_added: 1, gate_added: 2, not_worse: 1 } });
});

test('R2-M2: a draft verdict keeps the first and the milder setting per-step counts and the A/A noise; --aa-control is opt-in', async () => {
  const { runSolo } = await fix2();
  await withPack(async (dir, h) => {
    const fake = h.fakeAgents({ missAlways: true });
    const out = h.sayer();
    await runSolo({ root: dir, levers: ['T11'], runner: fake.runner, judge: fake.judge, resolve: h.resolve, say: out.say, seed: 's', today: '2026-11-22' });
    const data = h.verdictJson(dir);
    const v = data.levers.T11;
    assert.equal(v.verdict, 'fail', out.lines.join('\n'));
    assert.ok(v.per_step_first['claude/cover'].pairs > 0 && v.per_step_milder['claude/cover'].pairs > 0, JSON.stringify(v));
    assert.ok(v.judged_pairs_first.length > 0, 'the first setting\'s pairs are kept');
    assert.ok(v.aa_noise['claude/cover'] && !v.aa_noise['claude/reply'], 'A/A noise of the lever\'s own steps');
    assert.equal(data.aa, undefined, 'no A/A arm without --aa-control');
    assert.ok(data.solo.aa_noise['codex/reply']);
  });
  await withPack(async (dir, h) => {
    const fake = h.fakeAgents();
    const out = h.sayer();
    await runSolo({ root: dir, levers: ['T11'], runner: fake.runner, judge: fake.judge, resolve: h.resolve, say: out.say, seed: 's', today: '2026-11-22', aaControl: true });
    assert.match(out.lines.join('\n'), /A\/A control re-run \(cover; opt-in\)/);
    const data = h.verdictJson(dir);
    assert.ok(data.aa.per_step['claude/cover'].pairs > 0, JSON.stringify(data.aa));
  });
});

test('R2-M3: a Codex final triage score keeps medium effort even with T12 on; only the pre-screen is a bulk step', async () => {
  const { dailyTriage } = await import('../../scripts/daily-triage.mjs');
  const t = await import('../helpers/triage-harness.mjs');
  const { h } = await fix2();
  const pins = { bars_sha256: 'b'.repeat(64), sample_hash: 's'.repeat(64) };
  const farm = h.packFarm({ T12: { ...h.soloVerdict('pass', 0), ...pins } });
  const r = t.makeTriageRoot({ config: `${t.PLUS}agent: codex\n`, pending: t.untriaged(2) });
  try {
    const file = join(farm.dir, 'docs', 'lever-verdicts.json');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(file, JSON.stringify({ levers: { T12: { ...h.soloVerdict('pass', 0), ...pins } }, stacked: { status: 'stacked pass after 1 round: T12 on together', final: ['T12'] } }));
    const { runner, calls } = t.makeRunner(r);
    await dailyTriage({ ...t.args(r, { agent: 'codex', agentPath: '/opt/sample/bin/codex', claude: null }), packRoot: farm.dir, runner });
    assert.ok(calls.codex.length > 0);
    for (const c of calls.codex) assert.ok(c.args.includes('model_reasoning_effort=medium'), c.args.join(' '));
  } finally {
    r.cleanup();
    farm.cleanup();
  }
  assert.equal(bulkEffort('codex', true, 'low', { isOn: () => false }), 'low', 'the pre-screen tier is already low');
});

test('R2-M4: bulkEffort takes the plan signature with an isOn function', () => {
  assert.equal(bulkEffort('codex', true, 'medium', { isOn: (id) => id === 'T12' }), 'low');
  assert.equal(bulkEffort('codex', true, 'medium', { isOn: () => false }), 'medium');
  assert.equal(bulkEffort('codex', false, 'medium', { isOn: () => true }), 'medium');
  assert.equal(bulkEffort('claude', true, 'medium', { isOn: () => true }), 'medium');
});

test('R2-M4: soloLoss reads the flat lower-case quality shape too', async () => {
  const { soloLoss } = await fix2();
  const flat = (after, before) => ({ verdict: 'pass', quality_after: after, ...(before ? { quality_before: before } : {}) });
  assert.ok(soloLoss(flat({ overlap_min: 0.8 })) > soloLoss(flat({ overlap_min: 0.95 })));
  assert.ok(soloLoss(flat({ overlap_min: 0.95 }, { overlap_min: 0.9 })) < soloLoss(flat({ overlap_min: 1 })), 'a gain ranks lowest');
  assert.ok(soloLoss(flat({ invented_facts_max: 2 })) > soloLoss(flat({ invented_facts_max: 0 })));
  assert.ok(soloLoss({ qualityBefore: { OVERLAP_MIN: 1 }, qualityAfter: { OVERLAP_MIN: 0.7 } }) > 0.29);
});

test('R2-M4: a judge stop names claude (Opus judge); a limit sent as a normal answer stops with exit 5 naming the agent', async () => {
  const { runSolo, readReply } = await fix2();
  assert.match(readReply('claude', { status: 0, stdout: JSON.stringify({ type: 'result', is_error: false, result: 'Claude AI usage limit reached|1795300000' }) }).error, /usage limit/);
  assert.match(readReply('claude', { status: 0, text: 'x', usage: { input_tokens: 1, output_tokens: 1 }, stdout: JSON.stringify({ type: 'result', is_error: true, result: 'weekly limit reached' }) }).error, /limit reached/);
  assert.equal(readReply('claude', { status: 0, text: 'I would welcome the chance to talk about the role.' }).error, null);
  for (const agent of ['claude', 'codex']) {
    await withPack(async (dir, h) => {
      const limit = (call) => ((call?.agent ?? 'claude') === agent ? h.agentReply(agent, "You've hit your usage limit. Try again at 5pm.", h.SMALL_USAGE, 'm') : null);
      const fake = h.fakeAgents({ fail: (call, judging) => (judging ? null : limit(call)) });
      const out = h.sayer();
      const code = await runSolo({ root: dir, levers: ['jd_trim'], runner: fake.runner, judge: fake.judge, resolve: h.resolve, say: out.say, seed: 's', today: '2026-11-22' });
      assert.equal(code, 5, out.lines.join('\n'));
      assert.match(out.lines.join('\n'), new RegExp(`blocked-on-user.*${agent}`, 'i'));
      assert.match(out.lines[0], /estimate/);
    });
  }
  await withPack(async (dir, h) => {
    const fake = h.fakeAgents({ fail: (call, judging) => (judging ? h.quotaReply('claude') : null) });
    const out = h.sayer();
    const code = await runSolo({ root: dir, levers: ['T11'], runner: fake.runner, judge: fake.judge, resolve: (a) => (a === 'claude' ? h.resolve(a) : null), say: out.say, seed: 's', today: '2026-11-22' });
    assert.equal(code, 5);
    assert.match(out.lines.join('\n'), /blocked-on-user.*claude \(Opus judge\)/);
  });
});

test('R2-S1: a stacked round reuses the stored T4 result instead of paying for its trial again', async () => {
  const { runStacked } = await fix2();
  const calls = async (set) => {
    let n = 0;
    let rounds = [];
    await withPack(async (dir, h) => {
      h.writeVerdicts(dir, Object.fromEntries(set.map((id) => [id, h.soloVerdict('pass', 0.01)])));
      const fake = h.fakeAgents();
      await runStacked({ root: dir, runner: fake.runner, judge: fake.judge, resolve: h.resolve, say: () => {}, seed: 's', today: '2026-11-22' });
      n = fake.calls.length;
      rounds = h.verdictJson(dir).stacked.rounds;
    });
    return { n, rounds };
  };
  const without = await calls(['jd_trim']);
  const withT4 = await calls(['jd_trim', 'T4']);
  assert.equal(withT4.n, without.n, 'no resume or judge call for T4');
  assert.deepEqual(withT4.rounds[0].reused_solo_measures, ['T4']);
});

test('R2-S3: a verdict with no bars_sha256 or sample_hash stays off even after a stacked pass that lists it', async () => {
  const { resolve } = await import('../../lib/levers.mjs');
  const stacked = { status: 'stacked pass after 1 round: T5 on together', final: ['T5'] };
  assert.equal(resolve('T5', { verdicts: { levers: { T5: { verdict: 'pass' } }, stacked }, overrides: {} }).on, false);
  assert.equal(resolve('T5', { verdicts: { levers: { T5: { verdict: 'pass', bars_sha256: 'b' } }, stacked }, overrides: {} }).on, false);
  assert.equal(resolve('T5', { verdicts: { levers: { T5: { verdict: 'pass', bars_sha256: 'b', sample_hash: 's' } }, stacked }, overrides: {} }).on, true);
});

test('R2-S3: the committed docs/lever-verdicts.json has a stacked record and every gated or tuning lever on is in its final set', async () => {
  const { LEVERS, resolve } = await import('../../lib/levers.mjs');
  const verdicts = JSON.parse(readFileSync(join(PACK_ROOT, 'docs', 'lever-verdicts.json'), 'utf8'));
  assert.equal(typeof verdicts.stacked, 'object');
  assert.ok(verdicts.stacked && Array.isArray(verdicts.stacked.final));
  for (const [id, def] of Object.entries(LEVERS)) {
    if (def.kind === 'plumbing') continue;
    if (resolve(id, { verdicts, overrides: {} }).on) assert.ok(verdicts.stacked.final.includes(id), `${id} is on without a stacked pass`);
  }
});

test('R2-N1: campaign --dry-run prints a stacked preview with the solo control reused and makes no call', async () => {
  const { runCampaign } = await fix2();
  await withPack(async (dir, h) => {
    const fake = h.fakeAgents();
    const out = h.sayer();
    const code = await runCampaign({ root: dir, runner: fake.runner, judge: fake.judge, resolve: h.resolve, say: out.say, seed: 's', today: '2026-11-22', dryRun: true });
    assert.equal(code, 0);
    assert.equal(fake.calls.length, 0);
    const text = out.lines.join('\n');
    assert.match(text, /stacked preview \(solo control reused\)/);
    assert.doesNotMatch(text, /no stacked run was made/);
  });
});

// Fix 2b (verify r3): plain-number quality scores, and a returned limit error inside a shipped helper that catches it.
test('2b: soloLoss reads plain-number quality before and after', async () => {
  const { soloLoss } = await fix2();
  const v = (before, after) => ({ verdict: 'pass', tokens: { before: 100, after: 80 }, quality: { before, after } });
  assert.ok(soloLoss(v(0.92, 0.7)) > soloLoss(v(0.92, 0.88)));
  assert.ok(soloLoss(v(0.92, 0.88)) > soloLoss(v(0.8, 0.86)), 'a gain ranks lowest');
});

test('2b: a returned rate-limit error in the T9 digest helper stops runSolo with exit 5 naming claude, after the estimate', async () => {
  const { runSolo } = await fix2();
  await withPack(async (dir, h) => {
    const out = h.sayer();
    let before = null;
    const calls = [];
    const runner = (call) => {
      before ??= out.lines.slice();
      calls.push(call);
      return { text: '', model: null, usage: null, error: '429 Too Many Requests: rate limit reached for this account' };
    };
    const code = await runSolo({ root: dir, levers: ['T9'], runner, judge: runner, resolve: (a) => `/fake/bin/${a}`, say: out.say, seed: 'fix2b', today: '2026-11-22' });
    assert.ok(before && /estimate/.test(before.join('\n')) && /opus judge/.test(before.join('\n')), 'estimate before the first call');
    assert.equal(code, 5, out.lines.join('\n'));
    assert.match(out.lines.join('\n'), new RegExp(`blocked-on-user.*${calls[0].agent === 'codex' ? 'codex' : 'claude'}`));
    assert.notEqual(h.verdictJson(dir).levers?.T9?.verdict, 'pass');
  });
});
