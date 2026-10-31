// Checkers shared by the doc tests: the command contract (every `node student/...` command shown in a doc names a
// script on disk and only flags that script declares) and the README Install block order.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMON_FLAGS } from '../../lib/args.mjs';
import { PACK_ROOT } from './script-harness.mjs';

export const DOC_FILES = [
  'README.md',
  'docs/usage.md',
  'docs/architecture.md',
  'docs/maintenance.md',
  'modes/apply-loop.md',
  'modes/daily-run.md',
  'modes/handshake.md',
  'modes/inbox.md',
  'modes/outreach.md',
  'interview/interview.md',
];

export const readDoc = (rel) => readFileSync(join(PACK_ROOT, rel), 'utf8');

// Returns the text of the {...} literal that starts at `open` (the index of its opening brace), or null if unbalanced.
function braceBody(source, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return source.slice(open + 1, i);
  }
  return null;
}

// The object literal an expression stands for: the literal itself, or the `const NAME = { ... }` it names.
function objectAt(source, from) {
  const rest = source.slice(from);
  const lead = /^\s*/.exec(rest)[0].length;
  if (rest[lead] === '{') return braceBody(source, from + lead);
  const name = /^([A-Za-z_$][\w$]*)/.exec(rest.slice(lead))?.[1];
  const decl = name && new RegExp(`const\\s+${name}\\s*=\\s*\\{`).exec(source);
  return decl ? braceBody(source, decl.index + decl[0].length - 1) : null;
}

// Keys at the top level of an object literal body.
function topLevelKeys(body) {
  const keys = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  const take = (seg) => {
    const m = /^\s*(?:'([\w-]+)'|"([\w-]+)"|([A-Za-z_$][\w$]*))\s*:/.exec(seg);
    if (m) keys.push(m[1] ?? m[2] ?? m[3]);
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      take(body.slice(start, i));
      start = i + 1;
    }
  }
  take(body.slice(start));
  return keys;
}

// The flags a script's parseArgs calls accept: the keys of each `flags: {...}` spec plus COMMON_FLAGS unless the spec
// says `common: false`. Returns null when the script has no parseArgs call to read.
export function parsedFlags(source) {
  const allowed = new Set();
  let found = false;
  for (const call of source.matchAll(/(?<!function\s)(?<![\w.])parseArgs\(/g)) {
    // The spec is the call's second argument: skip the first by walking to the top-level comma.
    let depth = 0;
    let i = call.index + call[0].length;
    for (; i < source.length; i++) {
      const c = source[i];
      if ('{[('.includes(c)) depth++;
      else if ('}])'.includes(c)) depth--;
      if (depth < 0 || (c === ',' && depth === 0)) break;
    }
    if (source[i] !== ',') continue;
    const spec = objectAt(source, i + 1);
    if (spec === null) continue;
    found = true;
    if (!/\bcommon\s*:\s*false\b/.test(spec)) Object.keys(COMMON_FLAGS).forEach((k) => allowed.add(k));
    const at = /\bflags\s*:/.exec(spec);
    const flags = at && objectAt(spec, at.index + at[0].length);
    if (flags !== null && flags !== undefined) topLevelKeys(flags).forEach((k) => allowed.add(k));
    else if (at) {
      // flags: NAME, where NAME is a const object elsewhere in the script
      const named = objectAt(source, source.indexOf(spec) + at.index + at[0].length);
      if (named !== null) topLevelKeys(named).forEach((k) => allowed.add(k));
    }
  }
  return found ? allowed : null;
}

// Returns problems as 'file:line: message'. `text` is the doc body, `name` its repo-relative path.
export function scanCommands(name, text, packRoot = PACK_ROOT) {
  const problems = [];
  text.split('\n').forEach((lineText, i) => {
    const at = `${name}:${i + 1}`;
    for (const m of lineText.matchAll(/node student\/([\w./-]+\.mjs)([^`\n]*)/g)) {
      const rel = m[1];
      const file = join(packRoot, rel);
      if (!existsSync(file)) {
        problems.push(`${at}: script ${rel} does not exist`);
        continue;
      }
      const source = readFileSync(file, 'utf8');
      const args = m[2].split(/\||;|&&/)[0];
      const allowed = parsedFlags(source);
      for (const f of args.matchAll(/(?:^|\s)--([a-z][a-z0-9-]*)/g)) {
        if (allowed === null) problems.push(`${at}: ${rel} has no parseArgs flag spec to check --${f[1]} against`);
        else if (!allowed.has(f[1])) problems.push(`${at}: ${rel} does not declare --${f[1]}`);
      }
    }
  });
  return problems;
}

const fences = (text) => [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => ({ at: m.index, code: m[1] }));

// Returns the macOS and Windows code blocks of the README Install section, keyed by the OS label that precedes them.
export function installBlocks(readme) {
  const start = readme.indexOf('## Install');
  const end = readme.indexOf('\n## ', start + 1);
  const section = start < 0 ? '' : readme.slice(start, end < 0 ? undefined : end);
  const blocks = {};
  let prevEnd = 0;
  for (const f of fences(section)) {
    const label = section.slice(prevEnd, f.at);
    if (/macOS/i.test(label) && !blocks.macOS) blocks.macOS = f.code;
    else if (/Windows/i.test(label) && !blocks.Windows) blocks.Windows = f.code;
    prevEnd = f.at + f.code.length + 8;
  }
  return blocks;
}

const STEPS = {
  macOS: [
    ['prerequisite install', /brew install[^\n]*\b(node|git)\b/],
    ['upstream clone', /git clone(?![^\n]*\sstudent\s*(\n|$))[^\n]*career-ops/],
    ['npm install', /\bnpm install\b/],
    ['pack clone', /git clone[^\n]*\sstudent\s*(\n|$)/],
    ['install.mjs', /node student\/install\.mjs/],
  ],
  Windows: [
    ['prerequisite install', /winget install[^\n]*(NodeJS|Git\.Git)/],
    ['upstream clone', /git clone(?![^\n]*\sstudent\s*(\n|$))[^\n]*career-ops/],
    ['npm install', /\bnpm install\b/],
    ['pack clone', /git clone[^\n]*\sstudent\s*(\n|$)/],
    ['install.mjs', /node student\/install\.mjs/],
  ],
};

// Returns problems naming the block ('macOS block: ...' / 'Windows block: ...').
export function checkInstallBlocks(readme) {
  const problems = [];
  const blocks = installBlocks(readme);
  for (const os of ['macOS', 'Windows']) {
    const code = blocks[os];
    if (!code) {
      problems.push(`${os} block: missing from README Install`);
      continue;
    }
    let last = -1;
    for (const [label, re] of STEPS[os]) {
      const m = re.exec(code);
      if (!m) problems.push(`${os} block: no ${label} step`);
      else if (m.index <= last) problems.push(`${os} block: ${label} step is out of order`);
      else last = m.index;
    }
  }
  return problems;
}

// Returns problems for the README rules that are not about block order.
export function checkReadmeRules(readme) {
  const problems = [];
  if (readme.includes('<pack-url>')) problems.push('README contains <pack-url>');
  const warned = readme.split('\n').some((l) => /sync/i.test(l) && /(OneDrive|iCloud|Dropbox|Google Drive|cloud)/i.test(l));
  if (!warned) problems.push('README lacks the data folder sync warning');
  return problems;
}
