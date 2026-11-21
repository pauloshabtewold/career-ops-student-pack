#!/usr/bin/env node
// One-shot proof of whether a scheduled run reaches the automation Chrome. A launchd or Task Scheduler job starts in a
// bare session with a bare PATH, which may not see the student's logged-in Chrome; only a real scheduled job proves it.
// The probe installs a one-shot job labelled career-ops.chrome-probe that runs `chrome.mjs status --json` into
// data/.chrome-probe.json, waits up to 90 seconds for that file, removes the job on every exit path, records
// chrome_in_schedule yes or no in config/student.yml and appends a dated evidence line to docs/chrome-spike.md.
// Usage: schedule-probe.mjs [--root R] | schedule-probe.mjs child --out FILE
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain, parseArgs, runCli } from '../lib/args.mjs';
import { writeConfigKey } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { runResult } from '../lib/run.mjs';

const PACK_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// Label of the one-shot scheduler job.
export const PROBE_LABEL = 'career-ops.chrome-probe';
// Result file the scheduled child writes in dataDir.
export const PROBE_FILE = '.chrome-probe.json';
// How long probe waits for the scheduled child to write its result.
export const WAIT_MS = 90 * 1000;

// Forwarded to the child so its status call reads the same data folder as the probe that installed it.
const childPaths = ({ root, dataDir }) => [...(root ? ['--root', root] : []), ...(dataDir ? ['--data-dir', dataDir] : [])];

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// RunAtLoad makes launchd start the job once at bootstrap; the probe removes it before returning.
export function probePlist({ nodePath, packRoot, out, root, dataDir }) {
  const args = [nodePath, posix.join(packRoot, 'tools', 'schedule-probe.mjs'), 'child', '--out', out, ...childPaths({ root, dataDir })];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${PROBE_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...args.map((a) => `    <string>${xml(a)}</string>`),
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

// The real scheduler, one per platform; tests inject a fake with the same install/remove shape.
export function systemScheduler({ platform = process.platform, home = homedir() } = {}) {
  if (platform === 'darwin') {
    const file = join(home, 'Library', 'LaunchAgents', `${PROBE_LABEL}.plist`);
    const domain = `gui/${process.getuid()}`;
    return {
      install({ nodePath, packRoot, out, root, dataDir }) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, probePlist({ nodePath, packRoot, out, root, dataDir }));
        return runResult('launchctl', ['bootstrap', domain, file]).code === 0;
      },
      remove() {
        runResult('launchctl', ['bootout', domain, file]);
        rmSync(file, { force: true });
      },
    };
  }
  if (platform === 'win32') {
    return {
      install({ nodePath, packRoot, out, root, dataDir }) {
        const start = new Date(Date.now() + 60 * 1000);
        const st = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
        const tr = `"${nodePath}" "${win32.join(packRoot, 'tools', 'schedule-probe.mjs')}" child --out "${out}"${childPaths({ root, dataDir }).map((a) => ` "${a}"`).join('')}`;
        return runResult('schtasks', ['/Create', '/F', '/SC', 'ONCE', '/ST', st, '/TN', PROBE_LABEL, '/TR', tr]).code === 0;
      },
      remove() {
        runResult('schtasks', ['/Delete', '/F', '/TN', PROBE_LABEL]);
      },
    };
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Parsed probe result, or null when missing or unreadable.
export function readProbe(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// Installs the probe job through scheduler, waits up to WAIT_MS for the child result, and records the outcome.
export async function probe({ root, dataDir, packRoot = PACK_ROOT, scheduler, now = Date.now, wait = sleep, nodePath = process.execPath, spikeDoc = join(packRoot, 'docs', 'chrome-spike.md'), today = new Date().toISOString().slice(0, 10), say = console.log }) {
  const out = join(dataDir, PROBE_FILE);
  rmSync(out, { force: true });
  let result = null;
  try {
    if (scheduler.install({ nodePath, packRoot, out, root, dataDir })) {
      const until = now() + WAIT_MS;
      while (now() < until && !(result = readProbe(out))) await wait(2000);
    }
  } finally {
    scheduler.remove();
  }
  const value = result?.reachable === 'yes' ? 'yes' : 'no';
  writeConfigKey({ root }, 'chrome_in_schedule', value);
  const why = result ? `probe file said reachable ${result.reachable}` : 'no probe file within 90 seconds';
  appendFileSync(spikeDoc, `- ${today}: scheduled probe ${PROBE_LABEL}: ${why}; chrome_in_schedule ${value}\n`);
  say(`schedule-probe: chrome_in_schedule ${value} (${why})`);
  return value;
}

// Runs inside the scheduled job: no shell redirection exists there, so the child writes the status itself.
function child(out, paths) {
  const res = runResult(process.execPath, [join(PACK_ROOT, 'scripts', 'chrome.mjs'), 'status', '--json', ...childPaths(paths)], { timeout: 30 * 1000 });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, res.code === 0 && res.stdout.trim() ? res.stdout : `${JSON.stringify({ reachable: 'no', error: res.stderr.trim().slice(0, 200) })}\n`);
  return 0;
}

// The child command writes the probe result; any other command runs the probe.
export async function main(argv = process.argv.slice(2)) {
  const { command, flags } = parseArgs(argv, { flags: { out: 'string' } });
  if (command === 'child') return child(flags.out, { root: flags.root, dataDir: flags.dataDir });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const scheduler = systemScheduler();
  if (!scheduler) {
    console.log('schedule-probe: only macOS and Windows have a scheduler to probe; chrome_in_schedule stays unset');
    return 0;
  }
  await probe({ root: paths.root, dataDir: paths.dataDir, scheduler });
  return 0;
}

if (isMain(import.meta.url)) await runCli(() => main());
