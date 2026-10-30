// Removes the directory when fn returns, throws or its promise settles, so no call site leaks one.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function withTempDir(prefix, fn) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const remove = () => rmSync(dir, { recursive: true, force: true });
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
