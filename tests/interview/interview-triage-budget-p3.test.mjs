// AGENTS.student.md limits rule for P3 (G1 light). tests/interview/interview-triage-budget.test.mjs is locked by M-003,
// so the raise rule is pinned here: the user may lower any limit and may raise one in config/student.yml up to its
// budget.mjs ceiling after an "I'll set it to N, approve?" yes; a request past a ceiling gets a one-line explanation and
// the ceilings never change. The file stays under 8192 bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const agents = readFileSync(join(PACK_ROOT, 'AGENTS.student.md'), 'utf8');

// M-004-S20-osdr
test('M-004-S20-osdr AGENTS.student.md lets the user raise a limit up to its budget.mjs ceiling after an approve and keeps the ceilings fixed', () => {
  const sentence = agents.split(/\.\s/).find((s) => /raise/i.test(s) && /config\/student\.yml/.test(s) && /ceiling/i.test(s));
  assert.ok(sentence, 'one sentence holds the raise rule');
  assert.match(sentence, /up to its `?budget\.mjs`? ceiling/i);
  assert.ok(agents.includes("I'll set it to N, approve?"), 'the raise is asked as "I\'ll set it to N, approve?"');
  assert.match(agents, /lower any limit/i);
  assert.match(agents, /past a ceiling[^.]*one-line explanation/i);
  assert.match(agents, /ceilings never change/i);
  assert.doesNotMatch(agents, /the user can only lower caps/, 'the lower-only sentence is gone');
  assert.ok(Buffer.byteLength(agents, 'utf8') < 8192, 'AGENTS.student.md stays under 8192 bytes');
});
