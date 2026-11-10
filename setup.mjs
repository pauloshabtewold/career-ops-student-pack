#!/usr/bin/env node
// One-command setup for a fresh student: run as `node student/setup.mjs` from the career-ops folder.
// Steps, in order: refuse a cloud-synced folder, check Node/git/checkout, pin career-ops to the newest tested release,
// run install.mjs, copy the suggested Codex and Claude Code project configs when missing (never overwriting a
// student's changed copy), install the Playwright browser, and verify the generated files exist.
// Usage: setup.mjs [--root R] [--dry-run] [--skip-playwright]
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs, runCli, isMain } from './lib/args.mjs';
import { resolvePaths } from './lib/paths.mjs';
import { oneLine } from './lib/text.mjs';
import { defaultRunner } from './lib/upstream.mjs';
import { InstallError, checkPrereqs, install } from './install.mjs';

const NPM_TIMEOUT_MS = 10 * 60 * 1000;
const PLAYWRIGHT_TIMEOUT_MS = 15 * 60 * 1000;
const CODEX_TEMPLATE = 'templates/codex-config.suggested.toml';
const CLAUDE_TEMPLATE = 'templates/claude-settings.suggested.json';

const slashed = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '');

// The name of the cloud sync provider that holds path, or null. home and exists are injected so tests need no real
// home folder.
export function syncedFolder(path, { home = homedir(), platform = process.platform, exists = existsSync } = {}) {
  const p = slashed(path);
  const h = slashed(home);
  const lower = p.toLowerCase();
  const under = (dir) => {
    const d = `${h}/${dir}`.toLowerCase();
    return lower === d || lower.startsWith(`${d}/`);
  };
  if (platform === 'darwin') {
    if (under('Library/Mobile Documents')) return 'iCloud Drive';
    const cloudDocs = join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs');
    if ((under('Desktop') || under('Documents')) && (exists(join(cloudDocs, 'Desktop')) || exists(join(cloudDocs, 'Documents')))) {
      return 'iCloud Drive (Desktop & Documents)';
    }
    if (under('Library/CloudStorage')) return 'a cloud storage provider (Google Drive, Dropbox or OneDrive)';
  }
  for (const seg of p.split('/')) {
    const s = seg.toLowerCase();
    if (s.startsWith('onedrive')) return 'OneDrive';
    if (s === 'dropbox') return 'Dropbox';
    if (s === 'google drive' || s === 'my drive') return 'Google Drive';
  }
  return null;
}

const win = (platform) => platform === 'win32';
const sh = (platform) => (win(platform) ? { shell: true } : {});

function failure(err) {
  return oneLine(err.stderr || err.message) || 'failed';
}

