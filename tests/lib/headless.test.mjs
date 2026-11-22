// lib/headless.mjs usage mapping shared with scripts/inbox-pass.mjs: claude stream-json result usage through
// normalizeUsage and codex turn.completed events through parseCodex. Synthetic transcripts only; no agent CLI runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const line = (o) => JSON.stringify(o);
const tokens = (u) => ({ input: Number(u?.input), cache_read: Number(u?.cache_read), cache_write: Number(u?.cache_write), output: Number(u?.output) });

const CLAUDE_STREAM = [
  line({ type: 'system', subtype: 'init', tools: [] }),
  line({ type: 'assistant', message: { content: [{ type: 'text', text: 'thinking' }] } }),
  line({ type: 'result', subtype: 'success', is_error: false, result: '{"messages":[],"not_read":0}', usage: { input_tokens: 200, cache_read_input_tokens: 50, cache_creation_input_tokens: 5, output_tokens: 30 } }),
].join('\n');

const CODEX_EVENTS = [
  line({ type: 'thread.started', thread_id: 'th-fake' }),
  line({ type: 'turn.completed', usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20 } }),
  line({ type: 'item.completed', item: { id: 'i0', type: 'agent_message', text: '{"messages":[],"not_read":0}' } }),
  line({ type: 'turn.completed', usage: { input_tokens: 50, cached_input_tokens: 10, output_tokens: 5 } }),
].join('\n');

// M-002-S46-osdr
test('M-002-S46-osdr inbox-pass passUsage maps claude stream-json and codex usage through lib/headless.mjs normalizeUsage and parseCodex', async () => {
  const { normalizeUsage } = await import('../../lib/headless.mjs');
  const { passUsage } = await import('../../scripts/inbox-pass.mjs');
  assert.equal(typeof normalizeUsage, 'function', 'lib/headless.mjs exports normalizeUsage');
  assert.deepEqual(normalizeUsage({ input_tokens: 200, cache_read_input_tokens: 50, cache_creation_input_tokens: 5, output_tokens: 30 }), { input: 200, cache_read: 50, cache_write: 5, output: 30 });
  assert.deepEqual(normalizeUsage({ input_tokens: 7 }), { input: 7, cache_read: 0, cache_write: 0, output: 0 });
  assert.equal(normalizeUsage(null), null);

  assert.equal(typeof passUsage, 'function', 'scripts/inbox-pass.mjs exports passUsage');
  assert.deepEqual(tokens(passUsage('claude', CLAUDE_STREAM)), { input: 200, cache_read: 50, cache_write: 5, output: 30 });
  const codex = passUsage('codex', CODEX_EVENTS);
  assert.equal(Number(codex.input), 150);
  assert.equal(Number(codex.output), 25);
});
