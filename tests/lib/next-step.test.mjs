// lib/next-step.mjs and scripts/session-start.mjs guidedLines: with T14 off session-start prints the one-line pattern
// rule; with T14 on it prints the computed Next, Type and Why block. Scratch data dir only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const linesOf = (r) => (Array.isArray(r) ? r : String(r ?? '').split('\n')).map(String).filter((l) => l.trim());
const block = (lines) => ['Next:', 'Type:', 'Why:'].map((p) => lines.filter((l) => l.startsWith(p)).length);

// M-002-S37-osdr
test('M-002-S37-osdr with T14 off session-start prints the guided pattern rule line instead of a computed Next/Type/Why block', async () => {
  const { patternRule } = await import('../../lib/next-step.mjs');
  const { guidedLines } = await import('../../scripts/session-start.mjs');
  const dataDir = mkdtempSync(join(tmpdir(), 'pack-next-step-'));
  try {
    const rule = patternRule();
    assert.equal(typeof rule, 'string');
    assert.ok(rule.trim().length > 0 && !rule.includes('\n'), 'the pattern rule is one line');

    const off = linesOf(guidedLines({ dataDir, t14On: false }));
    assert.ok(off.includes(rule), off.join('\n'));
    assert.deepEqual(block(off), [0, 0, 0], `no computed block while T14 is off:\n${off.join('\n')}`);

    const on = linesOf(guidedLines({ dataDir, t14On: true }));
    assert.deepEqual(block(on), [1, 1, 1], `one computed block while T14 is on:\n${on.join('\n')}`);
    assert.ok(!on.includes(rule), 'the rule line is replaced by the block');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
