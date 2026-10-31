#!/usr/bin/env node
// Takes the pack back out of a career-ops checkout. Run as `node student/uninstall.mjs` from the career-ops folder.
// It undoes what install.mjs and the interview's schedule step added, in this order:
// 1. the daily schedule, but only when it points at this career-ops folder;
// 2. the pack plugins, through upstream's own `plugins.mjs remove` so its lock and config/plugins.yml stay consistent;
// 3. the CLAUDE.local.md import block and the AGENTS.override.md blocks, deleting a file only when nothing else is left;
// 4. the pack lines in config/local-paths.txt and git's info/exclude (found through git, since .git can be a file);
// 5. upstream's .update-dismissed marker, only when it dismissed a version outside the pack's compat.json range.
// The student's own files stay: data/, cv.md, profile.yml, portals.yml and config/student.yml (whose exclude line is
// kept while the file exists, so it never shows up as a file to commit). The student folder itself is left for the
// student to delete, because a running script cannot reliably remove its own folder on Windows.
// Usage: uninstall.mjs [--root R] [--dry-run] [--skip-schedule]
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, win32 } from 'node:path';
import { BLOCK_RE, EXCLUDES, LOCAL_PATHS, gitExcludePath } from './install.mjs';
import { parseArgs, runCli, isMain } from './lib/args.mjs';
import { resolvePaths } from './lib/paths.mjs';
import { oneLine } from './lib/text.mjs';
import { inRange } from './lib/semver.mjs';
import { defaultRunner } from './lib/upstream.mjs';
import { LABEL, TASK_NAME } from './scripts/schedule.mjs';

const OVERRIDE_BLOCKS = [/<!-- student-pack:start -->[\s\S]*?<!-- student-pack:end -->/, /<!-- career-ops-agents:start -->[\s\S]*?<!-- career-ops-agents:end -->/];

// Drops the listed lines and keeps every other line and the file's line endings.
export function removeLines(text, lines) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const drop = new Set(lines);
  const kept = text.split(/\r?\n/).filter((l) => !drop.has(l.trim()));
  return kept.join(eol);
}

export function withoutBlocks(text, blocks) {
  let out = text;
  for (const re of blocks) out = out.replace(re, '');
  return out.replace(/^\s+/, '').replace(/\s+$/, out.trim() ? '\n' : '');
}

