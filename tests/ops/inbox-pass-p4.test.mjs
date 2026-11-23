// Assumed (M-005): scripts/inbox-pass.mjs inboxPass runs runInbox with --classify-outcomes and a classifier built by
// scripts/inbox.mjs agentClassifier from the pass's own agent, agentPath and runner, so with T7 off (the default) an
// outcome mail is classified on the scheduled path. The classifier call goes through lib/headless.mjs as a claude
// --output-format json call on the same runner; its result text is the class word (rejection, interview, offer or
// unclear). tests/ops/inbox-pass.test.mjs is locked since M-002, so this check lives here. Fake agent runner only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inboxPass } from '../../scripts/inbox-pass.mjs';
import { CLAUDE, answerText, claudeStream, digestFile, makeInboxRoot, msg, runPass } from '../helpers/inbox-harness.mjs';

const REJECT = msg('o-601', 'Northwind Robotics Recruiting <recruiting@northwindrobotics.example.com>', 'Update on your application', 'Thank you for your time. We have decided to move forward with other candidates for this role.');
const classifierReply = (text) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 300, output_tokens: 2 } });

// M-005-S16-osdr
test('M-005-S16-osdr the scheduled inbox pass runs inbox.mjs with --classify-outcomes through the pass agent so an outcome mail with T7 off is classified', async () => {
  const r = makeInboxRoot();
  try {
    // The student's levers.yml pins T7 off, whatever the shipped verdict file says.
    r.write('config/levers.yml', 'T7: off\n');
    const claude = (args) => (args.includes('stream-json') ? claudeStream({ answer: answerText([REJECT]) }) : classifierReply('rejection'));
    const { calls, statusCalls } = await runPass(r, { inboxPass, handlers: { claude } });
    const classifierCalls = calls.claude.filter((c) => !c.args.includes('stream-json'));
    assert.ok(classifierCalls.length >= 1, 'the outcome mail went to the agent classifier');
    for (const c of classifierCalls) assert.equal(c.cmd, CLAUDE, 'the classifier uses the pass agent path');
    const rejected = statusCalls.filter((c) => c.argv[0] === 'set-status.mjs' && c.argv.includes('Rejected'));
    assert.equal(rejected.length, 1, `the Northwind Robotics row is set to Rejected: ${JSON.stringify(statusCalls.map((c) => c.argv))}`);
  } finally {
    r.cleanup();
  }
});

// The T7-on order, injected through inboxDeps.t7On so it does not depend on the shipped verdicts: the rules decide the
// own-domain rejection without an agent call, and only the relay mail the rules cannot tie to the company goes to the
// classifier, whose answer stays a proposal.
test('M-005-S16-osdr with T7 on the scheduled inbox pass applies a rule-matched outcome without the classifier and sends only unmatched mail to it', async () => {
  const r = makeInboxRoot();
  try {
    const relay = msg('o-602', 'Contoso Analytics <no-reply@ats-relay.example.com>', 'Your Contoso Analytics application', 'Thank you for applying to Contoso Analytics. We have decided to move forward with other candidates.');
    const classified = [];
    const claude = (args, opts) => {
      if (args.includes('stream-json')) return claudeStream({ answer: answerText([REJECT, relay]) });
      classified.push(String(opts?.input ?? args.join(' ')));
      return classifierReply('rejection');
    };
    const { calls, statusCalls } = await runPass(r, { inboxPass, handlers: { claude }, inboxDeps: { t7On: true } });
    const classifierCalls = calls.claude.filter((c) => !c.args.includes('stream-json'));
    assert.equal(classifierCalls.length, 1, 'only the relay mail goes to the classifier');
    assert.ok(!classified.some((t) => t.includes('o-601') || t.includes('Northwind')), 'the rule-matched mail is not classified');
    const setCalls = statusCalls.filter((c) => c.argv[0] === 'set-status.mjs');
    assert.equal(setCalls.length, 1, `one row changes: ${JSON.stringify(setCalls.map((c) => c.argv))}`);
    assert.ok(setCalls[0].argv.includes('Rejected') && setCalls[0].argv.includes('1'), 'the Northwind Robotics row is set to Rejected by the rules');
    const digest = r.read(digestFile);
    assert.match(digest, /o-602 Contoso Analytics/, 'the relay mail is a proposal in the digest');
  } finally {
    r.cleanup();
  }
});
