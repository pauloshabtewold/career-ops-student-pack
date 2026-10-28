#!/usr/bin/env node
// Resume guard, run before any upload: the variant's PDF must fit its page limit and the HTML or markdown source it
// was rendered from must show the variant's graduation month and year.
// Usage: check-resume.mjs --pdf FILE --html FILE --variant NAME [--root R]
// Exit 0 ok, 1 mismatch (one line per problem), 2 usage or unknown variant.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UsageError, parseArgs, runCli } from '../lib/args.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';

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

// pdf and html are file paths; config carries resume_variants.
export function checkResume({ pdf, html, variant, config }) {
  const spec = (config.resume_variants ?? []).find((v) => v.name === variant);
  if (!spec) return { code: 2, problems: [`unknown resume variant ${variant}`] };
  const problems = [];
  const pages = countPdfPages(readFileSync(pdf));
  if (pages > spec.page_limit) problems.push(`PDF has ${pages} pages, limit is ${spec.page_limit}`);
  if (!mentionsGraduation(readFileSync(html, 'utf8'), spec.graduation)) problems.push(`source does not show graduation ${spec.graduation} for variant ${variant}`);
  return { code: problems.length ? 1 : 0, problems, pages };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: { pdf: 'string', html: 'string', variant: 'string' } });
  if (!flags.pdf || !flags.html || !flags.variant) throw new UsageError('usage: check-resume.mjs --pdf FILE --html FILE --variant NAME');
  for (const f of [flags.pdf, flags.html]) if (!existsSync(f)) throw new UsageError(`no such file ${f}`);
  const config = await loadStudentConfig({ root: resolvePaths({ root: flags.root }).root });
  if (!config) throw new UsageError('config/student.yml is missing');
  const res = checkResume({ pdf: flags.pdf, html: flags.html, variant: flags.variant, config });
  if (res.code === 0) console.log(`check-resume: OK ${flags.variant} (${res.pages} page${res.pages === 1 ? '' : 's'})`);
  else for (const p of res.problems) console.log(`check-resume: ${p}`);
  return res.code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(main);
