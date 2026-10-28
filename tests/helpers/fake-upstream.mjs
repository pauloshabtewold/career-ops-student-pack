// Builds a temp directory shaped like an upstream career-ops checkout, with stub CLIs that record
// their argv, so tests exercise the child_process boundary without importing or needing upstream.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const STUB_CLIS = [
  'update-system.mjs',
  'doctor.mjs',
  'plugins.mjs',
  'set-status.mjs',
  'check-liveness.mjs',
  'audit-portals.mjs',
  'scan.mjs',
  'paste-reply.mjs',
];

const STUB_SOURCE = (name) => `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
appendFileSync(join(here, 'calls.jsonl'), JSON.stringify({ cli: ${JSON.stringify(name)}, argv: process.argv.slice(2) }) + '\\n');
const scripted = join(here, '.stub-' + ${JSON.stringify(name)} + '.json');
if (existsSync(scripted)) {
  const { stdout, code } = JSON.parse(readFileSync(scripted, 'utf8'));
  process.stdout.write(stdout);
  process.exit(code);
}
`;

export function createFakeUpstream({ version = '1.38.0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'fake-upstream-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'career-ops', version, type: 'module' }, null, 2)}\n`);
  for (const d of ['data', 'config', 'modes', 'plugins.local']) mkdirSync(join(root, d), { recursive: true });
  writeFileSync(join(root, 'portals.yml'), 'tracked_companies: []\n');
  for (const cli of STUB_CLIS) writeFileSync(join(root, cli), STUB_SOURCE(cli));
  const callsFile = join(root, 'calls.jsonl');
  writeFileSync(callsFile, '');
  return {
    root,
    calls() {
      return readFileSync(callsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    },
    setOutput(cli, stdout, code = 0) {
      const name = cli.endsWith('.mjs') ? cli : `${cli}.mjs`;
      if (!STUB_CLIS.includes(name)) throw new Error(`no stub CLI named ${name}`);
      writeFileSync(join(root, `.stub-${name}.json`), JSON.stringify({ stdout, code }));
    },
    has(rel) {
      return existsSync(join(root, rel));
    },
    log(line) {
      appendFileSync(callsFile, `${line}\n`);
    },
  };
}
