#!/usr/bin/env node
// Proposes which field preset fits a resume, so the interview can show its evidence instead of asking cold.
// Each preset in interview/field-keywords.json is scored by how many of its keywords appear in the resume text
// (whole words, any letter case). Fewer than MIN_SCORE matches is not evidence of a field, so the pick falls back to
// byo-employer-list, which works for any field because the student supplies the employers.
// Usage: detect-field.mjs <resume text file> [--json]
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, runCli } from '../lib/args.mjs';

// One matching keyword can be a stray word, so two distinct hits are required before a preset is proposed.
export const MIN_SCORE = 2;
// Needs no field knowledge: the student supplies the employers, so it fits any resume.
export const FALLBACK = 'byo-employer-list';
const EVIDENCE_LINES = 3;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Whole-word match, so a short keyword does not hit inside a longer word.
const termRe = (term) => new RegExp(`(?<![A-Za-z0-9])${escapeRe(term)}(?![A-Za-z0-9])`, 'i');

export function loadKeywords(file = join(dirname(fileURLToPath(import.meta.url)), 'field-keywords.json')) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

// Returns { pick, ranked } with ranked sorted by score then id; each entry is { id, score, evidence }.
export function detectField(cvText, keywords = loadKeywords()) {
  const lines = cvText.split('\n').map((l) => l.trim()).filter(Boolean);
  const ranked = Object.entries(keywords.presets)
    .map(([id, terms]) => {
      const hits = [...new Set(terms)].filter((t) => termRe(t).test(cvText));
      const res = hits.map(termRe);
      const evidence = lines.filter((l) => res.some((re) => re.test(l))).slice(0, EVIDENCE_LINES);
      return { id, score: hits.length, evidence };
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const pick = ranked[0] && ranked[0].score >= MIN_SCORE ? ranked[0].id : FALLBACK;
  // The proposed preset leads the list, so a fallback pick is shown first rather than behind a zero-score alphabetical entry.
  const lead = ranked.find((r) => r.id === pick);
  return { pick, ranked: lead ? [lead, ...ranked.filter((r) => r !== lead)] : ranked };
}

async function main() {
  const { command, positionals, flags } = parseArgs(process.argv.slice(2), { common: false, flags: { json: 'boolean' } });
  if (!command || positionals.length) throw new UsageError('usage: detect-field.mjs <resume text file> [--json]');
  let text;
  try {
    text = readFileSync(resolve(command), 'utf8');
  } catch (err) {
    throw new UsageError(`cannot read ${command}: ${err.code ?? err.message}`);
  }
  const res = detectField(text);
  const top = res.ranked.slice(0, 2);
  if (flags.json) console.log(JSON.stringify({ pick: res.pick, ranked: top }, null, 2));
  else {
    top.forEach((r, i) => {
      console.log(`${i + 1}. ${r.id}  score ${r.score}`);
      for (const line of r.evidence) console.log(`     ${line}`);
    });
    console.log(`pick: ${res.pick}${res.pick === FALLBACK && (top[0]?.score ?? 0) < MIN_SCORE ? ` (best score is below ${MIN_SCORE})` : ''}`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(main);
