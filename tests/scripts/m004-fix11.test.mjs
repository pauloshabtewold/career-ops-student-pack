// SYNTHETIC FIXTURE: placeholder people, companies and cv text only.
// M-004 fix 11. The fix 10 design stands (prose body, code frame, rails, a separate fail-closed verifier call). These
// tests pin what this round adds:
// A. the verifier gets a KNOWN TRUE block built by code from the pack's own records (the application record, the
//    outreach history with the contact, the code-written frame sentences), so the application opening and a true
//    "circling back on my earlier note" pass, while a nudge with no logged message and another applied date are flagged.
// Scratch roots, example.com addresses and an injected headless runner: no real model, network, Gmail or LinkedIn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOG_HEADER } from '../../lib/action-log.mjs';
import { serializeTsv } from '../../lib/tsv.mjs';
import * as od from '../../scripts/outreach-drafts.mjs';
import { APP, CV, GLOBEX, TITLE, draftIn, knownIn, person, roundFor } from '../helpers/outreach-verify-harness.mjs';

const NORA = person('Nora Nudge', 'Umbrella Example', 'follow-up');
const logOf = (rows) => ({ 'data/action-log.tsv': serializeTsv([...LOG_HEADER], rows.map(([date, action, target, company, detail = '']) => ({ ts: `${date}T12:00:00.000Z`, date, session: 'fixture', action, target, company, approval: '', detail }))) });

