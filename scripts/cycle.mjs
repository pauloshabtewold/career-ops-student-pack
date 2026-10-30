#!/usr/bin/env node
// Which internship terms and new-grad years are in play, from the student's graduation dates and the primary
// preset's recruiting calendar. Writes data/student-cycle.json (read by the ingest plugin and prefilter) and
// refreshes only the text between cycle markers in modes/_brief.md, modes/_custom.md and portals.yml.
// Usage: cycle.mjs [--json] [--dry-run] [--today YYYY-MM-DD] [--root R] [--data-dir D]
// --today pins the date for simulation, so it is allowed only with --dry-run or --json (a simulated date must
// never reach the real files).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { writeCycle } from '../lib/cycle-file.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { loadMerged } from '../lib/presets.mjs';
import { writeAtomic } from '../lib/tsv.mjs';

const pad = (n) => String(n).padStart(2, '0');
const orList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

function parseYm(text) {
  const m = /^(\d{4})-(\d{2})$/.exec(text);
  return { year: Number(m[1]), month: Number(m[2]), iso: `${m[1]}-${m[2]}-01` };
}

function addMonthsIso(today, months) {
  const [y, m, d] = today.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, d));
  return t.toISOString().slice(0, 10);
}

/**
 * tracks: [{kind, graduation: 'YYYY-MM'}]; calendar: preset recruiting_calendar.
 * Internship terms are the calendar terms of the cycle year that start within lead_months and before the internship
 * graduation (an internship needs the student still enrolled). New-grad years follow the cycle year, which steps
 * forward in rollover_month because that is when employers open next year's postings.
 */
export function computeCycle({ tracks, calendar, today, experienceYears = 0 }) {
  const thisYear = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const cycleYear = thisYear + (month >= calendar.rollover_month ? 1 : 0);
  const intern = tracks.filter((t) => t.kind === 'internship' || t.kind === 'coop').map((t) => parseYm(t.graduation));
  const internEnd = intern.length ? intern.map((g) => g.iso).sort().pop() : null;
  const horizon = addMonthsIso(today, calendar.lead_months);

  const terms = [];
  if (internEnd) {
    for (const t of calendar.terms) {
      const start = `${cycleYear}-${pad(t.start_month)}-01`;
      // A December start is labelled with the following year, matching how job lists name winter terms.
      const year = t.start_month === 12 ? cycleYear + 1 : cycleYear;
      if (start <= horizon && start < internEnd) terms.push({ name: t.name, year, start });
    }
  }
  const finals = tracks.filter((t) => t.kind === 'newgrad').map((t) => parseYm(t.graduation));
  // Graduation is read from the new-grad tracks when there are any, otherwise from the latest track, so an
  // internship-only student still gets a phase.
  const grad = [...(finals.length ? finals : tracks.map((t) => parseYm(t.graduation)))].sort((a, b) => a.iso.localeCompare(b.iso)).pop();
  const monthsSince = grad ? (thisYear - grad.year) * 12 + (month - grad.month) : -1;
  const phase = monthsSince < 0 ? 'student' : monthsSince < 12 ? 'new_grad' : 'early_career';
  // A student sees new-grad postings only for a new-grad track that graduates by the cycle year; an internship-only
  // student has no new-grad year, so new-grad rows are not theirs.
  const newgradYears = phase === 'student' ? (finals.some((g) => g.year <= cycleYear) ? [cycleYear] : []) : phase === 'new_grad' ? [thisYear, cycleYear] : [];
  const expYears = experienceYears + Math.max(0, Math.floor(monthsSince / 12));
  return {
    computed_at: today,
    today,
    phase,
    terms,
    newgrad_years: [...new Set(newgradYears)].filter((y) => y >= thisYear).sort(),
    internship_years: [...new Set(terms.map((t) => t.year))].sort(),
    experience_ceiling_years: phase === 'early_career' ? expYears + 1 : 1,
  };
}

const termLabel = (t) => `${t.name} ${t.year}`;

// Block prose is neutral (no pronouns) and carries no field-specific queries.
function blockText(name, c) {
  const labels = c.terms.map(termLabel);
  const termList = labels.length ? orList(labels) : 'none (no internship term is left in this cycle, so every internship is out)';
  switch (name) {
    case 'terms':
      return termList;
    case 'newgrad-years':
      return orList(c.newgrad_years.map(String)) || 'none';
    case 'dq-term':
      return `Internship term other than ${termList} (any term that has already started is out)`;
    case 'years':
    case 'unstated-year':
      return orList([...new Set([...c.internship_years, ...c.newgrad_years])].map(String));
    case 'above-entry':
      return c.phase === 'early_career'
        ? `senior, staff, principal, lead, manager, level III+, more than ${c.experience_ceiling_years} years required`
        : 'senior, staff, principal, lead, manager, mid-level, level III+, 2+ years required';
    case 'experience':
      return `Experience asks up to ${c.experience_ceiling_years} year${c.experience_ceiling_years === 1 ? '' : 's'} are fine; more is a FAIL.`;
    case 'phase':
      return {
        student: 'student: internships for the terms above, plus new-grad roles for the years above.',
        new_grad: 'new grad (graduated under a year ago): no internships; new-grad and entry-level full-time roles.',
        early_career: 'early career (graduated over a year ago): entry-level and level I or II roles within the experience ceiling.',
      }[c.phase];
    default:
      return null;
  }
}

