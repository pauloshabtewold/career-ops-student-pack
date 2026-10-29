// The ordered steps that bring new postings into data/pipeline.md. The unattended daily run and the first run share
// this list so the two can never drift apart. Upstream is reached only through its command-line scripts.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Ceiling for one child step. A step that runs past it is killed and recorded as failed; the later steps still run.
export const STEP_TIMEOUT_MS = 30 * 60 * 1000;

// Child-process helpers rooted at the career-ops folder: one for upstream scripts, one for pack scripts.
export function stepRunners({ root, dataDir, packRoot, runner }) {
  return {
    upstream: (script, args = []) => runner(process.execPath, [join(root, script), ...args], { cwd: root, timeout: STEP_TIMEOUT_MS }),
    pack: (script, args = []) => runner(process.execPath, [join(packRoot, 'scripts', script), ...args, '--root', root, '--data-dir', dataDir], { cwd: root, timeout: STEP_TIMEOUT_MS }),
  };
}

// sweep adds the weekly liveness check between the scan and the merge; the first run has no postings old enough to sweep.
export function ingestStepNames({ sweep = false } = {}) {
  return ['github-lists', 'scan', ...(sweep ? ['liveness-sweep'] : []), 'merge-post', 'prefilter+triage'];
}

// step(name, fn) runs one step and records its outcome; the caller decides what a failure means.
export function ingestSteps({ root, dataDir, packRoot, today, runner, step, sweep = false }) {
  const { upstream, pack } = stepRunners({ root, dataDir, packRoot, runner });
  step('github-lists', () => upstream('plugins.mjs', ['run', 'github-lists']));
  step('scan', () => upstream('scan.mjs'));
  if (sweep) step('liveness-sweep', () => pack('liveness-sweep.mjs'));
  step('merge-post', () => pack('merge-post.mjs', ['--today', today]));
  step('prefilter+triage', () => {
    const verdicts = pack('prefilter.mjs');
    if (!verdicts.trim()) return 'no title-level rejects';
    const tmp = mkdtempSync(join(tmpdir(), 'ingest-triage-'));
    try {
      const file = join(tmp, 'prefilter.txt');
      writeFileSync(file, verdicts);
      return pack('apply-triage.mjs', [file]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}
