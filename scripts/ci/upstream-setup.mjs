#!/usr/bin/env node
// CI helper: builds a throwaway career-ops checkout at a released tag, installs the pack into it, applies a
// synthetic answers file and writes doctor.json. Used by ci.yml, canary.yml and audit-presets.yml.
// Usage: upstream-setup.mjs --out <new dir> [--version X.Y.Z] [--pack <dir>] [--answers <file>] [--resume <file>]
//   --version defaults to compat.json upstream.max. Prints the checkout path on the last line.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, runCli } from '../../lib/args.mjs';

const UPSTREAM_REPO = 'https://github.com/career-ops-hq/career-ops';
const PACK_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export const defaultRunner = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true, maxBuffer: 64 * 1024 * 1024, ...opts });

// npm is a .cmd file on Windows and cannot be spawned directly, so it is run through its own entry script.
export function npmCli() {
  const bin = dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath?.endsWith('npm-cli.js') ? process.env.npm_execpath : null,
    join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter(Boolean);
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error('npm-cli.js not found next to this node');
  return found;
}

export function setupUpstream({ out, version, pack = PACK_ROOT, answers = join('tests', 'fixtures', 'answers', 'cs.json'), resume = join('tests', 'fixtures', 'resumes', 'cs.md'), runner = defaultRunner }) {
  const dest = resolve(out);
  if (existsSync(dest) && readdirSync(dest).length) throw new UsageError('--out exists and is not empty');
  mkdirSync(dirname(dest), { recursive: true });
  const compat = JSON.parse(readFileSync(join(pack, 'compat.json'), 'utf8'));
  const tag = `${compat.upstream.tag_prefix}${version ?? compat.upstream.max}`;
  runner('git', ['clone', '--depth', '1', '--branch', tag, UPSTREAM_REPO, dest]);
  runner(process.execPath, [npmCli(), 'install', '--no-audit', '--no-fund'], { cwd: dest, env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' } });
  const student = join(dest, 'student');
  cpSync(pack, student, { recursive: true, filter: (src) => !['.git', 'node_modules'].includes(basename(src)) });
  runner(process.execPath, [join('student', 'install.mjs'), '--yes'], { cwd: dest });
  runner(process.execPath, [join('student', 'interview', 'apply-answers.mjs'), join(student, answers)], { cwd: dest });
  // A real student gets cv.md from the interview; doctor requires it, so the synthetic setup supplies a fixture resume.
  copyFileSync(join(student, resume), join(dest, 'cv.md'));
  const doctor = join(dest, 'doctor.json');
  writeFileSync(doctor, runner(process.execPath, ['doctor.mjs', '--json'], { cwd: dest }));
  return { dest, doctor, tag };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { common: false, flags: { out: 'string', version: 'string', pack: 'string', answers: 'string', resume: 'string' } });
  if (!flags.out) throw new UsageError('--out <dir> is required');
  const res = setupUpstream({ out: flags.out, version: flags.version, pack: flags.pack ? resolve(flags.pack) : PACK_ROOT, answers: flags.answers, resume: flags.resume });
  console.log(res.dest);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(main);
