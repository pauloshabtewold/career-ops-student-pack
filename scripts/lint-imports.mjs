#!/usr/bin/env node
// CLI-only boundary lint: pack code may call upstream scripts only through child_process.
// Importing an upstream module would couple the pack to upstream internals and bypass the compat.json range.
// Exit 0 clean, 1 findings (file:line rule), 2 usage.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runCli, isMain } from '../lib/args.mjs';

const SKIP_DIRS = new Set(['node_modules', '.git']);
const ALLOWED_BARE = new Set(['js-yaml']);

const STATIC_RE = /(?:^|[;\n])[ \t]*(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?(['"])([^'"\n]+)\1/g;
const SIDE_EFFECT_RE = /(?:^|[;\n])[ \t]*import\s*(['"])([^'"\n]+)\1/g;
const DYNAMIC_ANY_RE = /(?<![.\w$])import\s*\(/g;
const DYNAMIC_LITERAL_RE = /(?<![.\w$])import\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;
const REQUIRE_RE = /(?<![.\w$])require\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g;

function walk(dir, root, out) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    const rel = relative(root, abs).split(sep).join('/');
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) || rel === 'tests/fixtures') continue;
      walk(abs, root, out);
    } else if (/\.(mjs|js)$/.test(ent.name)) out.push(rel);
  }
  return out;
}

function isFullLineComment(text, idx) {
  const start = text.lastIndexOf('\n', idx - 1) + 1;
  return /^\s*(\/\/|\*|\/\*)/.test(text.slice(start, text.indexOf('\n', idx) === -1 ? undefined : text.indexOf('\n', idx)));
}

// True when idx sits inside a quoted string that opened earlier on the same line, such as source text
// embedded in a test fixture; such text is data, not an import of this file.
function insideString(text, idx) {
  const start = text.lastIndexOf('\n', idx - 1) + 1;
  let open = null;
  for (let i = start; i < idx; i++) {
    const c = text[i];
    if (open) {
      if (c === '\\') i++;
      else if (c === open) open = null;
    } else if (c === "'" || c === '"' || c === '`') open = c;
  }
  return open !== null;
}

export function classify(spec, fileRel, root) {
  if (spec.startsWith('node:')) return null;
  if (/^file:/i.test(spec)) return 'file-url';
  if (isAbsolute(spec) || /^[A-Za-z]:[\\/]/.test(spec) || spec.startsWith('\\\\')) return 'absolute-path';
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const target = resolve(root, dirname(fileRel), spec);
    const rel = relative(root, target);
    if (rel.startsWith('..') || isAbsolute(rel)) return 'outside-pack';
    // Plugins run as copies in plugins.local/<id>/, so a reach outside their own directory breaks there.
    const m = /^plugins\/([^/]+)\//.exec(fileRel);
    if (m) {
      const inside = relative(join(root, 'plugins', m[1]), target);
      if (inside.startsWith('..')) return 'plugin-escape';
    }
    return null;
  }
  return ALLOWED_BARE.has(spec) ? null : 'bare-specifier';
}

export function lintText(fileRel, text, root = '.') {
  const findings = [];
  const lineOf = (i) => text.slice(0, i).split('\n').length;
  const seen = new Set();
  const add = (idx, rule) => {
    const key = `${idx}:${rule}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push({ file: fileRel, line: lineOf(idx), rule });
    }
  };
  for (const re of [STATIC_RE, SIDE_EFFECT_RE, DYNAMIC_LITERAL_RE, REQUIRE_RE]) {
    for (const m of text.matchAll(re)) {
      const at = m.index + m[0].search(/\S/);
      if (isFullLineComment(text, at) || insideString(text, at)) continue;
      const rule = classify(m[2], fileRel, root);
      if (rule) add(at, rule);
    }
  }
  const literal = new Set([...text.matchAll(DYNAMIC_LITERAL_RE)].map((m) => m.index));
  for (const m of text.matchAll(DYNAMIC_ANY_RE)) {
    if (literal.has(m.index) || isFullLineComment(text, m.index) || insideString(text, m.index)) continue;
    add(m.index, 'dynamic-import-nonliteral');
  }
  return findings;
}

export function lintImports(root) {
  return walk(root, root, []).flatMap((rel) => lintText(rel, readFileSync(join(root, rel), 'utf8'), root));
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: {} });
  const root = resolve(flags.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const findings = lintImports(root);
  for (const f of findings) console.log(`${f.file}:${f.line} ${f.rule}`);
  console.log(findings.length ? `lint-imports: ${findings.length} finding(s)` : 'lint-imports: clean');
  return findings.length ? 1 : 0;
}

if (isMain(import.meta.url)) await runCli(main);
