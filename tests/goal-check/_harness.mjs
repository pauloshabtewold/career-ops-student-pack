// Offline harness for the goal-check tests: a fake upstream, an optional modified copy of the pack, and a CLI runner.
// Everything is synthetic. Nothing here reads a real career-ops checkout or touches the network.
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFakeUpstream } from '../helpers/fake-upstream.mjs';

export const PACK_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const TODAY = '2026-10-27';
export const SETS = ['cs', 'finance', 'mechanical', 'mis', 'nursing'];

const dirs = [];
export function tmp(prefix = 'goal-check-test-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
export function cleanupAll() {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

const PACK_ITEMS = ['lib', 'scripts', 'interview', 'presets', 'plugins', 'templates', 'modes', 'tools', 'compat.json', 'package.json', 'install.mjs', 'update.mjs', 'AGENTS.student.md'];

// A copy of the pack in a temp dir so a test can break one fixture without touching the repo.
export function copyPack() {
  const root = tmp('goal-check-pack-');
  for (const item of PACK_ITEMS) if (existsSync(join(PACK_ROOT, item))) cpSync(join(PACK_ROOT, item), join(root, item), { recursive: true });
  mkdirSync(join(root, 'tests', 'fixtures'), { recursive: true });
  for (const sub of ['answers', 'resumes', 'goal-check']) cpSync(join(PACK_ROOT, 'tests', 'fixtures', sub), join(root, 'tests', 'fixtures', sub), { recursive: true });
  symlinkSync(realpathSync(nearestModules(PACK_ROOT)), join(root, 'node_modules'));
  return root;
}

function nearestModules(from) {
  for (let d = from; ; d = dirname(d)) {
    if (existsSync(join(d, 'node_modules'))) return join(d, 'node_modules');
    if (dirname(d) === d) throw new Error('no node_modules found');
  }
}

export function setup({ pack = PACK_ROOT } = {}) {
  const up = createFakeUpstream({ version: '1.38.0' });
  dirs.push(up.root);
  const scratch = join(tmp('goal-check-scratch-'), 'work');
  const report = join(tmp('goal-check-report-'), 'report.md');
  const argv = ['--upstream', up.root, '--scratch', scratch, '--feeds', 'fixtures', '--today', TODAY, '--report', report];
  return { up, scratch, report, argv, cli: join(pack, 'tools', 'goal-check.mjs'), cwd: pack };
}

export function run(s, extra = []) {
  const out = spawnSync(process.execPath, [s.cli, ...s.argv, ...extra], { cwd: s.cwd, encoding: 'utf8', timeout: 280000 });
  const reportText = existsSync(s.report) ? readFileSync(s.report, 'utf8') : '';
  return { code: out.status, stdout: out.stdout ?? '', stderr: out.stderr ?? '', reportText };
}

export function runAsync(s) {
  const child = spawn(process.execPath, [s.cli, ...s.argv], { cwd: s.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const done = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { child, done };
}

// Data rows of the first markdown table that has a verdict column: cells are row, deciding check, verdict, counts.
export function tableRows(text) {
  return text
    .split('\n')
    .filter((l) => l.trim().startsWith('|') && !/^\|\s*-{2,}/.test(l.trim()) && !/^\|\s*row\b/i.test(l.trim()) && !/^\|\s*stage\b/i.test(l.trim()))
    .map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()));
}

export const isVerdict = (c) => c === 'met' || c === 'not met';

export function writeFile(root, rel, text) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}
