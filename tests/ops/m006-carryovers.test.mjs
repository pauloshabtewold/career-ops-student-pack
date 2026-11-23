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
