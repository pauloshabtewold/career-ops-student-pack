// Scratch folder that is gone when the work is done, whether fn returns, throws, or (for an async fn) settles.
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
