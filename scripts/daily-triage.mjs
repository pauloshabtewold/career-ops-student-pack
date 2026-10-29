// Stub: unattended triage through claude -p; implemented in M-002.
import { defaultRunner } from '../lib/upstream.mjs';

export async function dailyTriage({ root, dataDir, packRoot, today, runner = defaultRunner, claude = null, say = () => {} }) {
  throw new Error('dailyTriage: not implemented');
}
