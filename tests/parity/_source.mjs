// Synthetic upstream checkout and student config for the parity tests. Everything here is invented.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACK_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const PARITY_CLI = join(PACK_ROOT, 'tools', 'parity.mjs');

export const FIXTURE_URL = 'https://jobs.example.com/openings/zeta-4471';
export const FIXTURE_COMPANY = 'Zeta Quantum Widgets';
export const FIXTURE_TITLE = 'Quantum Widget Intern';

export const PENDING_ROW = `- [ ] ${FIXTURE_URL} | ${FIXTURE_COMPANY} | ${FIXTURE_TITLE} | Remote | note: src=example`;

const tmpDirs = [];
export function tmp(prefix = 'parity-test-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
export function cleanupTmp() {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

function put(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

export const BASELINE_STAGE_SCRIPTS = ['cycle.mjs', 'prefilter.mjs', 'apply-triage.mjs', 'merge-staging.mjs', 'rank-queue.mjs', 'fail-audit.mjs', 'handshake-import.mjs'];

// A small fake career-ops checkout: data/, portals.yml, modes/, a stub script and a .git marker.
export function makeSource() {
  const dir = tmp('parity-source-');
  put(dir, 'data/pipeline.md', `# Pipeline\n\n## Pending\n\n${PENDING_ROW}\n\n## Flagged\n\n## Skipped\n\n## Processed\n`);
  put(dir, 'data/applications.md', '# Applications\n');
  put(dir, 'portals.yml', 'title_filter:\n  positive: [intern]\n');
  put(dir, 'modes/_shared.md', '# Shared mode\n');
  put(dir, 'merge-tracker.mjs', "console.log('stub');\n");
  for (const name of BASELINE_STAGE_SCRIPTS) put(dir, `local/${name}`, "console.log('stub');\n");
  put(dir, '.git/HEAD', 'ref: refs/heads/main\n');
  return dir;
}

export function makeStudentConfig() {
  const dir = tmp('parity-config-');
  const file = join(dir, 'student.yml');
  cpSync(join(PACK_ROOT, 'tests', 'fixtures', 'parity', 'student.yml'), file);
  return file;
}

export function makeStudentConfigText(text) {
  const dir = tmp('parity-config-');
  const file = join(dir, 'student.yml');
  writeFileSync(file, text);
  return file;
}

export const CYCLE_JSON = JSON.stringify({
  computed_at: '2026-10-27T12:00:00.000Z',
  today: '2026-10-27',
  phase: 'student',
  terms: [{ name: 'Summer', year: 2027, start: '2027-06-01' }],
  newgrad_years: [2027],
  internship_years: [2027],
  experience_ceiling_years: 1,
});

// Per-stage successful runner: valid pack-schema cycle JSON for cycle, an empty pick list for rank-queue and
// fail-audit, and the synthetic pending row for every other stage.
export async function okRunner({ stage }) {
  const stdout = stage === 'cycle' ? `${CYCLE_JSON}\n` : stage === 'rank-queue' || stage === 'fail-audit' ? '[]\n' : `${PENDING_ROW}\n`;
  return { code: 0, status: 0, stdout, stderr: '', output: stdout };
}

export function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const ent of readdirSync(d, { withFileTypes: true })) {
      const abs = join(d, ent.name);
      if (ent.isDirectory()) walk(abs);
      else out[relative(dir, abs).split('\\').join('/')] = readFileSync(abs, 'utf8');
    }
  };
  walk(dir);
  return out;
}

export { existsSync, cpSync };
