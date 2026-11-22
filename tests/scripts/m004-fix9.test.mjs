// SYNTHETIC FIXTURE: placeholder people, companies and cv text only.
// M-004 fix 9 cases, re-pinned in the fix 10 shape ("warm prose + hard rails + independent verifier"). The slot grammar
// of fix 9 is gone; what fix 9 fixed still holds: the final message is assembled once, every check (the rails and the
// verifier) reads that exact string, and it is the string stored and sent (M1, E); a lowercase or uppercase company
// name carries no unchecked claim (M4); the shared fact gate for cover letters and fill plans has no outreach exemption
// (M5); code owns the frame, so the application and the date are stated once and the closing thanks once (D, S1, N1).
// Scratch roots, example.com addresses and an injected headless runner: no real model, network, Gmail or LinkedIn. The
// module is imported as a namespace so the M1, M4 and M5 tests also load against older code for the revert proof.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check as factCheck } from '../../lib/fact-gate.mjs';
import * as od from '../../scripts/outreach-drafts.mjs';
import { ALICE, APP, CV, GLOBEX, SOURCES, TITLE, draftIn, person, roundFor } from '../helpers/outreach-verify-harness.mjs';

// A verdict that lists the first claim matching re that the verified draft holds.
const claimsOf = (re) => (prompt) => {
  const m = re.exec(draftIn(prompt) ?? '');
  return JSON.stringify({ unsupported: m ? [m[0]] : [] });
};

// Review r7 M1 (D1 to D4): text after an early sign-off or a second greeting was stored but never checked.
const M1_REPLIES = [
  "I'm curious about the work at {company}. What do you enjoy most about it?\n\nThanks!\n\nP.S. I interned with your team in 2025 and led 3 projects for {company}.\n\nBest,\nSam",
  'Hello from a former Globex Example intern, I would love to reconnect.\n\nIs there anything else I can send?',
  'Regards, everyone I met\n\nI managed the Globex Example data pipeline for two summers.\n\nBest regards,\nSam Placeholder',
];
const M1_CLAIM = /interned with your team in 2025 and led 3 projects for \w+ Example|former Globex Example intern|managed the Globex Example data pipeline for two summers/;

test('fix 9 M1 (fix 10) a claim after an early sign-off or a second greeting reaches the verifier inside the final string, and its verdict keeps it out', async () => {
  for (const text of M1_REPLIES) {
    for (const job of [APP, ALICE]) {
      const out = await roundFor(job, { drafts: [text], verdict: claimsOf(M1_CLAIM) });
      assert.ok(out.verifies.length >= 1, `verified: ${text}`);
      assert.match(draftIn(out.verifies[0].prompt), M1_CLAIM, 'the claim is in the verified string');
      assert.equal(draftIn(out.verifies[0].prompt), od.checkDraft(text, job, { sources: SOURCES }).text);
      assert.ok(!out.items.some((i) => M1_CLAIM.test(i.message)), `${job.action} stored: ${JSON.stringify(out.items.map((i) => i.message))}`);
      assert.equal(out.res.flagged.length, 1);
    }
  }
});

test('fix 9 M1 and E (fix 10) the checked string, the verified draft, the stored message and the sent body are the same string', async () => {
  const body = 'The focus on practical internal tools stands out, and my Sample Labs internship was close to that work.';
  const checked = od.checkDraft(body, APP, { sources: SOURCES });
  assert.deepEqual(checked.flags, []);
  const { items, sentBody, drafting, verifies } = await roundFor(APP, { drafts: [body], send: true });
  assert.equal(drafting.length, 1);
  assert.equal(items.length, 1);
  assert.equal(draftIn(verifies[0].prompt), checked.text, 'verified === checked');
  assert.equal(items[0].message, checked.text, 'stored === checked');
  assert.equal(sentBody, checked.text, 'sent === checked');
});

test('fix 9 M4 (fix 10) a lowercase or uppercase company name never carries an unchecked claim into a stored message', async () => {
  const claim = /I (?:interned|was a software engineering intern) at [\w ]+?(?= last summer|\.)/i;
  for (const [job, text] of [[ALICE, 'I interned at acme example last summer.'], [ALICE, 'I interned at ACME EXAMPLE last summer.'], [person('Nina Note', 'Notion'), 'I interned at notion last summer.'], [APP, 'I was a software engineering intern at globex example.']]) {
    const out = await roundFor(job, { drafts: [text], verdict: claimsOf(claim) });
    assert.ok(draftIn(out.verifies[0].prompt).includes(text), `verified as written: ${text}`);
    assert.equal(out.items.length, 0, `stored: ${JSON.stringify(out.items.map((i) => i.message))}`);
    assert.equal(out.res.flagged.length, 1);
  }
});

test('fix 9 M5 the shared fact gate has no outreach exemption: invented ranks are claims whatever option is passed', async () => {
  const cv = CV;
  for (const s of ['Happy to share that our team won first.', "I'd love to share that my Campus Bus Tracker took first.", 'Can I share that I graduated first?', 'I was your first intern, remember?', 'Was I your first intern hire?']) {
    assert.ok(factCheck(s, { cv, outreach: true }).some((x) => /first/.test(x)), `outreach option: ${s}`);
    assert.ok(factCheck(s, { cv }).some((x) => /first/.test(x)), `default: ${s}`);
  }
  assert.deepEqual(factCheck('What was the biggest surprise in your first year of engineering work?', { cv, outreach: true }), ['first year'], 'the cover and fill reading for everyone');
  const { items, verifies } = await roundFor(ALICE, { drafts: ['Happy to share that our team won first.'], verdict: claimsOf(/our team won first/) });
  assert.match(draftIn(verifies[0].prompt), /Happy to share that our team won first\./);
  assert.equal(items.length, 0);
});

test('fix 9 D (S1, N1; fix 10) code owns the frame: the application is stated once, thanks once, at most one blank line, no Subject line', () => {
  const live = 'Hello Hiring team,\n\nI applied for the {title} role at {company} on {applied_date}, and I wanted to follow up.\n\nMy internship at Sample Labs is a close match for this role.\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder';
  const r = od.checkDraft(live, APP, { sources: SOURCES });
  assert.deepEqual(r.flags, []);
  assert.equal(r.text, `Hello ${GLOBEX} hiring team,\n\nI applied for the ${TITLE} role at ${GLOBEX} on November 14, 2026, and I wanted to follow up.\n\nMy internship at Sample Labs is a close match for this role.\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder`);
  assert.equal(r.text.match(/applied/gi).length, 1, 'the application is stated once');
  assert.equal(r.text.match(/November 14, 2026/g).length, 1);
  assert.equal(r.text.match(/thank/gi).length, 1, 'the model closing thanks is taken off; code writes CLOSING');
  assert.ok(!/\n[ \t]*\n[ \t]*\n/.test(r.text) && !/^subject:/im.test(r.text));
  const nudge = od.checkDraft('Is anything new on the team?\n\nThanks so much.', person('Nora Nudge', 'Umbrella Example', 'follow-up', { channel: 'email' }), { sources: SOURCES });
  assert.equal(nudge.text, 'Hello Nora,\n\nIs anything new on the team?\n\nThank you for your time and consideration.\n\nBest regards,\nSam Placeholder');
  assert.match(od.checkDraft('Great to connect.', person('Carl Connect', 'Wayne Example', 'connect', { noteChars: 20 }), { sources: SOURCES }).flags.join('; '), /exceeds the 20 limit/);
});
