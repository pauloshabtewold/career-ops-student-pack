// budget.mjs holds the hard limits, so it must match what the pack shipped. Two checks run together:
// its hash against compat.json, and both files against the committed HEAD. The hash alone is not enough because
// someone can edit budget.mjs and compat.json together; comparing against HEAD catches that case.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultRunner } from './upstream.mjs';

const GUARDED = ['scripts/budget.mjs', 'compat.json'];

function hashMatches(packRoot) {
  const compat = JSON.parse(readFileSync(join(packRoot, 'compat.json'), 'utf8'));
  const actual = createHash('sha256').update(readFileSync(join(packRoot, 'scripts', 'budget.mjs'))).digest('hex');
  return actual === compat.budgetSha256;
}

function matchesHead(packRoot, runner) {
  try {
    runner('git', ['-C', packRoot, 'diff', '--quiet', 'HEAD', '--', ...GUARDED]);
    return true;
  } catch {
    return false;
  }
}

export function verifyAndRestore({ packRoot, runner = defaultRunner }) {
  let hashOk = false;
  try {
    hashOk = hashMatches(packRoot);
  } catch {
    hashOk = false;
  }
  if (hashOk && matchesHead(packRoot, runner)) return { ok: true, restored: false, message: '' };
  try {
    runner('git', ['-C', packRoot, 'checkout', '--', ...GUARDED]);
  } catch (err) {
    return { ok: false, restored: false, message: `integrity check failed and restore did not work: ${String(err.message).split('\n')[0]}` };
  }
  return { ok: true, restored: true, message: 'budget.mjs or compat.json was changed; restored the shipped files' };
}
