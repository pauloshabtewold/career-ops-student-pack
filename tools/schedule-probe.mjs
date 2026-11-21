#!/usr/bin/env node
// One-shot proof of whether a scheduled run reaches the automation Chrome. A launchd or Task Scheduler job starts in a
// bare session with a bare PATH, which may not see the student's logged-in Chrome; only a real scheduled job proves it.
// The probe installs a one-shot job labelled career-ops.chrome-probe that runs `chrome.mjs status --json` into
// data/.chrome-probe.json, waits up to 90 seconds for that file, removes the job on every exit path (Ctrl-C and SIGTERM
// included), records chrome_in_schedule yes or no in config/student.yml and appends a dated evidence line to
// data/chrome-probe.log. The key stays unset when the job could not be installed or the automation Chrome was not open,
// because neither says anything about whether a scheduled run can reach it. The log lives in the data folder because the
// pack folder is a git clone that update.mjs fast-forwards, and an edited tracked file would block pack updates.
// Usage: schedule-probe.mjs [--root R] | schedule-probe.mjs child --out FILE
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { constants as osConstants, homedir } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain, parseArgs, runCli } from '../lib/args.mjs';
import { writeConfigKey } from '../lib/config.mjs';
import { isPidAlive } from '../lib/dir-lock.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { runResult } from '../lib/run.mjs';
import { readState } from '../scripts/chrome.mjs';

const PACK_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// Label of the one-shot scheduler job.
export const PROBE_LABEL = 'career-ops.chrome-probe';
// Result file the scheduled child writes in dataDir.
export const PROBE_FILE = '.chrome-probe.json';
// How long probe waits for the scheduled child to write its result.
export const WAIT_MS = 90 * 1000;
// Dated evidence lines, one per probe run, in dataDir.
export const EVIDENCE_FILE = 'chrome-probe.log';
// Windows wrapper in dataDir that holds the full child command line.
export const PROBE_CMD = '.chrome-probe.cmd';
const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];

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
export function systemScheduler({ platform = process.platform, home = homedir(), run = runResult } = {}) {
  if (platform === 'darwin') {
    const file = join(home, 'Library', 'LaunchAgents', `${PROBE_LABEL}.plist`);
    const domain = `gui/${process.getuid()}`;
    return {
      install({ nodePath, packRoot, out, root, dataDir }) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, probePlist({ nodePath, packRoot, out, root, dataDir }));
        return run('launchctl', ['bootstrap', domain, file]).code === 0;
      },
      remove() {
        run('launchctl', ['bootout', domain, file]);
        rmSync(file, { force: true });
      },
    };
  }
  // schtasks caps /TR at 261 characters, which a full command line with student paths exceeds, so /TR names a short
  // .cmd wrapper in dataDir instead. %% keeps cmd from expanding a % in a path.
  if (platform === 'win32') {
    let wrapper = null;
    return {
      install({ nodePath, packRoot, out, root, dataDir }) {
        const start = new Date(Date.now() + 60 * 1000);
        const st = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
        const args = [nodePath, win32.join(packRoot, 'tools', 'schedule-probe.mjs'), 'child', '--out', out, ...childPaths({ root, dataDir })];
        wrapper = join(dataDir, PROBE_CMD);
        mkdirSync(dataDir, { recursive: true });
        writeFileSync(wrapper, `@echo off\r\n${args.map((a) => `"${a}"`).join(' ').replace(/%/g, '%%')}\r\n`);
        return run('schtasks', ['/Create', '/F', '/SC', 'ONCE', '/ST', st, '/TN', PROBE_LABEL, '/TR', `"${wrapper}"`]).code === 0;
      },
      remove() {
        run('schtasks', ['/Delete', '/F', '/TN', PROBE_LABEL]);
        if (wrapper) rmSync(wrapper, { force: true });
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

// yes or no from a probe that ran; unset (config untouched) when it says nothing about reach.
function verdict(installed, result) {
  if (!installed) return { value: 'unset', why: 'the probe job could not be installed' };
  if (!result) return { value: 'no', why: 'no probe file within 90 seconds' };
  if (result.reachable !== 'yes' && result.chrome_open === 'no') {
    return { value: 'unset', why: 'the automation Chrome was not open; run chrome.mjs open, then the probe again' };
  }
  return { value: result.reachable === 'yes' ? 'yes' : 'no', why: `probe file said reachable ${result.reachable}` };
}

// Installs the probe job through scheduler, waits up to WAIT_MS for the child result, and records the outcome. A signal
// during the wait would end Node without running finally, so the signal handlers remove the job themselves.
export async function probe({ root, dataDir, packRoot = PACK_ROOT, scheduler, now = Date.now, wait = sleep, nodePath = process.execPath, spikeDoc = join(dataDir, EVIDENCE_FILE), today = new Date().toISOString().slice(0, 10), say = console.log, proc = process }) {
  const out = join(dataDir, PROBE_FILE);
  rmSync(out, { force: true });
  let result = null;
  let installed = false;
  const onSignal = (sig) => {
    scheduler.remove();
    proc.exit(128 + (osConstants.signals[sig] ?? 15));
  };
  for (const sig of SIGNALS) proc.once(sig, onSignal);
  try {
    installed = scheduler.install({ nodePath, packRoot, out, root, dataDir });
    if (installed) {
      const until = now() + WAIT_MS;
      while (now() < until && !(result = readProbe(out))) await wait(2000);
    }
  } finally {
    for (const sig of SIGNALS) proc.off(sig, onSignal);
    scheduler.remove();
  }
  const { value, why } = verdict(installed, result);
  if (value !== 'unset') writeConfigKey({ root }, 'chrome_in_schedule', value);
  mkdirSync(dirname(spikeDoc), { recursive: true });
  appendFileSync(spikeDoc, `- ${today}: scheduled probe ${PROBE_LABEL}: ${why}; chrome_in_schedule ${value}\n`);
  say(`schedule-probe: chrome_in_schedule ${value} (${why})`);
  return value;
}

// Runs inside the scheduled job: no shell redirection exists there, so the child writes the status itself. chrome_open
// tells "the recorded Chrome is not running" apart from "running but unreachable from this session".
function child(out, paths) {
  const res = runResult(process.execPath, [join(PACK_ROOT, 'scripts', 'chrome.mjs'), 'status', '--json', ...childPaths(paths)], { timeout: 30 * 1000 });
  let status;
  try {
    status = res.code === 0 ? JSON.parse(res.stdout) : null;
  } catch {
    status = null;
  }
  status ??= { reachable: 'no', error: res.stderr.trim().slice(0, 200) };
  const state = readState(resolvePaths(paths).dataDir);
  const chromeOpen = state && isPidAlive(state.pid) ? 'yes' : 'no';
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify({ ...status, chrome_open: chromeOpen })}\n`);
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
