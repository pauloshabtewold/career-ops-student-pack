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

function declares(source, flag) {
  const quoted = new RegExp(`['"]${flag}['"]`);
  const key = new RegExp(`(^|[\\s{,])${flag}\\s*:`, 'm');
  const literal = source.includes(`--${flag}`);
  return quoted.test(source) || key.test(source) || literal;
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
      for (const f of args.matchAll(/(?:^|\s)--([a-z][a-z0-9-]*)/g)) {
        if (!(f[1] in COMMON_FLAGS) && !declares(source, f[1])) problems.push(`${at}: ${rel} does not declare --${f[1]}`);
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
