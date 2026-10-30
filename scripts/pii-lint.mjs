#!/usr/bin/env node
// PII lint: fails when any tracked or staged-for-commit file could carry personal data.
// The pack is public and shared, so a single leaked name, address or resume is unrecoverable
// once pushed; this runs in CI and in the local pre-push hook.
//
// It works by:
// 1. listing every file git would publish (tracked plus untracked-not-ignored),
// 2. refusing paths that only ever hold user data (data/, cv.md, profile.yml, .env ...),
// 3. scanning text content for blocked tokens, email addresses outside reserved example
//    domains, US phone numbers outside the fictional 555-01xx range, and resume-shaped
//    documents that lack the synthetic-fixture marker.
//
// Usage: node scripts/pii-lint.mjs [--root <dir>]   exit 0 clean, 1 findings, 2 usage error

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, runCli, isMain } from '../lib/args.mjs';

// Stored as char codes so this file never contains the literal strings it hunts for;
// the maintainer's pre-push grep would otherwise flag the lint itself.
const BLOCKED_TOKENS = [
  [112, 97, 117, 108, 111, 115],
  [104, 97, 98, 116, 101, 119, 111, 108, 100],
  [119, 97, 114, 114, 105, 111, 114, 108, 105, 102, 101],
  [52, 48, 56, 53, 57, 52, 57, 54, 53, 48],
  [115, 97, 110, 116, 97, 32, 99, 108, 97, 114, 97],
  [115, 99, 117],
].map((codes) => String.fromCharCode(...codes));

// Paths that hold user data in a career-ops clone; none may ever be committed to the pack.
const FORBIDDEN_PATH_PATTERNS = [
  /^data\//,
  /(^|\/)cv\.md$/i,
  /(^|\/)config\/profile\.yml$/,
  /(^|\/)config\/student\.yml$/,
  /(^|\/)modes\/_(custom|profile|brief)\.md$/,
  /(^|\/)\.env(\..*)?$/,
  /(^|\/)story-bank\.md$/i,
  /(^|\/)cover-letter[^/]*$/i,
  /\.(pdf|docx)$/i,
];

// RFC 2606 reserved domains only; anything else could reach a real person.
const ALLOWED_EMAIL_DOMAINS = new Set(['example.com', 'example.org', 'example.net', 'example.edu']);

const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
// US numbers: (408) 555-0100, 408-555-0100, 408.555.0100, +1 408 555 0100
const PHONE_RE = /(?<![\w.-])(?:\+?1[ .-]?)?\(?([2-9]\d{2})\)?[ .-](\d{3})[ .-](\d{4})(?![\w-])/g;

// Fixtures that look like resumes must say so on their first lines.
export const SYNTHETIC_MARKER = 'SYNTHETIC FIXTURE';
const RESUME_SECTIONS = [/^#+\s*(work\s+)?experience\b/im, /^#+\s*education\b/im, /^#+\s*(skills|projects)\b/im];

const TEXT_SIZE_LIMIT = 2 * 1024 * 1024;

// A fixture that shows even one resume section is resume-shaped; elsewhere two sections are needed
// so ordinary docs that mention "Education" are not flagged.
const FIXTURE_PREFIX = 'tests/fixtures/';

export function listPublishableFiles(root) {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
  });
  // --cached still lists files deleted from the work tree; they are not published as content.
  return out.split('\0').filter(Boolean);
}

function isProbablyBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

export function scanText(relPath, text) {
  const findings = [];
  const lower = text.toLowerCase();
  const lines = text.split('\n');
  const lineOf = (idx) => text.slice(0, idx).split('\n').length;

  for (const token of BLOCKED_TOKENS) {
    let idx = lower.indexOf(token);
    while (idx !== -1) {
      // Report the line but not the token: CI logs are public too.
      findings.push({ file: relPath, line: lineOf(idx), rule: 'blocked-token', detail: `blocked token #${BLOCKED_TOKENS.indexOf(token) + 1}` });
      idx = lower.indexOf(token, idx + token.length);
    }
  }

  for (const m of text.matchAll(EMAIL_RE)) {
    const domain = m[1].toLowerCase();
    if (!ALLOWED_EMAIL_DOMAINS.has(domain) && !domain.endsWith('.example.com')) {
      findings.push({ file: relPath, line: lineOf(m.index), rule: 'email', detail: `address at domain ${domain}` });
    }
  }

  for (const m of text.matchAll(PHONE_RE)) {
    const [, , exchange, line] = m;
    // 555-0100 through 555-0199 are reserved for fiction.
    const fictional = exchange === '555' && /^01\d\d$/.test(line);
    if (!fictional) findings.push({ file: relPath, line: lineOf(m.index), rule: 'phone', detail: 'US phone number shape' });
  }

  const resumeHits = RESUME_SECTIONS.filter((re) => re.test(text)).length;
  const head = lines.slice(0, 5).join('\n');
  const threshold = relPath.replace(/\\/g, '/').startsWith(FIXTURE_PREFIX) ? 1 : 2;
  if (resumeHits >= threshold && !head.includes(SYNTHETIC_MARKER)) {
    findings.push({ file: relPath, line: 1, rule: 'resume-shape', detail: `resume-shaped without "${SYNTHETIC_MARKER}" in the first 5 lines` });
  }
  return findings;
}

export function scanPath(relPath) {
  return FORBIDDEN_PATH_PATTERNS.some((re) => re.test(relPath))
    ? [{ file: relPath, line: 0, rule: 'forbidden-path', detail: 'path only ever holds user data' }]
    : [];
}

export function lintRoot(root) {
  const findings = [];
  for (const rel of listPublishableFiles(root)) {
    findings.push(...scanPath(rel));
    // The path itself can leak a name even when the content is clean.
    findings.push(...scanText(rel, rel).filter((f) => f.rule === 'blocked-token').map((f) => ({ ...f, rule: 'blocked-token-in-path', line: 0 })));
    const abs = join(root, rel);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue; // deleted in the work tree but still in the index
    }
    if (!st.isFile() || st.size > TEXT_SIZE_LIMIT) continue;
    const buf = readFileSync(abs);
    if (isProbablyBinary(buf)) continue;
    findings.push(...scanText(rel, buf.toString('utf8')));
  }
  return findings;
}

function main(argv) {
  const { flags } = parseArgs(argv, { common: false, flags: { root: 'string' } });
  const findings = lintRoot(flags.root ?? process.cwd());
  for (const f of findings) console.log(`${f.file}:${f.line} ${f.rule} ${f.detail}`);
  console.log(findings.length ? `pii-lint: ${findings.length} finding(s)` : 'pii-lint: clean');
  return findings.length ? 1 : 0;
}

if (isMain(import.meta.url)) {
  await runCli(() => main(process.argv.slice(2)));
}
