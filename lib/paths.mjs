// Path resolution for a pack that lives in student/ inside an upstream career-ops clone.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolvePaths({ root, dataDir } = {}) {
  const packRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const rootDir = resolve(root ?? dirname(packRoot));
  return {
    packRoot,
    root: rootDir,
    dataDir: resolve(dataDir ?? join(rootDir, 'data')),
    configDir: join(rootDir, 'config'),
    modesDir: join(rootDir, 'modes'),
    // Upstream keeps portals.yml at the repository root, not under config/.
    portalsFile: join(rootDir, 'portals.yml'),
  };
}
