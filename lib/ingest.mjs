// The ordered steps that bring new postings into data/pipeline.md. The unattended daily run and the first run share
// this list so the two can never drift apart. Upstream is reached only through its command-line scripts.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { loadMerged } from './presets.mjs';
import { withTempDir } from './temp-dir.mjs';

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
export function ingestStepNames({ sweep = false, feeds = [] } = {}) {
  return ['github-lists', ...feeds, 'scan', ...(sweep ? ['liveness-sweep'] : []), 'merge-post', 'prefilter+triage'];
}

// step(name, fn) runs one step and records its outcome; the caller decides what a failure means.
export function ingestSteps({ root, dataDir, packRoot, today, runner, step, sweep = false, feeds = [] }) {
  const { upstream, pack } = stepRunners({ root, dataDir, packRoot, runner });
  step('github-lists', () => upstream('plugins.mjs', ['run', 'github-lists']));
  for (const id of feeds) step(id, () => upstream('plugins.mjs', ['run', id]));
  // A board fetch that dies mid-scan ("terminated") makes scan.mjs exit non-zero after it has recorded the boards that
  // worked. One more pass reads only what is still unseen, so a flaky board does not cost the student that run. Only an
  // exit the scan chose itself is retried: a STEP_TIMEOUT_MS kill or a signal is not, so the step costs at most one
  // timeout.
  step('scan', () => {
    try {
      return upstream('scan.mjs');
    } catch (err) {
      if (err?.code === 'ETIMEDOUT' || err?.killed || err?.signal) throw err;
      return upstream('scan.mjs');
    }
  });
  if (sweep) step('liveness-sweep', () => pack('liveness-sweep.mjs'));
  step('merge-post', () => pack('merge-post.mjs', ['--today', today]));
  step('prefilter+triage', () => {
    const verdicts = pack('prefilter.mjs');
    if (!verdicts.trim()) return 'no title-level rejects';
    return withTempDir('ingest-triage-', (tmp) => {
      const file = join(tmp, 'prefilter.txt');
      writeFileSync(file, verdicts);
      return pack('apply-triage.mjs', [file]);
    });
  });
}

// Feed plugins besides github-lists that this student's presets ask for and the student enabled. A plugin the
// student has not enabled is left out, so the run does not report a refusal every day.
export function presetFeedPlugins({ root, presets = [] }) {
  const file = join(root, 'config', 'plugins.yml');
  if (!existsSync(file)) return [];
  const enabled = (yaml.load(readFileSync(file, 'utf8')) ?? {}).plugins ?? {};
  const merged = presets.length ? loadMerged(presets) : null;
  return merged?.sources?.nyc_jobs && enabled['nyc-jobs']?.enabled === true ? ['nyc-jobs'] : [];
}
