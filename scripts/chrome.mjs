// Stub so the M-001 tests fail on behaviour; M-001 replaces every body.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isMain, runCli } from '../lib/args.mjs';

export const STATE_FILE = '.chrome-automation';
export const PROFILE_DIR = 'chrome-automation';
export const EXIT = Object.freeze({ ok: 0, usage: 2, wait: 4, notRunning: 7 });

const todo = () => {
  throw new Error('not implemented');
};

export function splitCommand(text, home = homedir()) {
  return todo(text, home);
}
export function resolveSlotCommand({ env = process.env, config = null } = {}) {
  return todo(env, config);
}
export function runSlotCommand(command, { run = spawnSync, home = homedir() } = {}) {
  return todo(command, run, home);
}
export function chromeCandidates({ platform = process.platform, env = process.env, home = homedir() } = {}) {
  return todo(platform, env, home);
}
export function findChrome({ platform = process.platform, env = process.env, home = homedir(), exists = existsSync } = {}) {
  return todo(platform, env, home, exists);
}
export function readState(dataDir) {
  return todo(dataDir);
}
export function writeState(dataDir, state) {
  return todo(dataDir, state);
}
export async function reachable(port, { fetchFn = fetch } = {}) {
  return todo(port, fetchFn);
}
export async function liveState(dataDir, deps = {}) {
  return todo(dataDir, deps);
}
export function launchArgs(profile, { headless = false } = {}) {
  return todo(profile, headless);
}
export function profilePath(config, dataDir) {
  return todo(config, dataDir);
}
const cmdOpen = async () => todo();
const cmdStatus = async () => todo();
const cmdRead = async () => todo();
const cmdClose = async () => todo();
export const HANDLERS = { open: cmdOpen, status: cmdStatus, read: cmdRead, close: cmdClose };
export const COMMANDS = Object.keys(HANDLERS);
export const FLAGS = { headless: 'boolean' };
export async function main(argv = process.argv.slice(2), deps = {}) {
  return todo(argv, deps);
}

if (isMain(import.meta.url)) await runCli(() => main());
