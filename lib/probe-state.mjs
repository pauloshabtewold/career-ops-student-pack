// Why chrome_in_schedule has its value: the last schedule probe's outcome in data/chrome-probe-state.json, written by
// tools/schedule-probe.mjs and by setup when it records no for a probe that could not answer. A value set because the
// probe timed out or its job could not be installed says nothing about reach, so the digest offers to check again.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from './tsv.mjs';

export const PROBE_STATE_FILE = 'chrome-probe-state.json';
// answered: the scheduled child wrote a result; timeout: no result within the wait; install-failed: the probe job could
// not be installed; chrome-closed: the automation Chrome was not open; no-probe: setup recorded no without a probe run.
export const PROBE_REASONS = Object.freeze(['answered', 'timeout', 'install-failed', 'chrome-closed', 'no-probe']);
const UNSURE = new Set(['timeout', 'install-failed']);

export function readProbeState(dataDir) {
  const file = join(dataDir, PROBE_STATE_FILE);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeProbeState(dataDir, { value, reason, date }) {
  mkdirSync(dataDir, { recursive: true });
  writeAtomic(join(dataDir, PROBE_STATE_FILE), `${JSON.stringify({ value, reason, date }, null, 2)}\n`);
}

// True when the last probe could not tell (timeout or a failed job install), so a re-check is worth offering.
export const probeUnsure = (dataDir) => UNSURE.has(readProbeState(dataDir)?.reason);

// The offer every unsure no carries, and the reply that re-runs tools/schedule-probe.mjs.
export const RECHECK_PROMPT = "check my schedule's Chrome";
export const RECHECK_OFFER = `I'll check again whether your schedule can reach Chrome, approve? Type: ${RECHECK_PROMPT}`;
