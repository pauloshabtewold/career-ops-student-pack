// Assumed (M-005): scripts/inbox-pass.mjs inboxPass runs runInbox with --classify-outcomes and a classifier built by
// scripts/inbox.mjs agentClassifier from the pass's own agent, agentPath and runner, so with T7 off (the default) an
// outcome mail is classified on the scheduled path. The classifier call goes through lib/headless.mjs as a claude
// --output-format json call on the same runner; its result text is the class word (rejection, interview, offer or
// unclear). tests/ops/inbox-pass.test.mjs is locked since M-002, so this check lives here. Fake agent runner only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inboxPass } from '../../scripts/inbox-pass.mjs';
import { CLAUDE, answerText, claudeStream, makeInboxRoot, msg, runPass } from '../helpers/inbox-harness.mjs';

const REJECT = msg('o-601', 'Northwind Robotics Recruiting <recruiting@northwindrobotics.example.com>', 'Update on your application', 'Thank you for your time. We have decided to move forward with other candidates for this role.');
const classifierReply = (text) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 300, output_tokens: 2 } });

// M-005-S16-osdr
test('M-005-S16-osdr the scheduled inbox pass runs inbox.mjs with --classify-outcomes through the pass agent so an outcome mail with T7 off is classified', async () => {
  const r = makeInboxRoot();
  try {
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
