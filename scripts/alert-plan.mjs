#!/usr/bin/env node
// Prints the job-alert setup steps for the student's field as one numbered batch: LinkedIn, Handshake, Simplify and
// Indeed searches prefilled from the archetypes and locations, plus a USAJOBS search for policy students. The pack never
// logs in to these sites or searches them; the student presses the button, and the daily inbox pass reads the alert mail.
// Makes no network request.
// Usage: alert-plan.mjs [--root R] [--data-dir D]
// Exit 0 after the plan, 1 when the interview has not written config/student.yml.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, runCli, isMain } from '../lib/args.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { loadMerged } from '../lib/presets.mjs';

const enc = encodeURIComponent;
const TRACK_WORD = { internship: 'intern', coop: 'intern', newgrad: 'new grad' };
// LinkedIn's experience-level filter: 1 is internship, 2 is entry level.
const LINKEDIN_LEVEL = { internship: 1, coop: 1, newgrad: 2 };

// One URL per track kind; a site-specific preset search replaces the archetype query for every track.
function queryFor(archetype, kind, override) {
  return override ?? `${archetype} ${TRACK_WORD[kind] ?? 'intern'}`;
}

export function alertPlan({ config, archetypes, merged }) {
  const kinds = [...new Set((config.tracks ?? []).map((t) => t.kind))];
  const tracks = kinds.length ? kinds : ['internship'];
  const archetype = archetypes[0] ?? 'entry level';
  const loc = config.locations?.[0] ?? '';
  const alerts = merged?.sources.alerts ?? [];
  const searchFor = (site) => alerts.find((a) => a.site === site && a.search)?.search;
  const urls = (build, site) => [...new Set(tracks.map((kind) => build(queryFor(archetype, kind, searchFor(site)), kind)))];
  const items = [
    {
      site: 'linkedin',
      title: 'LinkedIn job alert',
      purpose: 'LinkedIn emails you new postings that match your search every day.',
      recommended: true,
      reason: 'alert emails cover every field, including employers with no readable board',
      urls: urls((q, kind) => `https://www.linkedin.com/jobs/search/?keywords=${enc(q)}&location=${enc(loc)}&f_E=${LINKEDIN_LEVEL[kind] ?? 1}`, 'linkedin'),
      button: 'Set alert',
    },
    {
      site: 'handshake',
      title: 'Handshake saved search',
      purpose: 'Handshake emails you new postings from employers recruiting at your school.',
      recommended: true,
      reason: 'it holds campus-only postings that no public list carries',
      urls: urls((q) => `https://app.joinhandshake.com/job-search?query=${enc(q)}`, 'handshake'),
      button: 'Save search, then turn on email alerts',
    },
    {
      site: 'simplify',
      title: 'Simplify saved search',
      purpose: 'Simplify emails you new postings and tracks the ones you apply to.',
      recommended: false,
      reason: 'strongest for software, data and business; needs a free account you create yourself',
      urls: urls((q) => `https://simplify.jobs/jobs?query=${enc(q)}`, 'simplify'),
      button: 'Save search, then turn on email alerts',
    },
    {
      site: 'indeed',
      title: 'Indeed email alert',
      purpose: 'Indeed emails you new postings from a very wide set of employers.',
      recommended: false,
      reason: 'wide coverage but more noise, so add it only if the first alerts leave gaps',
      urls: urls((q) => `https://www.indeed.com/jobs?q=${enc(q)}&l=${enc(loc)}`, 'indeed'),
      button: 'Get new jobs by email',
    },
  ];
  if ((config.presets ?? []).includes('policy-government')) {
    items.push({
      site: 'usajobs',
      title: 'USAJOBS saved search',
      purpose: 'USAJOBS emails you new federal postings, including Pathways programs for students and recent graduates.',
      recommended: true,
      reason: 'federal roles are not on the public lists or boards the pack reads',
      urls: urls((q) => `https://www.usajobs.gov/search/results/?k=${enc(q)}`, 'usajobs'),
      button: 'Save this search',
    });
  }
  const handled = new Set(items.map((i) => i.site));
  const upcoming = alerts.filter((a) => !handled.has(a.site)).map((a) => ({ name: a.name, how: a.how, tag: 'upcoming' }));
  return { items: items.map((item, i) => ({ n: i + 1, ...item })), upcoming };
}

export function formatPlan({ items, upcoming }) {
  const lines = [];
  for (const it of items) {
    lines.push(`${it.n}. ${it.title} (${it.recommended ? 'recommended' : 'optional'}): ${it.purpose}`, `   why: ${it.reason}`);
    lines.push(...it.urls.map((u) => `   open: ${u}`), `   then press: ${it.button}`);
  }
  if (upcoming.length) lines.push('', 'Upcoming and check by hand:', ...upcoming.map((u) => `- ${u.name} (upcoming): ${u.how}`));
  return lines;
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const config = await loadStudentConfig({ root: paths.root });
  if (!config) {
    console.log('INTERVIEW: run student/interview/interview.md before anything else');
    return 1;
  }
  const answersFile = join(paths.dataDir, 'interview-answers.json');
  const archetypes = existsSync(answersFile) ? (JSON.parse(readFileSync(answersFile, 'utf8')).archetypes ?? []) : [];
  const plan = alertPlan({ config, archetypes, merged: loadMerged(config.presets ?? [], { root: paths.root }) });
  console.log(formatPlan(plan).join('\n'));
  return 0;
}

if (isMain(import.meta.url)) await runCli(main);
