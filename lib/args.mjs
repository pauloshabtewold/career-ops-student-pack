// Shared argument parser and entry guard for every pack CLI.
// Unknown flags and malformed values throw UsageError so each CLI can exit 2 the same way.
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRealDate } from './clock.mjs';

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

export const COMMON_FLAGS = Object.freeze({
  root: 'string',
  'data-dir': 'string',
  today: 'date',
  'dry-run': 'boolean',
  json: 'boolean',
});

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function coerce(name, type, raw) {
  if (type === 'string') return raw;
  if (type === 'int') {
    if (!/^-?\d+$/.test(raw)) throw new UsageError(`--${name} expects an integer, got "${raw}"`);
    return Number(raw);
  }
  if (type === 'date') {
    if (!isRealDate(raw)) throw new UsageError(`--${name} expects a real date as YYYY-MM-DD, got "${raw}"`);
    return raw;
  }
  throw new UsageError(`--${name} has unsupported type ${type}`);
}

/**
 * spec = { commands?: string[], flags?: {name: 'boolean'|'string'|'int'|'date'}, common?: boolean }
 * Returns { command, positionals, flags } with camelCase flag keys.
 */
export function parseArgs(argv, spec = {}) {
  const flagTypes = { ...(spec.common === false ? {} : COMMON_FLAGS), ...(spec.flags || {}) };
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const type = flagTypes[name];
    if (!type) throw new UsageError(`unknown flag --${name}`);
    if (type === 'boolean') {
      if (eq !== -1) throw new UsageError(`--${name} takes no value`);
      flags[camel(name)] = true;
      continue;
    }
    let raw;
    if (eq !== -1) raw = arg.slice(eq + 1);
    else {
      raw = argv[++i];
      if (raw === undefined || raw.startsWith('--')) throw new UsageError(`--${name} needs a value`);
    }
    flags[camel(name)] = coerce(name, type, raw);
  }
  const command = positionals.shift() ?? null;
  if (spec.commands && (command === null || !spec.commands.includes(command))) {
    throw new UsageError(`command must be one of: ${spec.commands.join(', ')}`);
  }
  return { command, positionals, flags };
}

// Maps thrown UsageError to exit code 2 and prints the message; any other error is rethrown.
export async function runCli(main) {
  try {
    const code = await main();
    process.exitCode = typeof code === 'number' ? code : 0;
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(err.message);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
}

// True when moduleUrl is the script node was started with. Both sides go through realpath because argv[1] keeps the
// path as typed (a symlink, a junction, a macOS /tmp alias) while import.meta.url is already resolved.
export function isMain(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(argv1));
  } catch {
    return false;
  }
}
