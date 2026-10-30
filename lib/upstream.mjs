// Upstream career-ops is reached only through its command-line scripts, run as child processes with cwd at the
// upstream root. Importing upstream modules would tie the pack to internals that change without notice.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runText } from './run.mjs';

export const defaultRunner = runText;

function lastJsonLine(stdout) {
  const line = stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{')).pop();
  if (!line) throw new Error('expected a JSON line in upstream output');
  return JSON.parse(line);
}

export function createUpstream({ root, runner = defaultRunner }) {
  const node = (script, args = []) => runner(process.execPath, [join(root, script), ...args], { cwd: root });
  return {
    version: () => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
    updateCheck: () => lastJsonLine(node('update-system.mjs', ['check'])),
    updateApply: () => node('update-system.mjs', ['apply', '--confirm']),
    updateDismiss: (version) => node('update-system.mjs', ['dismiss', '--version', version]),
    doctor: () => lastJsonLine(node('doctor.mjs', ['--json'])),
    pluginsTrust: (id) => node('plugins.mjs', ['trust', id]),
    pluginsList: () => node('plugins.mjs', ['list']),
    pluginsRun: (id) => node('plugins.mjs', ['run', id]),
    setStatus: (args) => node('set-status.mjs', args),
    checkLiveness: (args) => node('check-liveness.mjs', args),
    auditPortals: (args) => node('audit-portals.mjs', args),
  };
}
