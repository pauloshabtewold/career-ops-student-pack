// Stub so the M-001 tests fail on behaviour; M-001 replaces every body.
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const PACK_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const PROBE_LABEL = 'career-ops.chrome-probe';
export const PROBE_FILE = '.chrome-probe.json';
export const WAIT_MS = 90 * 1000;

const todo = () => {
  throw new Error('not implemented');
};

export function probePlist({ nodePath, packRoot, out }) {
  return todo(nodePath, packRoot, out);
}
export function systemScheduler({ platform = process.platform, home = homedir() } = {}) {
  return todo(platform, home);
}
export function readProbe(file) {
  return todo(file);
}
export async function probe({ root, dataDir, packRoot = PACK_ROOT, scheduler, now = Date.now, wait = sleep, nodePath = process.execPath, spikeDoc = join(packRoot, 'docs', 'chrome-spike.md'), today = new Date().toISOString().slice(0, 10), say = console.log }) {
  return todo(root, dataDir, packRoot, scheduler, now, wait, nodePath, spikeDoc, today, say);
}
export async function main(argv = process.argv.slice(2)) {
  return todo(argv);
}
