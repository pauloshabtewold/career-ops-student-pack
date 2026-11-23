// Guided-messages lint, P4 additions. tests/ops/guided-messages.test.mjs is locked since M-002, so the P4 list is
// checked here with the same rule: modes/daily-run.md and the digest template join the list, and with them all six mode
// files are linted. Importing that file would register its tests a second time, so the line rule is repeated.
// Assumed (M-005): the digest template is lib/digest.mjs summaryLines(state) for an empty day ({}), joined by lines.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const fromFile = (rel) => ({ name: rel, read: async () => readFileSync(join(PACK_ROOT, rel), 'utf8') });
const MODES = ['modes/apply-loop.md', 'modes/inbox.md', 'modes/review.md', 'modes/handshake.md', 'modes/outreach.md', 'modes/daily-run.md'];

export const LINTED_P4 = [
  ...MODES.map(fromFile),
  {
    name: 'digest template (lib/digest.mjs summaryLines)',
    read: async () => {
      const { summaryLines } = await import('../../lib/digest.mjs');
      const out = summaryLines({});
      return Array.isArray(out) ? out.join('\n') : String(out);
    },
  },
];

const LINE_PREFIXES = ['Next:', 'Type:', 'Why:'];

// Same rule as lintGuided in guided-messages.test.mjs: null when the text holds every guided line.
function lintGuided(name, text) {
  const lines = String(text).split('\n').map((l) => l.replace(/^[\s>*_-]+/, '').replace(/^\*\*(Next|Type|Why):\*\*/, '$1:'));
  const missing = LINE_PREFIXES.filter((p) => !lines.some((l) => l.startsWith(p)));
  return missing.length ? `${name}: missing the ${missing.join(', ')} line${missing.length > 1 ? 's' : ''}` : null;
}

// M-005-S14-osdr
test('M-005-S14-osdr the guided-messages lint list from P4 adds modes/daily-run.md and the digest template so all six mode files are linted and pass', async () => {
  const names = LINTED_P4.map((e) => e.name);
  assert.equal(names.filter((n) => n.startsWith('modes/')).length, 6);
  assert.ok(names.includes('modes/daily-run.md') && names.some((n) => /digest/.test(n)));
  const problems = [];
  for (const entry of LINTED_P4) {
    let text;
    try {
      text = await entry.read();
    } catch (err) {
      problems.push(`${entry.name}: ${err.message}`);
      continue;
    }
    const p = lintGuided(entry.name, text);
    if (p) problems.push(p);
  }
  assert.deepEqual(problems, []);
});
