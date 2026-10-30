#!/usr/bin/env node
// Installs the pack into a plain career-ops checkout. Run as `node student/install.mjs` from the career-ops folder.
// Writes only inside the career-ops root: local-paths.txt and .git/info/exclude entries, the CLAUDE.local.md import
// block, the generated AGENTS.override.md that Codex reads, and full copies of the pack plugins in plugins.local/. It
// never enables a plugin (consent belongs to the interview) and never touches a Claude Code settings file or a Codex
// config file. It also installs the dependencies the pack needs:
// `npm ci --omit=dev` in the pack folder and, when career-ops has no node_modules yet, `npm install` there;
// --skip-npm leaves those out for tests and offline repairs.
// Usage: install.mjs [--root R] [--dry-run] [--yes] [--skip-npm]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { parseArgs, runCli, isMain } from './lib/args.mjs';
import { refreshOverride } from './lib/agents-override.mjs';
import { compare } from './lib/semver.mjs';
import { resolvePaths } from './lib/paths.mjs';
import { oneLine } from './lib/text.mjs';
import { defaultRunner } from './lib/upstream.mjs';

export class InstallError extends Error {}

// .codex/config.toml is listed so a student's own copy of the suggested Codex config stays out of upstream's commits.
export const LOCAL_PATHS = ['student/', 'CLAUDE.local.md', 'AGENTS.override.md', '.codex/config.toml'];
export const EXCLUDES = ['student/', 'CLAUDE.local.md', 'AGENTS.override.md', '.codex/config.toml', 'config/student.yml'];
export const BLOCK_RE = /<!-- student-pack:start -->[\s\S]*?<!-- student-pack:end -->/;
const BLOCK = '<!-- student-pack:start -->@student/AGENTS.student.md<!-- student-pack:end -->';
const NPM_TIMEOUT_MS = 10 * 60 * 1000;

export function nodeSupported(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  return (major === 22 && minor >= 13) || (major === 23 && minor >= 4) || major > 23;
}

// Adds missing lines, keeping the file's existing line endings and every line already there.
export function addLines(text, lines) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
  const missing = lines.filter((l) => !have.has(l));
  if (!missing.length) return text;
  const lead = text && !text.endsWith('\n') ? eol : '';
  return `${text}${lead}${missing.join(eol)}${eol}`;
}

export function withBlock(text) {
  if (BLOCK_RE.test(text)) return text.replace(BLOCK_RE, BLOCK);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lead = text && !text.endsWith('\n') ? eol : '';
  return `${text}${lead}${BLOCK}${eol}`;
}

// Windows ships npm as npm.cmd, which only starts through a shell.
function npmSteps({ root, packRoot, dryRun, runner, platform, actions, skipNpm }) {
  if (skipNpm) {
    actions.push('npm steps: skipped (--skip-npm)');
    return;
  }
  const win = platform === 'win32';
  const steps = [
    { name: 'npm ci --omit=dev in the pack folder', cwd: packRoot, args: ['ci', '--omit=dev'], skip: null },
    { name: 'npm install in the career-ops folder', cwd: root, args: ['install'], skip: existsSync(join(root, 'node_modules')) ? 'career-ops already has node_modules' : null },
  ];
  for (const step of steps) {
    if (step.skip) {
      actions.push(`${step.name}: skipped, ${step.skip}`);
      continue;
    }
    actions.push(step.name);
    if (dryRun) continue;
    try {
      runner(win ? 'npm.cmd' : 'npm', step.args, { cwd: step.cwd, timeout: NPM_TIMEOUT_MS, ...(win ? { shell: true } : {}) });
    } catch (err) {
      const first = oneLine(err.stderr || err.message) || 'failed';
      throw new InstallError(`${step.name} failed (${first}); run "npm ${step.args.join(' ')}" in ${step.cwd} by hand, then run this again`);
    }
  }
}

// Throws InstallError for an unsupported Node, a missing git or a failed npm step. With dryRun it returns the planned
// actions and changes nothing.
export function install({ root, packRoot, dryRun = false, runner = defaultRunner, nodeVersion, platform = process.platform, skipNpm = false }) {
  if (!nodeSupported(nodeVersion)) throw new InstallError('Node 22.13 or newer is required: install it from nodejs.org, then run this again');
  try {
    runner('git', ['--version']);
  } catch {
    throw new InstallError('git is required: install it, then run this again');
  }
  const pkgFile = join(root, 'package.json');
  const isUpstream = existsSync(pkgFile) && existsSync(join(root, 'update-system.mjs')) && JSON.parse(readFileSync(pkgFile, 'utf8')).name === 'career-ops';
  if (!isUpstream) throw new InstallError(`${root} is not a career-ops checkout: clone the pack into the student folder of your career-ops clone`);
  const compat = JSON.parse(readFileSync(join(packRoot, 'compat.json'), 'utf8'));
  const version = JSON.parse(readFileSync(pkgFile, 'utf8')).version;
  if (compare(version, compat.upstream.min) < 0) {
    throw new InstallError(`career-ops ${version} is older than ${compat.upstream.min}: run "node update-system.mjs apply --confirm" in the career-ops folder, then run this again`);
  }

  const actions = [];
  npmSteps({ root, packRoot, dryRun, runner, platform, actions, skipNpm });
  const inside = (file) => {
    const rel = relative(root, file);
    if (rel.startsWith('..') || resolve(file) !== file) throw new InstallError(`refusing to write outside ${root}`);
    return file;
  };
  const edit = (file, update, label) => {
    const target = inside(file);
    const before = existsSync(target) ? readFileSync(target, 'utf8') : '';
    const after = update(before);
    if (after === before) return;
    actions.push(label);
    if (!dryRun) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, after);
    }
  };
  edit(join(root, 'config', 'local-paths.txt'), (t) => addLines(t, LOCAL_PATHS), 'config/local-paths.txt: added pack paths');
  edit(join(root, '.git', 'info', 'exclude'), (t) => addLines(t, EXCLUDES), '.git/info/exclude: added pack entries');
  edit(join(root, 'CLAUDE.local.md'), withBlock, 'CLAUDE.local.md: wrote the pack import block');
  const override = refreshOverride({ root, packRoot, dryRun });
  if (override.status === 'created' || override.status === 'updated') actions.push('AGENTS.override.md: wrote the pack block and the career-ops AGENTS.md copy');
  else if (override.line) actions.push(override.line);

  const pluginsDir = join(packRoot, 'plugins');
  const ids = existsSync(pluginsDir) ? readdirSync(pluginsDir).filter((d) => existsSync(join(pluginsDir, d, 'manifest.json'))) : [];
  for (const id of ids) {
    const dest = inside(join(root, 'plugins.local', id));
    actions.push(`plugins.local${sep}${id}: copied (not enabled)`);
    if (!dryRun) cpSync(join(pluginsDir, id), dest, { recursive: true, force: true });
  }
  return { actions, plugins: ids };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { yes: 'boolean', 'skip-npm': 'boolean' } });
  const paths = resolvePaths({ root: flags.root });
  try {
    const res = install({ root: paths.root, packRoot: paths.packRoot, dryRun: flags.dryRun, skipNpm: flags.skipNpm });
    for (const a of res.actions) console.log(`${flags.dryRun ? 'would do' : 'done'}: ${a}`);
    console.log('Next: open the career-ops folder in Claude Code, or in Codex (see student/docs/codex.md), and say hello; the personalization interview starts by itself.');
    return 0;
  } catch (err) {
    if (err instanceof InstallError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
}

if (isMain(import.meta.url)) await runCli(main);
