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
  const levers = { T5: { verdict: 'pass' }, T11: { verdict: 'pass' }, T13: { verdict: 'pass' } };
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

test('T5 reads the contact role from contacts.tsv; T10 keeps one verifier round tag per day', async () => {
  const { contactRoles, roundTagFor } = await import('../../scripts/outreach-drafts.mjs');
  assert.equal(contactRoles([{ name: 'Ana Example', company: 'Example Co', role: 'Technical Recruiter' }]).get('ana example|example co'), 'Technical Recruiter');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'pack-roundtag-'));
  try {
    const a = roundTagFor(dir, '2026-11-23', true);
    assert.equal(roundTagFor(dir, '2026-11-23', true), a);
    assert.notEqual(roundTagFor(dir, '2026-11-24', true), a);
    assert.match(roundTagFor(dir, '2026-11-24', false), /^[0-9a-f]{8}$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
