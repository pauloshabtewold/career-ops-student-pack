#!/usr/bin/env node
// Takes the pack back out of a career-ops checkout. Run as `node student/uninstall.mjs` from the career-ops folder.
// It undoes what install.mjs and the interview's schedule step added, in this order:
// 1. the daily schedule, but only when it points at this career-ops folder;
// 2. the pack plugins, through upstream's own `plugins.mjs remove` so its lock and config/plugins.yml stay consistent;
// 3. the CLAUDE.local.md import block and the AGENTS.override.md blocks, deleting a file only when nothing else is left;
// 4. the pack lines in config/local-paths.txt and .git/info/exclude.
// The student's own files stay: data/, cv.md, profile.yml, portals.yml and config/student.yml (whose exclude line is
// kept while the file exists, so it never shows up as a file to commit). The student folder itself is left for the
// student to delete, because a running script cannot reliably remove its own folder on Windows.
// Usage: uninstall.mjs [--root R] [--dry-run] [--skip-schedule]
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BLOCK_RE, EXCLUDES, LOCAL_PATHS } from './install.mjs';
import { parseArgs, runCli, isMain } from './lib/args.mjs';
import { resolvePaths } from './lib/paths.mjs';
import { oneLine } from './lib/text.mjs';
import { defaultRunner } from './lib/upstream.mjs';
import { LABEL } from './scripts/schedule.mjs';

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

// A schedule belongs to this folder when its plist names this root; on Windows the task name is fixed per user and
// schedule.mjs install always overwrites it, so the last install wins and is the one to remove.
export function scheduleOwner({ root, platform = process.platform, home = homedir() }) {
  if (platform === 'win32') return 'this';
  if (platform !== 'darwin') return 'none';
  const plist = join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
  if (!existsSync(plist)) return 'none';
  const m = /<key>WorkingDirectory<\/key>\s*<string>([^<]*)<\/string>/.exec(readFileSync(plist, 'utf8'));
  const dir = m ? m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&') : null;
  return dir === root ? 'this' : 'other';
}

// Returns { actions, problems }. Problems are steps that failed and need the printed command run by hand; the other
// steps still run so one failure does not leave the install half removed.
export function uninstall({ root, packRoot, dryRun = false, skipSchedule = false, runner = defaultRunner, platform = process.platform, home = homedir() }) {
  const actions = [];
  const problems = [];
  const node = (script, args) => runner(process.execPath, [script, ...args], { cwd: root });

  if (skipSchedule) actions.push('schedule: skipped (--skip-schedule)');
  else {
    const owner = scheduleOwner({ root, platform, home });
    if (owner === 'none') actions.push('schedule: none installed');
    else if (owner === 'other') actions.push(`schedule: left in place, ${LABEL} runs a different career-ops folder`);
    else if (dryRun) actions.push('schedule: would remove');
    else {
      try {
        node(join(packRoot, 'scripts', 'schedule.mjs'), ['remove', '--root', root]);
        actions.push('schedule: removed');
      } catch (err) {
        problems.push(`schedule: remove failed (${oneLine(err.stderr || err.message)}); run "node student/scripts/schedule.mjs remove"`);
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
  const edit = (rel, update, { deleteEmpty = false } = {}) => {
    const file = join(root, rel);
    if (!existsSync(file)) return;
    const before = readFileSync(file, 'utf8');
    const after = update(before);
    if (after === before) return;
    if (deleteEmpty && !after.trim()) {
      actions.push(`${rel}: deleted, nothing else was in it`);
      if (!dryRun) rmSync(file);
      return;
    }
    actions.push(`${rel}: removed the pack entries, kept the rest`);
    if (!dryRun) writeFileSync(file, after);
  };
  edit('CLAUDE.local.md', (t) => withoutBlocks(t, [BLOCK_RE]), { deleteEmpty: true });
  edit('AGENTS.override.md', (t) => withoutBlocks(t, OVERRIDE_BLOCKS), { deleteEmpty: true });
  // A student's own config/student.yml or .codex/config.toml outlives the pack, so its line stays while the file does.
  const packOwned = new Set(['student/', 'CLAUDE.local.md', 'AGENTS.override.md']);
  const removable = (list) => list.filter((p) => packOwned.has(p) || !existsSync(join(root, p)));
  edit(join('config', 'local-paths.txt'), (t) => removeLines(t, removable(LOCAL_PATHS)));
  edit(join('.git', 'info', 'exclude'), (t) => removeLines(t, removable(EXCLUDES)));
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
