#!/usr/bin/env node
// Tracked-file lint for the Node-only and plain-punctuation rules.
// Its own patterns are built from char codes so this file passes its own scan.
// Exit 0 clean, 1 findings (file:line rule), 2 usage.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runCli, isMain } from '../lib/args.mjs';
import { runText } from '../lib/run.mjs';

const chars = (...codes) => String.fromCharCode(...codes);
const BANNED_EXT = ['sh', 'bash', 'zsh', 'ps1', 'py', 'bat', 'cmd', 'command'];
const MAC_ONLY_TOKEN = chars(111, 115, 97, 115, 99, 114, 105, 112, 116);
const TYPOGRAPHY = new Set([0x2014, 0x2018, 0x2019, 0x201c, 0x201d].map((c) => String.fromCodePoint(c)));
const TYPO_EXT = /\.(md|yml|yaml|json|mjs|js)$/;
const CODE_EXT = /\.(mjs|js)$/;

function listFiles(root) {
  try {
    const out = runText('git', ['ls-files', '-z'], { cwd: root });
    return out.split('\0').filter(Boolean);
  } catch {
    const acc = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        const abs = join(dir, e.name);
        if (e.isDirectory()) walk(abs);
        else acc.push(relative(root, abs).split(sep).join('/'));
      }
    };
    walk(root);
    return acc;
  }
}

export function lintFiles(root) {
  const findings = [];
  for (const rel of listFiles(root)) {
    const ext = rel.split('.').pop().toLowerCase();
    if (rel.includes('.') && BANNED_EXT.includes(ext)) findings.push({ file: rel, line: 0, rule: 'shell-or-python' });
    if (!TYPO_EXT.test(rel)) continue;
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    text.split('\n').forEach((line, i) => {
      if (CODE_EXT.test(rel) && !rel.startsWith('tests/') && line.includes(MAC_ONLY_TOKEN)) {
        findings.push({ file: rel, line: i + 1, rule: MAC_ONLY_TOKEN });
      }
      if ([...line].some((c) => TYPOGRAPHY.has(c))) findings.push({ file: rel, line: i + 1, rule: 'typography' });
    });
  }
  return findings;
}

function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: {} });
  const root = resolve(flags.root ?? join(fileURLToPath(new URL('.', import.meta.url)), '..'));
  const findings = lintFiles(root);
  for (const f of findings) console.log(`${f.file}:${f.line} ${f.rule}`);
  console.log(findings.length ? `lint-files: ${findings.length} finding(s)` : 'lint-files: clean');
  return findings.length ? 1 : 0;
}

if (isMain(import.meta.url)) await runCli(main);
