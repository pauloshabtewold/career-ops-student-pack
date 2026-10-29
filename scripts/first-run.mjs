// Stub: first-run report; implemented in M-002.
import { defaultRunner } from '../lib/upstream.mjs';

export async function firstRun({ root, dataDir, packRoot, today, shown = 20, runner = defaultRunner, out = (s) => console.log(s) }) {
  throw new Error('firstRun: not implemented');
}
