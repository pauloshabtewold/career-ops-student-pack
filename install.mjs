#!/usr/bin/env node
// Installs the pack into a plain career-ops checkout. Run as `node student/install.mjs` from the career-ops folder.
// Writes only inside the career-ops root: local-paths.txt and .git/info/exclude entries, the CLAUDE.local.md import
// block, and full copies of the pack plugins in plugins.local/. It never enables a plugin (consent belongs to the
// interview) and never touches a Claude Code settings file. Usage: install.mjs [--root R] [--dry-run] [--yes]
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runCli } from './lib/args.mjs';
import { compare } from './lib/semver.mjs';
import { resolvePaths } from './lib/paths.mjs';
import { defaultRunner } from './lib/upstream.mjs';

export class InstallError extends Error {}

const LOCAL_PATHS = ['student/', 'CLAUDE.local.md'];
const EXCLUDES = ['student/', 'CLAUDE.local.md', 'config/student.yml'];
const BLOCK_RE = /<!-- student-pack:start -->[\s\S]*?<!-- student-pack:end -->/;
const BLOCK = '<!-- student-pack:start -->@student/AGENTS.student.md<!-- student-pack:end -->';

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

export function install({ root, packRoot, dryRun = false, runner = defaultRunner, nodeVersion }) {
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
  const { flags } = parseArgs(process.argv.slice(2), { flags: { yes: 'boolean' } });
  const paths = resolvePaths({ root: flags.root });
  try {
    const res = install({ root: paths.root, packRoot: paths.packRoot, dryRun: flags.dryRun });
    for (const a of res.actions) console.log(`${flags.dryRun ? 'would do' : 'done'}: ${a}`);
    console.log('Next: open the career-ops folder in Claude Code and say hello; the personalization interview starts by itself.');
    return 0;
  } catch (err) {
    if (err instanceof InstallError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
}

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) await runCli(main);
