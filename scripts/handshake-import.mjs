#!/usr/bin/env node
// Turns Handshake result pages the student exported or pasted into pipeline staging rows. No network request.
// Input TSV lines: id, company, title, location, age ("New", "4d ago", "2wk ago", "1mo ago").
// Keeps rows matching the preset title rules, US locations, and posted within about a month; skips ids already in
// staging, pipeline.md or applications.md. merge-post.mjs moves the staged rows into Pending.
// Usage: handshake-import.mjs page1.tsv [page2.tsv ...] [--out FILE] [--dry-run] [--data-dir D] [--today D]
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { loadMerged } from '../lib/presets.mjs';

const US_STATE = /,\s*[A-Z]{2}\b/;
const FOREIGN = /\b(canada|india|china|united kingdom|uk|ireland|germany|singapore|mexico|brazil|japan|israel|poland|london|toronto|vancouver|dublin)\b/i;
const anyMatch = (patterns, text) => (patterns ?? []).some((p) => new RegExp(p, 'i').test(text));
const fresh = (age) => !/(\d+)\s*mo/.test(age) || Number(/(\d+)\s*mo/.exec(age)[1]) <= 1;
const clean = (s) => s.replace(/\|/g, '/');

const idsIn = (text) => [...text.matchAll(/joinhandshake\.com\/(?:jobs|job-search)\/(\d+)/g)].map((m) => m[1]);

// pages: TSV strings without a header; knownTexts: texts that may already hold job ids.
export function importPages({ pages, preset, config, knownTexts = [], today }) {
  const stats = { cards: 0, notMatching: 0, notUs: 0, old: 0, known: 0 };
  const lines = [];
  const known = new Set(knownTexts.flatMap(idsIn));
  const locations = (config.locations ?? []).map((l) => l.toLowerCase());
  for (const text of pages) {
    for (const line of text.split('\n')) {
      const [id, company, title, location = '', age = ''] = line.split('\t').map((s) => s.trim());
      if (!/^\d+$/.test(id ?? '') || !company || !title) continue;
      stats.cards++;
      const include = preset?.title_rules?.include ?? [];
      const titleOk = !preset || !include.length || anyMatch(include, title);
      if (!titleOk || anyMatch(preset?.title_rules?.exclude, title)) {
        stats.notMatching++;
        continue;
      }
      const usish = US_STATE.test(location) || /united states|\bremote\b|\busa?\b/i.test(location) || locations.some((l) => location.toLowerCase().includes(l));
      if (!usish || FOREIGN.test(location)) {
        stats.notUs++;
        continue;
      }
      if (!fresh(age)) {
        stats.old++;
        continue;
      }
      if (known.has(id)) {
        stats.known++;
        continue;
      }
      known.add(id);
      const posted = age.replace(/\s*ago$/i, '').replace(/[;|]/g, ',');
      lines.push(`- [ ] https://app.joinhandshake.com/jobs/${id} | ${clean(company)} | ${clean(title)} | ${clean(location)} | note: src=handshake; imported=${today}; posted~${posted}`);
    }
  }
  return { lines, stats };
}

// deps = { config, preset, out } replace config loading, preset loading and console output.
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { command, positionals: rest, flags } = parseArgs(argv, { flags: { out: 'string' } });
  const positionals = command === null ? rest : [command, ...rest];
  if (!positionals.length) throw new UsageError('usage: handshake-import.mjs page1.tsv [page2.tsv ...]');
  const print = deps.out ?? ((s) => console.log(s));
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const config = deps.config ?? (await loadStudentConfig({ root: paths.root }));
  if (!config) throw new Error('config/student.yml is missing: start the personalization interview first');
  const preset = deps.preset ?? loadMerged(config.presets);
  const out = flags.out ?? join(paths.dataDir, 'pipeline.staging.md');
  const knownTexts = [out, join(paths.dataDir, 'pipeline.md'), join(paths.dataDir, 'applications.md')].filter((f) => existsSync(f)).map((f) => readFileSync(f, 'utf8'));
  const today = flags.today ?? deps.today ?? createClock({ timezone: config.timezone }).today();
  const { lines, stats } = importPages({ pages: positionals.map((f) => readFileSync(f, 'utf8')), preset, config, knownTexts, today });
  if (!flags.dryRun && lines.length) appendFileSync(out, `${lines.join('\n')}\n`);
  print(`handshake-import: ${stats.cards} cards -> ${lines.length} new rows${flags.dryRun ? ' (dry run)' : ''} (dropped: ${stats.notMatching} not matching, ${stats.notUs} non-US, ${stats.old} old, ${stats.known} known)`);
  if (flags.dryRun) for (const r of lines) print(r);
  return 0;
}

if (isMain(import.meta.url)) await runCli(() => main());
