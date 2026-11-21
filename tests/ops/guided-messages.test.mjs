// Guided-messages lint: every file in LINTED holds a Next line, a Type line and a Why line; a failure names the file.
// Later phases append their files to LINTED.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PACK_ROOT } from '../helpers/script-harness.mjs';

const fromFile = (rel) => ({ name: rel, read: async () => readFileSync(join(PACK_ROOT, rel), 'utf8') });

export const LINTED = [
  fromFile('modes/apply-loop.md'),
  fromFile('modes/inbox.md'),
  fromFile('modes/review.md'),
  fromFile('modes/handshake.md'),
  {
    name: 'setup-flow output (lib/next-step.mjs guidedFooter)',
    read: async () => {
      const { guidedFooter, nextStep } = await import('../../lib/next-step.mjs');
      const out = guidedFooter(nextStep({}));
      return Array.isArray(out) ? out.join('\n') : String(out);
    },
  },
  {
    name: 'batch template (lib/batch-file.mjs)',
    read: async () => {
      const { writeBatches, listBatches, BATCH_DIR } = await import('../../lib/batch-file.mjs');
      const dir = mkdtempSync(join(tmpdir(), 'pack-guided-batch-'));
      try {
        writeBatches(dir, { date: '2026-11-03', kind: 'apply', items: [{ company: 'Example Robotics', role: 'Software Engineering Intern', score: 4.2, preview: 'Fake letter preview.', link: 'https://boards.greenhouse.io/examplerobotics/jobs/1001' }] });
        const id = listBatches(dir).map((b) => (typeof b === 'string' ? b : b.id))[0];
        return readFileSync(join(dir, BATCH_DIR, `${id}.md`), 'utf8');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },
];

const LINE_PREFIXES = ['Next:', 'Type:', 'Why:'];

// Returns the problem for one text, or null when it holds every guided line. A line may carry markdown emphasis.
export function lintGuided(name, text) {
  const lines = String(text).split('\n').map((l) => l.replace(/^[\s>*_-]+/, '').replace(/^\*\*(Next|Type|Why):\*\*/, '$1:'));
  const missing = LINE_PREFIXES.filter((p) => !lines.some((l) => l.startsWith(p)));
  return missing.length ? `${name}: missing the ${missing.join(', ')} line${missing.length > 1 ? 's' : ''}` : null;
}

// M-002-S25-osdr
test('M-002-S25-osdr guided-messages lint fails a mode file missing the Next/Type/Why lines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-guided-'));
  try {
    const stripped = join(dir, 'review-stripped.md');
    const real = readFileSync(join(PACK_ROOT, 'modes', 'review.md'), 'utf8');
    writeFileSync(stripped, real.split('\n').filter((l) => !/^[\s>*_-]*(\*\*)?(Next|Type|Why):/.test(l)).join('\n'));
    const problem = lintGuided(stripped, readFileSync(stripped, 'utf8'));
    assert.ok(problem && problem.includes(stripped), `the failure names the file: ${problem}`);
    assert.equal(lintGuided('modes/review.md', real), null, 'the shipped modes/review.md holds the guided lines');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// M-002-S34-osdr
test('M-002-S34-osdr the guided-messages lint list in P1 holds modes apply-loop and inbox and review and handshake plus the setup and batch templates and each passes', async () => {
  const names = LINTED.map((e) => e.name);
  for (const rel of ['modes/apply-loop.md', 'modes/inbox.md', 'modes/review.md', 'modes/handshake.md']) assert.ok(names.includes(rel), rel);
  assert.ok(names.some((n) => /setup/.test(n)) && names.some((n) => /batch/.test(n)));
  const problems = [];
  for (const entry of LINTED) {
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
