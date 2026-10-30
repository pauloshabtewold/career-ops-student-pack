// Two process-runner contracts, one per caller need.
// runText throws: it returns stdout as text and raises the execFileSync error (status, stdout, stderr) on failure.
// runResult never throws: it returns { code, stdout, stderr, error } so a caller that keeps partial output can read
// it after a non-zero exit. Both run with stdin ignored and no console window on Windows.
import { execFileSync } from 'node:child_process';

export const runText = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...opts });

export const gitRunner = (args, { cwd }) => runText('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });

export function runResult(cmd, args, opts = {}) {
  try {
    return { code: 0, stdout: runText(cmd, args, opts), stderr: '', error: null };
  } catch (err) {
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? ''), error: err };
  }
}
