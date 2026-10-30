// Finds an executable on PATH without a shell, so a scheduled job can be given an absolute path. env and platform
// are parameters so tests can describe a Windows PATH on any machine.
import { statSync } from 'node:fs';
import { join } from 'node:path';

// statSync throws for a missing path; a directory named like the program does not count as a match.
const isFile = (file) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

// Returns the first matching absolute path, or null. On win32 only PATHEXT suffixes (.exe and .cmd always) are tried;
// the bare name is tried only when it already ends in one, because an npm-global install puts an extensionless sh shim
// named `claude` next to claude.cmd and a process cannot start that shim.
export function which(name, { env = process.env, platform = process.platform } = {}) {
  const win = platform === 'win32';
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const dirs = String(env[pathKey] ?? '').split(win ? ';' : ':').map((d) => d.replace(/^"|"$/g, '')).filter(Boolean);
  const pathExt = [...new Set([...String(env.PATHEXT ?? '').split(';').filter(Boolean).map((e) => e.toLowerCase()), '.exe', '.cmd'])];
  const suffixes = win ? (pathExt.some((e) => name.toLowerCase().endsWith(e)) ? [''] : pathExt) : [''];
  for (const dir of dirs) {
    for (const suffix of suffixes) {
      const candidate = join(dir, `${name}${suffix}`);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}