// A schedule belongs to this folder when its plist (macOS) or its task's working directory (Windows) names this root.
const sameDir = (a, b) => {
  const norm = (d) => win32.normalize(d.trim()).replace(/[\\/]+$/, '').toLowerCase();
  return norm(a) === norm(b);
};
const WIN_TASK_DIR = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-ScheduledTask -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue | ForEach-Object { $_.Actions } | ForEach-Object { $_.WorkingDirectory }`;

export function scheduleOwner({ root, platform = process.platform, home = homedir(), runner = defaultRunner }) {
  if (platform === 'win32') {
    let out;
    try {
      out = String(runner('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WIN_TASK_DIR]));
    } catch {
      // The read failed (no powershell, blocked): say 'this' so the remove attempt reports its own failure.
      return 'this';
    }
    const dir = out.split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    if (!dir) return 'none';
    return sameDir(dir, root) ? 'this' : 'other';
  }
  if (platform !== 'darwin') return 'none';
  const plist = join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
  if (!existsSync(plist)) return 'none';
  const m = /<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/.exec(readFileSync(plist, 'utf8'));
  const dir = m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&') : null;
  return dir === root ? 'this' : 'other';
}

// True when the marker is JSON naming a version outside compat.json's upstream range. A bare timestamp (the older
// form), an in-range or unparsable version, or a missing compat.json all count as not the pack's doing.
function dismissedByPack(marker, packRoot) {
  try {
    const { version } = JSON.parse(readFileSync(marker, 'utf8'));
    const compat = JSON.parse(readFileSync(join(packRoot, 'compat.json'), 'utf8'));
    return typeof version === 'string' && !inRange(version, compat.upstream);
  } catch {
    return false;
  }
}

// Returns { actions, problems }. Problems are steps that failed and need the printed command run by hand; the other
// steps still run so one failure does not leave the install half removed.
export function uninstall({ root, packRoot, dryRun = false, skipSchedule = false, runner = defaultRunner, platform = process.platform, home = homedir() }) {
  const actions = [];
  const problems = [];
  const node = (script, args) => runner(process.execPath, [script, ...args], { cwd: root });

  if (skipSchedule) actions.push('schedule: skipped (--skip-schedule)');
  else {
    const owner = scheduleOwner({ root, platform, home, runner });
    if (owner === 'none') actions.push('schedule: none installed');
    else if (owner === 'other') actions.push(`schedule: left in place, ${LABEL} runs a different career-ops folder`);
    else if (dryRun) actions.push('schedule: would remove');
    else {
      try {
        const out = node(join(packRoot, 'scripts', 'schedule.mjs'), ['remove', '--root', root]);
        actions.push(String(out).includes('was not registered') ? 'schedule: none installed' : 'schedule: removed');
      } catch (err) {
        problems.push(`schedule: remove failed (${oneLine(String(err.stderr ?? '').trim() || String(err.stdout ?? '').trim() || err.message)}); run "node student/scripts/schedule.mjs remove"`);
      }
    }
  }

  const pluginsDir = join(packRoot, 'plugins');
  const ids = existsSync(pluginsDir) ? readdirSync(pluginsDir).filter((d) => existsSync(join(pluginsDir, d, 'manifest.json'))) : [];
  for (const id of ids.filter((i) => existsSync(join(root, 'plugins.local', i)))) {
    if (dryRun) {
      actions.push(`plugins.local/${id}: would remove`);
      continue;
    }
    try {
      node(join(root, 'plugins.mjs'), ['remove', id]);
      actions.push(`plugins.local/${id}: removed`);
    } catch (err) {
      problems.push(`plugins.local/${id}: remove failed (${oneLine(err.stderr || err.message)}); run "node plugins.mjs remove ${id}"`);
    }
  }

  // Only the two files the pack itself creates are deleted when emptied; upstream's own files are always kept.
  const gone = new Set();
  const edit = (rel, update, { deleteEmpty = false, label = rel } = {}) => {
    const file = isAbsolute(rel) ? rel : join(root, rel);
    if (!existsSync(file)) return;
    const before = readFileSync(file, 'utf8');
    const after = update(before);
    if (after === before) return;
    if (deleteEmpty && !after.trim()) {
      actions.push(`${label}: deleted, nothing else was in it`);
      gone.add(rel);
      if (!dryRun) rmSync(file);
      return;
    }
    actions.push(`${label}: removed the pack entries, kept the rest`);
    if (!dryRun) writeFileSync(file, after);
  };
  edit('CLAUDE.local.md', (t) => withoutBlocks(t, [BLOCK_RE]), { deleteEmpty: true });
  edit('AGENTS.override.md', (t) => withoutBlocks(t, OVERRIDE_BLOCKS), { deleteEmpty: true });
  // A file that outlives the pack (the student's config/student.yml or .codex/config.toml, or a CLAUDE.local.md or
  // AGENTS.override.md that held their own text) keeps its ignore line, so it never shows up as something to commit.
  const removable = (list) => list.filter((p) => p === 'student/' || gone.has(p) || !existsSync(join(root, p)));
  edit(join('config', 'local-paths.txt'), (t) => removeLines(t, removable(LOCAL_PATHS)));
  const exclude = gitExcludePath(root, runner);
  if (exclude) edit(exclude, (t) => removeLines(t, removable(EXCLUDES)), { label: '.git/info/exclude' });
  else actions.push('.git/info/exclude: skipped, git could not name the file');

  // upstream writes this when update.mjs declined a release outside the pack range; keep a marker the pack did not cause.
  const marker = join(root, '.update-dismissed');
  if (existsSync(marker) && dismissedByPack(marker, packRoot)) {
    actions.push(`.update-dismissed: ${dryRun ? 'would remove' : 'removed'}, it dismissed a release this pack does not support`);
    if (!dryRun) rmSync(marker);
  }
  return { actions, problems };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { 'skip-schedule': 'boolean' } });
  const paths = resolvePaths({ root: flags.root });
  const res = uninstall({ root: paths.root, packRoot: paths.packRoot, dryRun: flags.dryRun, skipSchedule: flags.skipSchedule });
  for (const a of res.actions) console.log(`${flags.dryRun ? 'would do' : 'done'}: ${a}`);
  for (const p of res.problems) console.log(`not done: ${p}`);
  console.log('Kept: your data folder, cv.md, profile.yml, portals.yml and config/student.yml.');
  console.log('Last step: delete the student folder. macOS: rm -rf student   Windows PowerShell: Remove-Item -Recurse -Force student');
  return res.problems.length ? 1 : 0;
}

if (isMain(import.meta.url)) await runCli(main);
