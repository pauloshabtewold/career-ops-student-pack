// A real pass whose agent made no Gmail search fails with a digest line and leaves the last-pass marker alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODEX_GMAIL_CONNECTOR_ID, CODEX_GMAIL_READ_TOOLS } from '../../lib/agent.mjs';
import { buildCodexArgs, inboxPass } from '../../scripts/inbox-pass.mjs';
import { answerText, claudeStream, digestOf, makeInboxRoot, runPass } from '../helpers/inbox-harness.mjs';

test('extra check: a pass with no Gmail search is skipped in the digest and does not advance the last-pass marker', async () => {
  const r = makeInboxRoot();
  try {
    await runPass(r, { inboxPass, handlers: { claude: () => claudeStream({ tools: [], answer: answerText([]) }) } });
    assert.match(digestOf(r), /inbox pass skipped: no Gmail search was made/);
    assert.equal(r.exists('data/.student-inbox-last-pass'), false);
  } finally {
    r.cleanup();
  }
});

test('extra check: the codex call allow-lists the two Gmail read tools', () => {
  const values = buildCodexArgs({ tmp: '/t', out: '/t/o' }).flatMap((a, i, all) => (all[i - 1] === '-c' ? [a] : []));
  assert.ok(values.includes(`apps.${CODEX_GMAIL_CONNECTOR_ID}.default_tools_enabled=false`));
  for (const t of CODEX_GMAIL_READ_TOOLS) assert.ok(values.includes(`apps.${CODEX_GMAIL_CONNECTOR_ID}.tools.${t}.enabled=true`), t);
});
