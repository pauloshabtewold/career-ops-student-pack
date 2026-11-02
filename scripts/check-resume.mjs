#!/usr/bin/env node
// Resume guard, run before any upload: the variant's PDF must fit its page limit, carry a text layer that shows the
// source's email and phone with spaces between words and uses ASCII hyphens in date ranges (applicant-tracking
// parsers drop other dashes and read run-together words as one), and
// the HTML or markdown source it was rendered from must show the variant's graduation month and year.
// Usage: check-resume.mjs --pdf FILE --html FILE --variant NAME [--root R]
// Exit 0 ok, 1 mismatch (one line per problem), 2 usage or unknown variant.
import { existsSync, readFileSync } from 'node:fs';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { extractPdfText } from '../lib/pdf-text.mjs';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Counts page objects without a PDF library. Pages hidden in compressed object streams fall back to the page
// tree's /Count, which every PDF writer emits.
export function countPdfPages(buffer) {
  const text = buffer.toString('latin1');
  const direct = [...text.matchAll(/\/Type\s*\/Page(?![A-Za-z])/g)].length;
  if (direct > 0) return direct;
  const counts = [...text.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  return counts.length ? Math.max(...counts) : 0;
}

export function mentionsGraduation(sourceText, graduation) {
  const [year, month] = graduation.split('-');
  const name = MONTHS[Number(month) - 1];
  const flat = sourceText.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const forms = [`${name} ${year}`, `${name.slice(0, 3)}.? ${year}`, `${month}/${year}`];
  return forms.some((f) => new RegExp(`\\b${f}\\b`, 'i').test(flat));
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i;
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/;
// U+2010 to U+2015, minus sign, small and fullwidth hyphen-minus.
const DATE_PART = '(?:(?:19|20)\\d{2}|\\d{1,2}\\/\\d{2,4})';
const BAD_RANGE = new RegExp(`${DATE_PART}\\s*[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]\\s*(?:${DATE_PART}|present|current|now|[a-z]{3,9}\\.?\\s+(?:19|20)\\d{2})`, 'i');

// Visible words of the HTML or markdown source, lowercased, in reading order. Style and script bodies are not words.
export function sourceWords(sourceText) {
  const flat = sourceText.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
  return flat.toLowerCase().match(/[a-z]+/g) ?? [];
}

const GLUE_HINT =
  'ATS parsers read run-together text as one word; re-render with real spaces (no letter-spacing, word-spacing or text-align: justify on body text, a font that has a space glyph) and check again';

// Glued words: a text layer with no spaces between words (a common result of per-glyph positioning) reads as
// "SoftwareEngineerIntern". Two signals, either one fails:
// 1. Source pairs: of the adjacent source word pairs (3+ letters each) whose letters appear in the PDF text, at
//    least 5 and 30% appear only joined ("ab", never "a b"). Columns and reordering make a pair absent, not glued.
// 2. Without a usable source: 2 or more letter runs of 25+ characters, which no resume word reaches.
export function gluedWords(pdfText, words = []) {
  const flat = ` ${pdfText.toLowerCase().replace(/\s+/g, ' ')} `;
  let present = 0;
  const glued = [];
  for (let i = 0; i + 1 < words.length; i++) {
    const [a, b] = [words[i], words[i + 1]];
    if (a.length < 3 || b.length < 3) continue;
    const spaced = flat.includes(`${a} ${b}`);
    const joined = flat.includes(`${a}${b}`);
    if (!spaced && !joined) continue;
    present++;
    if (joined && !spaced) glued.push(`${a}${b}`);
  }
  if (present >= 5 && glued.length >= 5 && glued.length / present >= 0.3) return [...new Set(glued)].slice(0, 2);
  const runs = pdfText.match(/[A-Za-z]{25,}/g) ?? [];
  return runs.length >= 2 ? runs.slice(0, 2) : [];
}

export function sourceContacts(sourceText) {
  const flat = sourceText.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#64;/g, '@');
  return { email: flat.match(EMAIL)?.[0] ?? null, phone: flat.match(PHONE)?.[0] ?? null };
}

// Problems found in a PDF text layer against the source's email and phone.
export function textLayerProblems(pdfText, { email, phone }, words = []) {
  if (!pdfText.trim()) return ['PDF has no text layer (image-only); export it with selectable text'];
  const problems = [];
  if (email && !pdfText.replace(/\s+/g, '').toLowerCase().includes(email.toLowerCase())) problems.push(`email ${email} is not text in the PDF`);
  if (phone && !pdfText.replace(/\D/g, '').includes(phone.replace(/\D/g, '').slice(-10))) problems.push(`phone ${phone} is not text in the PDF`);
  const bad = pdfText.match(BAD_RANGE);
  if (bad) problems.push(`date range "${bad[0]}" uses a non-ASCII dash; use an ASCII hyphen (-)`);
  const glued = gluedWords(pdfText, words);
  if (glued.length) problems.push(`PDF text runs words together (${glued.map((g) => `"${g}"`).join(', ')}); ${GLUE_HINT}`);
  return problems;
}

// pdf and html are file paths; config carries resume_variants.
export async function checkResume({ pdf, html, variant, config }) {
  const spec = (config.resume_variants ?? []).find((v) => v.name === variant);
  if (!spec) return { code: 2, problems: [`unknown resume variant ${variant}`] };
  const problems = [];
  const buffer = readFileSync(pdf);
  const source = readFileSync(html, 'utf8');
  const pages = countPdfPages(buffer);
  if (pages > spec.page_limit) problems.push(`PDF has ${pages} pages, limit is ${spec.page_limit}`);
  try {
    problems.push(...textLayerProblems(await extractPdfText(buffer), sourceContacts(source), sourceWords(source)));
  } catch (err) {
    problems.push(`PDF text layer could not be read: ${err.message}`);
  }
  if (!mentionsGraduation(source, spec.graduation)) problems.push(`source does not show graduation ${spec.graduation} for variant ${variant}`);
  return { code: problems.length ? 1 : 0, problems, pages };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { pdf: 'string', html: 'string', variant: 'string' } });
  if (!flags.pdf || !flags.html || !flags.variant) throw new UsageError('usage: check-resume.mjs --pdf FILE --html FILE --variant NAME');
  for (const f of [flags.pdf, flags.html]) if (!existsSync(f)) throw new UsageError(`no such file ${f}`);
  const config = await loadStudentConfig({ root: resolvePaths({ root: flags.root }).root });
  if (!config) throw new UsageError('config/student.yml is missing');
  const res = await checkResume({ pdf: flags.pdf, html: flags.html, variant: flags.variant, config });
  if (res.code === 0) console.log(`check-resume: OK ${flags.variant} (${res.pages} page${res.pages === 1 ? '' : 's'})`);
  else for (const p of res.problems) console.log(`check-resume: ${p}`);
  return res.code;
}

if (isMain(import.meta.url)) await runCli(main);
