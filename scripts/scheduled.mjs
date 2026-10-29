// Stub: scheduled entry point; implemented in M-002.
import { defaultRunner } from '../lib/upstream.mjs';

export async function scheduledRun({ root, packRoot, passThrough, claude, runner = defaultRunner, out = (s) => console.log(s) }) {
  throw new Error('scheduledRun: not implemented');
}
