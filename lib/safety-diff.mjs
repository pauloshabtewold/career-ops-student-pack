// Safety-tag comparison shared by scripts/check-safety-tag.mjs (the maintainer gate) and update.mjs (the student check):
// a diff may only tighten budget ceilings or turn defaults off. Ceilings are read from a ref's own budget.mjs, and only
// after the file is shown to differ from the base solely inside the literal CEILINGS block (see vetBudget).
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import * as yaml from 'js-yaml';
import { gitRunner } from './run.mjs';

const defaultPackRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const ALLOWED_FILES = new Set(['scripts/budget.mjs', 'compat.json', 'templates/student.defaults.yml', 'AGENTS.student.md']);
const allowedFile = (f) => ALLOWED_FILES.has(f) || /^modes\/[^/]+\.md$/.test(f);

// Higher rank = more permissive. A default may move down but never up.
const RANKS = {
  'switches.outreach': ['off', 'drafts', 'on'],
  'switches.handshake': ['off', 'on'],
  'switches.submission': ['user', 'agent'],
  automation: ['manual', 'scheduled-discovery', 'scheduled-discovery-plus-triage'],
};

// argv is cut to [node] before the import: every released budget.mjs guard (realpath or resolve form) then sees no
// argv[1] and skips its CLI, so loading a ref's module never runs its main.
const LOAD_SCRIPT = 'const url = process.argv[1]; process.argv.length = 1; const m = await import(url); process.stdout.write(JSON.stringify(m.CEILINGS));';

