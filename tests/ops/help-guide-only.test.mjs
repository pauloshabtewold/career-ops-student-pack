// Live proof 2026-11-10: "help" ended with an update prompt. The pack rules must tell the agent to answer with the guide only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/budget-harness.mjs';

const rules = readFileSync(join(PACK_ROOT, 'AGENTS.student.md'), 'utf8');

test('help answers with the guide only and skips the session checks', () => {
  const rule0 = rules.split('\n').find((l) => l.startsWith('0. '));
  assert.ok(rule0, 'Session start rule 0 is missing');
  assert.match(rule0, /whole message is "help"/);
  assert.match(rule0, /update-system\.mjs check/);
  assert.match(rule0, /docs\/commands\.md/);
  assert.match(rule0, /no update notice/);
});

test('normal sessions keep the update rule', () => {
  assert.match(rules, /3\. Updates: when upstream's session check suggests updating, run `node student\/update\.mjs`/);
});