// A fake verifier that follows the prompt contract: a draft sentence that states an application, an earlier note or a
// circling back is supported only when the resume or the KNOWN TRUE block backs it. The code-written opening is backed
// when the block quotes it; "my earlier note" is backed when the block logs a message the student sent.
const sentences = (text) => text.split(/\n+/).flatMap((l) => l.split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter(Boolean);
const CLAIMISH = /\bappl(?:ied|ication)\b|\bearlier (?:note|message)\b|\bcircl(?:e|ing) back\b/i;
const strictVerifier = (prompt) => {
  const known = knownIn(prompt) ?? '';
  const backed = (s) => CV.includes(s) || known.includes(s) || (/\bearlier (?:note|message)\b|\bcircl(?:e|ing) back\b/i.test(s) && !/\bappl(?:ied|ication)\b/i.test(s) && /the student sent .+ (?:message|email)/i.test(known));
  return JSON.stringify({ unsupported: sentences(draftIn(prompt) ?? '').filter((s) => CLAIMISH.test(s) && !backed(s)) });
};

const APP_BODY = 'The focus on practical internal tools stands out, and I built something similar at my internship. I am happy to send code samples.';
const OPENING = `I applied for the ${TITLE} role at ${GLOBEX} on November 14, 2026, and I wanted to follow up.`;

test('fix 11 A the code-written application opening passes a strict verifier: the KNOWN TRUE block quotes it and holds the application record', async () => {
  const out = await roundFor(APP, { drafts: [APP_BODY], verdict: strictVerifier });
  assert.deepEqual(out.res.flagged, [], 'not flagged');
  assert.equal(out.items.length, 1, 'batched');
  assert.ok(out.items[0].message.includes(OPENING));
  const known = knownIn(out.verifies[0].prompt);
  assert.ok(known.includes(`"${OPENING}"`), known);
  assert.ok(known.includes(`The student applied for the ${TITLE} role at ${GLOBEX} on November 14, 2026 (the application record).`), known);
  assert.ok(known.includes('"Thank you for your time and consideration."') && known.includes('"Hello Globex Example hiring team,"'), known);
});

test('fix 11 A "circling back on my earlier note" passes when the action log holds the earlier message', async () => {
  const body = 'I wanted to circle back on my earlier note in case it got buried. Would a short chat in the next few weeks work?';
  const out = await roundFor(NORA, { drafts: [body], verdict: strictVerifier, extraFiles: logOf([['2026-11-16', 'linkedin.message', 'Nora Nudge', 'Umbrella Example']]) });
  assert.deepEqual(out.res.flagged, []);
  assert.equal(out.items.length, 1);
  assert.match(knownIn(out.verifies[0].prompt), /On November 16, 2026, the student sent Nora Nudge a LinkedIn message\./);
});

test('fix 11 A "circling back on my earlier note" is flagged when no earlier message is logged', async () => {
  const body = 'I wanted to circle back on my earlier note in case it got buried. Would a short chat in the next few weeks work?';
  const out = await roundFor(NORA, { drafts: [body], verdict: strictVerifier });
  assert.equal(out.items.length, 0, 'kept out');
  assert.match(out.res.flagged[0].flags.join('; '), /"I wanted to circle back on my earlier note in case it got buried\."/);
  assert.match(knownIn(out.verifies[0].prompt), /No earlier message between the student and Nora Nudge is logged\./);
  // Another contact's message is not this contact's history.
  const other = await roundFor(NORA, { drafts: [body], verdict: strictVerifier, extraFiles: logOf([['2026-11-16', 'linkedin.message', 'Rita Reply', 'Umbrella Example']]) });
  assert.equal(other.items.length, 0);
});

test('fix 11 A "I applied ... on <another date>" is flagged; the code opening with the real date is not', async () => {
  const body = `I applied for the role at ${GLOBEX} on November 20, 2026 as well. ${APP_BODY}`;
  const out = await roundFor(APP, { drafts: [body], verdict: strictVerifier });
  assert.equal(out.items.length, 0, 'kept out');
  const flags = out.res.flagged[0].flags.join('; ');
  assert.match(flags, /November 20, 2026/);
  assert.ok(!flags.includes('November 14, 2026'), flags);
});

test('fix 11 A knownTrueFacts reads only records: the application record, else the dated history with this contact', () => {
  assert.deepEqual(od.knownTrueFacts(APP), [`The student applied for the ${TITLE} role at ${GLOBEX} on November 14, 2026 (the application record).`]);
  const rows = [
    { date: '2026-11-10', ms: Date.parse('2026-11-10T12:00:00Z'), action: 'linkedin.connect', target: 'Nora Nudge', company: 'Umbrella Example', detail: 'note=120' },
    { date: '2026-11-12', ms: Date.parse('2026-11-12T12:00:00Z'), action: 'linkedin.accept', target: 'nora nudge', company: 'Umbrella Example', detail: '' },
    { date: '2026-11-13', ms: Date.parse('2026-11-13T12:00:00Z'), action: 'gmail.send', target: 'Nora Nudge', company: 'Umbrella Example', detail: 'followup=1' },
    { date: '2026-11-14', ms: Date.parse('2026-11-14T12:00:00Z'), action: 'linkedin.reply', target: 'Nora Nudge', company: 'Umbrella Example', detail: '' },
    { date: '2026-11-15', ms: Date.parse('2026-11-15T12:00:00Z'), action: 'linkedin.message', target: 'Nora Nudge', company: 'Other Example', detail: '' },
  ];
  assert.deepEqual(od.knownTrueFacts(NORA, { actionRows: rows, contactRows: [{ date: '2026-11-12', company: 'Umbrella Example', name: 'Nora Nudge', stage: 'accepted' }] }), [
    'On November 10, 2026, the student sent Nora Nudge a LinkedIn connection request with a note.',
    'On November 12, 2026, Nora Nudge accepted the student\'s LinkedIn connection request.',
    'On November 14, 2026, Nora Nudge replied to the student on LinkedIn.',
    'On November 12, 2026, the student\'s contact sheet records the stage "accepted" for Nora Nudge.',
  ]);
  const p = od.verifyPrompt({ cv: CV, job: NORA, draft: 'Hi Nora,\n\nx', known: ['No earlier message between the student and Nora Nudge is logged.'] });
  assert.match(p, /A statement backed by it is supported, the same as a resume fact/);
  assert.match(knownIn(p), /Code writes this sentence into the message: "Hi Nora,"/);
});