// The CEILINGS block runs from its declaration line to the first line that is exactly "});". Nothing in the head's block
// may execute except the literal: each line is blank, a line comment, or one plain entry.
const BLOCK_START = /^export const CEILINGS = (?:deepFreeze|Object\.freeze)\(\{$/;
const BLOCK_END = '});';
const QUOTED = String.raw`'[^'\\\r\n\u2028\u2029]*'`;
const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const LIST = String.raw`\[\s*(?:${QUOTED}(?:\s*,\s*${QUOTED})*\s*)?\]`;
// No real entry comes close; the cap keeps a padded line from stalling the match at every session start.
const MAX_ENTRY_LENGTH = 300;
const VALUE = `(?:${NUMBER}|${QUOTED}|${LIST})`;
const PLAIN_ENTRY = new RegExp(
  String.raw`^\s*[A-Za-z_]\w*: (?:(?:down|up)\(${VALUE}, ${QUOTED}, ${QUOTED}\)|entry\(${VALUE}, ${QUOTED}, '(?:up|down)', ${QUOTED}\)),\s*$`,
);

const normalize = (source) => source.replace(/\r\n/g, '\n');

// Splits a budget.mjs source at its CEILINGS block: { before, block (the lines between the declaration and "});"), after }.
function splitCeilings(source) {
  const lines = normalize(source).split('\n');
  const start = lines.findIndex((l) => BLOCK_START.test(l));
  if (start < 0) return null;
  const end = lines.indexOf(BLOCK_END, start + 1);
  if (end < 0) return null;
  return { before: lines.slice(0, start), block: lines.slice(start + 1, end), after: lines.slice(end + 1) };
}

// A bare CR, U+2028 or U+2029 ends a line comment in JS but not in the line split above, so any of them could hide code.
const plainEntries = (block) =>
  !/[\r\u2028\u2029]/.test(block.join('\n')) && block.every((l) => l.trim() === '' || l.trimStart().startsWith('//') || (l.length <= MAX_ENTRY_LENGTH && PLAIN_ENTRY.test(l)));

// True when the head budget.mjs may be loaded: identical to the base outside CEILINGS, and the head block holds only plain
// entries. Otherwise it pushes the violation and returns false, so the head module is never executed.
function vetBudget(baseSource, headSource, violations) {
  const [b, h] = [splitCeilings(baseSource), splitCeilings(headSource)];
  if (!b || !h) {
    violations.push('budget.mjs changed outside CEILINGS (no CEILINGS block found)');
    return false;
  }
  if (!isDeepStrictEqual([b.before, b.after], [h.before, h.after])) {
    violations.push('budget.mjs changed outside CEILINGS');
    return false;
  }
  if (!plainEntries(h.block)) {
    violations.push('CEILINGS holds more than plain entries');
    return false;
  }
  return true;
}

const toComparable = (v) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : v);

async function loadCeilings(packRoot, source) {
  // The temp file sits beside the real one so the module's relative imports resolve inside this checkout.
  const tmp = join(packRoot, 'scripts', `.budget-check-${randomUUID()}.mjs`);
  writeFileSync(tmp, source);
  try {
    // A child process loads the ref's module so its top-level code never runs inside this one.
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', LOAD_SCRIPT, pathToFileURL(tmp).href], { cwd: packRoot, encoding: 'utf8' });
    return JSON.parse(out);
  } finally {
    rmSync(tmp, { force: true });
  }
}

const show = (run, packRoot, ref, file) => {
  try {
    return run(['show', `${ref}:${file}`], { cwd: packRoot });
  } catch {
    return null;
  }
};

function compareCeilings(base, head, violations) {
  for (const [name, b] of Object.entries(base)) {
    const h = head[name];
    if (!h) {
      violations.push(`ceiling removed: ${name}`);
      continue;
    }
    if (h.tighten !== b.tighten) violations.push(`ceiling direction changed: ${name} (${b.tighten} -> ${h.tighten})`);
    const [bv, hv] = [toComparable(b.value), toComparable(h.value)];
    if (typeof bv === 'number' && typeof hv === 'number') {
      if (b.tighten === 'down' && hv > bv) violations.push(`max ceiling raised: ${name} ${b.value} -> ${h.value}`);
      if (b.tighten === 'up' && hv < bv) violations.push(`min ceiling lowered: ${name} ${b.value} -> ${h.value}`);
    } else if (!isDeepStrictEqual(b.value, h.value)) {
      violations.push(`ceiling changed beyond comparison: ${name}`);
    }
  }
}

function compareDefaults(baseText, headText, violations) {
  const read = (t) => (t && t.trim() ? yaml.load(t) ?? {} : {});
  const [b, h] = [read(baseText), read(headText)];
  const dig = (o, path) => path.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
  for (const [path, order] of Object.entries(RANKS)) {
    const [from, to] = [dig(b, path), dig(h, path)];
    if (to === undefined || from === to) continue;
    const [fi, ti] = [order.indexOf(from), order.indexOf(to)];
    if (ti < 0 || (fi >= 0 && ti > fi)) violations.push(`default turned on: ${path} ${from ?? '(unset)'} -> ${to}`);
  }
}

function compareCompat(baseText, headText, headBudget, violations) {
  const strip = (t) => {
    const o = t ? JSON.parse(t) : {};
    delete o.budgetSha256;
    return o;
  };
  if (!isDeepStrictEqual(strip(baseText), strip(headText))) violations.push('compat.json changed outside budgetSha256');
  // The pin may only follow a budget.mjs that passed this gate, so it must be the hash of the head's own file.
  const pinned = headText ? JSON.parse(headText).budgetSha256 : undefined;
  if (headBudget === null || pinned !== createHash('sha256').update(headBudget).digest('hex')) violations.push('compat.json budgetSha256 does not match budget.mjs');
}

export async function checkSafetyDiff({ packRoot = defaultPackRoot, base, head, runner = gitRunner }) {
  const violations = [];
  const out = runner(['diff', '--name-only', '--no-renames', '-z', base, head], { cwd: packRoot });
  const changed = out.split('\0').filter(Boolean);
  for (const f of changed) if (!allowedFile(f)) violations.push(`file not allowed in a safety tag: ${f}`);
  if (changed.includes('scripts/budget.mjs')) {
    const [baseSource, headSource] = [show(runner, packRoot, base, 'scripts/budget.mjs'), show(runner, packRoot, head, 'scripts/budget.mjs')];
    if (baseSource === null || headSource === null) violations.push('budget.mjs changed outside CEILINGS (file missing at a ref)');
    else if (vetBudget(baseSource, headSource, violations)) compareCeilings(await loadCeilings(packRoot, baseSource), await loadCeilings(packRoot, headSource), violations);
  }
  if (changed.includes('templates/student.defaults.yml')) {
    compareDefaults(show(runner, packRoot, base, 'templates/student.defaults.yml'), show(runner, packRoot, head, 'templates/student.defaults.yml'), violations);
  }
  if (changed.includes('compat.json') || changed.includes('scripts/budget.mjs')) {
    compareCompat(show(runner, packRoot, base, 'compat.json'), show(runner, packRoot, head, 'compat.json'), show(runner, packRoot, head, 'scripts/budget.mjs'), violations);
  }
  return { ok: violations.length === 0, violations };
}