const BLOCK_RE = /<!-- cycle:start (\S+) -->([\s\S]*?)<!-- cycle:end \1 -->/g;
const YAML_BLOCK_RE = /^([ \t]*)# cycle:start (\S+)[^\n]*\n([\s\S]*?)^[ \t]*# cycle:end \2[^\n]*$/gm;

export function rewriteBlocks(text, cycle) {
  const blocks = [];
  const out = text.replace(BLOCK_RE, (whole, name, body) => {
    const next = blockText(name, cycle);
    if (next === null) return whole;
    blocks.push({ name, changed: next !== body });
    return `<!-- cycle:start ${name} -->${next}<!-- cycle:end ${name} -->`;
  });
  return { text: out, blocks };
}

// portals.yml spans use comment markers; the title_filter negative list names terms and years outside the cycle.
export function rewritePortals(text, cycle) {
  const blocks = [];
  const out = text.replace(YAML_BLOCK_RE, (whole, ind, name, body) => {
    if (name !== 'portals-neg') return whole;
    const last = Math.max(...cycle.newgrad_years, ...cycle.internship_years, Number(cycle.today.slice(0, 4)));
    const negatives = [`${last + 1}`, `New Grad ${last - 1}`, `${last - 1} New Grad`];
    const next = `${negatives.map((n) => `${ind}  - "${n}"`).join('\n')}\n`;
    blocks.push({ name, changed: next !== body });
    return `${ind}# cycle:start ${name}\n${next}${ind}# cycle:end ${name}`;
  });
  return { text: out, blocks };
}

export function runCycle({ paths, config, merged, today, dryRun }) {
  const cycle = computeCycle({ tracks: config.tracks, calendar: merged.recruiting_calendar, today, experienceYears: config.experience_years });
  const touched = [];
  if (!dryRun) {
    writeCycle(join(paths.dataDir, 'student-cycle.json'), cycle);
    for (const file of [join(paths.modesDir, '_brief.md'), join(paths.modesDir, '_custom.md')]) {
      if (!existsSync(file)) continue;
      const res = rewriteBlocks(readFileSync(file, 'utf8'), cycle);
      if (res.blocks.some((b) => b.changed)) {
        writeAtomic(file, res.text);
        touched.push(file);
      }
    }
    if (existsSync(paths.portalsFile)) {
      const res = rewritePortals(readFileSync(paths.portalsFile, 'utf8'), cycle);
      // Parse before writing: a broken span must never replace a working portals.yml.
      yaml.load(res.text);
      if (res.blocks.some((b) => b.changed)) {
        writeAtomic(paths.portalsFile, res.text);
        touched.push(paths.portalsFile);
      }
    }
  }
  return { cycle, touched };
}

// deps = { config, preset, today, out } replace config loading, preset loading, the wall clock and console output.
export async function main(argv = process.argv.slice(2), deps = {}) {
  const { flags } = parseArgs(argv, { flags: {} });
  if (flags.today && !flags.dryRun && !flags.json) throw new UsageError('--today needs --dry-run or --json: a simulated date must not be written');
  const out = deps.out ?? ((s) => console.log(s));
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const config = deps.config ?? (await loadStudentConfig({ root: paths.root }));
  if (!config) throw new Error('config/student.yml is missing: start the personalization interview first');
  const merged = deps.preset ?? loadMerged(config.presets);
  if (!merged) throw new Error('no preset selected in config/student.yml');
  const today = flags.today ?? deps.today ?? createClock({ timezone: config.timezone }).today();
  const { cycle, touched } = runCycle({ paths, config, merged, today, dryRun: flags.dryRun || flags.json });
  out(flags.json ? JSON.stringify(cycle) : `cycle: phase ${cycle.phase}, terms ${cycle.terms.map(termLabel).join(', ') || 'none'}, new-grad years ${cycle.newgrad_years.join(', ') || 'none'}${touched.length ? `, updated ${touched.length} file(s)` : ''}`);
  return 0;
}

if (isMain(import.meta.url)) await runCli(() => main());
