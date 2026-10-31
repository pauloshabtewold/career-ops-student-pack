// Removes the directory when fn returns, throws or its promise settles, so no call site leaks one. Removal retries and
// never throws: on Windows an antivirus scan or a lingering child can hold the folder briefly (EBUSY/EPERM), and a
// leftover temp folder must not replace a result the caller already has.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function withTempDir(prefix, fn) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const remove = () => {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      // the OS temp cleaner removes it later
    }
  };
  let result;
  try {
    result = fn(dir);
  } catch (err) {
    remove();
    throw err;
  }
  if (typeof result?.then === 'function') return result.finally(remove);
  remove();
  return result;
}
