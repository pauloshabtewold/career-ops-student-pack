// Safety-tag comparison shared by scripts/check-safety-tag.mjs (the maintainer gate) and update.mjs (the student check):
// a diff may only tighten budget ceilings or turn defaults off. Ceilings are read from a ref's own budget.mjs.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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

const toComparable = (v) => (typeof v === 'string' && /^\d{2}:\d{2}$/.test(v) ? Number(v.slice(0, 2)) * 60 + Number(v.slice(3)) : v);

async function loadCeilings(packRoot, ref, run) {
  const source = run(['show', `${ref}:scripts/budget.mjs`], { cwd: packRoot });
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

function compareCompat(baseText, headText, violations) {
  const strip = (t) => {
    const o = t ? JSON.parse(t) : {};
    delete o.budgetSha256;
    return o;
  };
  if (!isDeepStrictEqual(strip(baseText), strip(headText))) violations.push('compat.json changed outside budgetSha256');
}

export async function checkSafetyDiff({ packRoot = defaultPackRoot, base, head, runner = gitRunner }) {
  const violations = [];
  const out = runner(['diff', '--name-only', '--no-renames', '-z', base, head], { cwd: packRoot });
  const changed = out.split('\0').filter(Boolean);
  for (const f of changed) if (!allowedFile(f)) violations.push(`file not allowed in a safety tag: ${f}`);
  if (changed.includes('scripts/budget.mjs')) {
    const [b, h] = [await loadCeilings(packRoot, base, runner), await loadCeilings(packRoot, head, runner)];
    compareCeilings(b, h, violations);
  }
  if (changed.includes('templates/student.defaults.yml')) {
    compareDefaults(show(runner, packRoot, base, 'templates/student.defaults.yml'), show(runner, packRoot, head, 'templates/student.defaults.yml'), violations);
  }
  if (changed.includes('compat.json')) {
    compareCompat(show(runner, packRoot, base, 'compat.json'), show(runner, packRoot, head, 'compat.json'), violations);
  }
  return { ok: violations.length === 0, violations };
}