function pinCareerOps({ root, packRoot, pkgFile, dryRun, runner, platform, lines }) {
  const { upstream } = JSON.parse(readFileSync(join(packRoot, 'compat.json'), 'utf8'));
  const tag = `${upstream.tag_prefix}${upstream.max}`;
  const version = JSON.parse(readFileSync(pkgFile, 'utf8')).version;
  if (version === upstream.max) {
    lines.push(`skipped: career-ops is already at ${upstream.max}`);
    return;
  }
  const git = (args, opts = {}) => runner('git', args, { cwd: root, ...opts });
  let dirty;
  try {
    dirty = String(git(['status', '--porcelain', '--untracked-files=no'])).trim();
  } catch (err) {
    throw new InstallError(`git status failed in ${root} (${failure(err)}); fix the folder, then run this again`);
  }
  if (dirty) throw new InstallError(`career-ops has changed tracked files (${oneLine(dirty)}); commit or undo those changes (or run "git checkout ." in ${root}), then run this again`);
  let haveTag = true;
  try {
    git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`]);
  } catch {
    haveTag = false;
  }
  const steps = [];
  if (!haveTag) steps.push(['fetch', `git fetch --tags origin (tag ${tag} is missing locally)`, ['fetch', '--tags', 'origin']]);
  steps.push(['checkout', `git checkout -B main ${tag}`, ['checkout', '-B', 'main', tag]]);
  for (const [, label, args] of steps) {
    if (dryRun) {
      lines.push(`would do: ${label}`);
      continue;
    }
    try {
      git(args, { timeout: NPM_TIMEOUT_MS });
    } catch (err) {
      throw new InstallError(`${label} failed (${failure(err)}); check your internet connection and run this again`);
    }
    lines.push(`done: ${label}`);
  }
  const label = `npm install in ${root} (dependencies of career-ops ${upstream.max})`;
  if (dryRun) {
    lines.push(`would do: ${label}`);
    return;
  }
  try {
    runner(win(platform) ? 'npm.cmd' : 'npm', ['install'], { cwd: root, timeout: NPM_TIMEOUT_MS, ...sh(platform) });
  } catch (err) {
    throw new InstallError(`npm install failed in ${root} (${failure(err)}); run "npm install" there by hand, then run this again`);
  }
  lines.push(`done: ${label}`);
}

const eolless = (t) => t.replace(/\r\n/g, '\n');

function codexConfig({ root, packRoot, dryRun, lines }) {
  const dest = join(root, '.codex', 'config.toml');
  const want = readFileSync(join(packRoot, CODEX_TEMPLATE), 'utf8');
  if (!existsSync(dest)) {
    if (!dryRun) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, want);
    }
    lines.push(`${dryRun ? 'would do' : 'done'}: .codex/config.toml: wrote the suggested Codex config`);
  } else if (eolless(readFileSync(dest, 'utf8')) === eolless(want)) {
    lines.push('skipped: .codex/config.toml already matches the suggested Codex config');
  } else {
    lines.push(`skipped: .codex/config.toml kept as you have it; it differs from student/${CODEX_TEMPLATE}, so compare the two files and keep the Gmail send/delete/archive block (the [apps.connector_...] enabled = false entries)`);
  }
}

function claudeSettings({ root, packRoot, dryRun, lines }) {
  const dest = join(root, '.claude', 'settings.local.json');
  const want = JSON.parse(readFileSync(join(packRoot, CLAUDE_TEMPLATE), 'utf8'));
  const write = (obj) => {
    if (dryRun) return;
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, `${JSON.stringify(obj, null, 2)}\n`);
  };
  const verb = dryRun ? 'would do' : 'done';
  if (!existsSync(dest)) {
    write(want);
    lines.push(`${verb}: .claude/settings.local.json: wrote the suggested Claude Code permissions`);
    return;
  }
  let have;
  try {
    have = JSON.parse(readFileSync(dest, 'utf8'));
  } catch {
    have = null;
  }
  const allow = have?.permissions?.allow;
  const plain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
  if (!plain(have) || (have.permissions !== undefined && !plain(have.permissions)) || (allow !== undefined && !Array.isArray(allow))) {
    lines.push('skipped: .claude/settings.local.json kept as you have it; it is not valid JSON of the expected shape, so add the entries from student/templates/claude-settings.suggested.json by hand');
    return;
  }
  const known = new Set(allow ?? []);
  const missing = want.permissions.allow.filter((e) => !known.has(e));
  if (!missing.length) {
    lines.push('skipped: .claude/settings.local.json already has the suggested Claude Code permissions');
    return;
  }
  have.permissions = { ...(have.permissions ?? {}), allow: [...(allow ?? []), ...missing] };
  write(have);
  lines.push(`${verb}: .claude/settings.local.json: added ${missing.length} missing permission entries, kept everything else`);
}

function playwright({ root, dryRun, skip, runner, platform, lines }) {
  if (skip) {
    lines.push('skipped: playwright chromium install (--skip-playwright)');
    return;
  }
  if (dryRun) {
    lines.push(`would do: npx playwright install chromium in ${root}`);
    return;
  }
  try {
    runner(win(platform) ? 'npx.cmd' : 'npx', ['playwright', 'install', 'chromium'], { cwd: root, timeout: PLAYWRIGHT_TIMEOUT_MS, ...sh(platform) });
    lines.push('done: playwright chromium installed');
  } catch (err) {
    lines.push(`warning: playwright chromium install failed (${failure(err)}); run "npx playwright install chromium" in ${root} later`);
  }
}

// Returns the output lines. Throws InstallError for a synced folder, a failed prerequisite, a dirty checkout, a failed
// pin or install step, or a missing generated file. With dryRun it changes nothing.
export function setup({
  root, packRoot, dryRun = false, skipPlaywright = false, runner = defaultRunner, nodeVersion,
  platform = process.platform, home = homedir(), exists = existsSync,
}) {
  const lines = [];
  let real = root;
  try {
    real = realpathSync.native(root);
  } catch {
    // a root that does not exist fails the checkout test below
  }
  const provider = syncedFolder(real, { home, platform, exists });
  if (provider) {
    throw new InstallError(`${real} is inside ${provider}, which breaks git and node_modules: clone career-ops into ${join(home, 'career-ops')} instead, then run this again`);
  }
  lines.push('done: folder is not inside a cloud-synced location');
  const pkgFile = checkPrereqs({ root: real, runner, nodeVersion });
  lines.push('done: Node, git and the career-ops checkout are fine');
  pinCareerOps({ root: real, packRoot, pkgFile, dryRun, runner, platform, lines });
  const res = install({ root: real, packRoot, dryRun, runner, nodeVersion, platform });
  for (const a of res.actions) lines.push(`${dryRun ? 'would do' : 'done'}: ${a}`);
  codexConfig({ root: real, packRoot, dryRun, lines });
  claudeSettings({ root: real, packRoot, dryRun, lines });
  playwright({ root: real, dryRun, skip: skipPlaywright, runner, platform, lines });
  if (!dryRun) {
    const missing = ['AGENTS.override.md', 'CLAUDE.local.md', join('config', 'local-paths.txt')].filter((f) => !existsSync(join(real, f)));
    if (missing.length) throw new InstallError(`setup did not produce ${missing.join(', ')} in ${real}: run "node student/install.mjs" there and read its message`);
    lines.push('done: setup files verified');
    lines.push(`SETUP OK: ${real}`);
    lines.push(`NEXT: start the interview now. Work from ${real}, run "node student/scripts/session-start.mjs" there, and follow student/AGENTS.student.md.`);
  }
  return lines;
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { 'skip-playwright': 'boolean' } });
  const paths = resolvePaths({ root: flags.root });
  try {
    for (const l of setup({ root: resolve(paths.root), packRoot: paths.packRoot, dryRun: flags.dryRun, skipPlaywright: flags.skipPlaywright })) console.log(l);
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
