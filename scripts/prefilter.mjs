#!/usr/bin/env node
// Free title-only filter for untriaged Pending rows; runs before any paid triage.
// Prints 'TRIAGE: FAIL | url | 0.0/5 | Title pre-filter: <reason> (<title>)' lines for apply-triage.mjs.
// Only unambiguous title-level rules live here; anything that needs the JD is left to triage.
// Usage: prefilter.mjs [--root R] [--data-dir D] [--today YYYY-MM-DD]
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, runCli } from '../lib/args.mjs';
import { loadStudentConfig } from '../lib/config.mjs';
import { readCycle } from '../lib/cycle-file.mjs';
import { parsePipeline, sectionRows } from '../lib/pipeline-md.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { loadMerged } from '../lib/presets.mjs';

const ABOVE_ENTRY = [
  [/\b(senior|sr\.?|staff|principal|distinguished|director|manager|head of)\b/i, 'above entry level'],
  [/\b(technical lead(er)?|tech lead|team lead|lead)\b/i, 'lead role'],
  [/\b(engineer|developer|analyst|scientist|level|grade)\s*(iii|iv|v|3|4|5)\b|\b(iii|iv)\b/i, 'level III+'],
];
const PHD = /\bph\.?d\b/i;
const MS_OK = /\b(ms|m\.s\.|master'?s?)\b/i;
const LADDER = /\b(i|1)\s*(\/|-|or|to)\s*(ii|2)\b/i;
const TERM_RE = /(?<![A-Za-z0-9])(fall|autumn|winter|spring|summer)\s*(20\d\d)(?![A-Za-z0-9])/gi;

// Job ids catch the same posting under different URL spellings (board, embed, redirect).
export function jobIds(text) {
  const ids = [];
  const s = String(text);
  for (const m of s.matchAll(/amazon\.jobs\/(?:[a-z]{2}\/)?jobs\/(\d{6,})/gi)) ids.push(`amazon:${m[1]}`);
  for (const m of s.matchAll(/(?:gh_jid=|greenhouse\.io\/[\w-]+\/jobs\/|[?&]token=)(\d{6,})/gi)) ids.push(`gh:${m[1]}`);
  for (const m of s.matchAll(/(?:lever\.co|ashbyhq\.com)\/[\w.-]+\/([0-9a-f]{8}-[0-9a-f-]{27})/gi)) ids.push(`uuid:${m[1].toLowerCase()}`);
  for (const m of s.matchAll(/\/\/([\w-]+)\.wd\d+\.myworkdayjobs\.com\/[^\s|]*?_([A-Za-z]*-?\d+)(?:-\d{1,2})?(?=[/?#\s|]|$)/g)) ids.push(`wd:${m[1].toLowerCase()}:${m[2].toLowerCase()}`);
  return ids;
}

function namesOnlyOutOfCycleTerm(title, cycle) {
  const found = [...title.matchAll(TERM_RE)].map((m) => `${m[1].toLowerCase() === 'autumn' ? 'fall' : m[1].toLowerCase()} ${m[2]}`);
  if (!found.length || !cycle?.terms?.length) return false;
  const want = new Set(cycle.terms.map((t) => `${String(t.name).toLowerCase()} ${t.year}`));
  return !found.some((t) => want.has(t));
}

const anyMatch = (patterns, text) => (patterns ?? []).some((p) => new RegExp(p, 'i').test(text));

export function prefilter({ pipelineText, applicationsText = '', preset: merged, config, cycle }) {
  const doc = parsePipeline(pipelineText);
  const appliedIds = new Map();
  for (const line of applicationsText.split('\n')) {
    const num = /^\|\s*(\d+)\s*\|/.exec(line)?.[1];
    if (num && /\|\s*(Applied|Responded|Assessment|Interview|Offer|Hired|Rejected)\s*\|/.test(line)) for (const id of jobIds(line)) appliedIds.set(id, `#${num}`);
  }
  const pending = sectionRows(doc, 'Pending');
  const keeper = new Map();
  for (const { row } of pending) for (const id of jobIds(row.url)) if (!keeper.has(id)) keeper.set(id, row.url);

  const lines = [];
  for (const { row } of pending) {
    const { url, title } = row;
    if (!title) continue;
    const dupOfApplied = jobIds(url).map((id) => appliedIds.get(id)).find(Boolean);
    const dupOfRow = jobIds(url).map((id) => keeper.get(id)).find((k) => k && k !== url);
    // Already-applied and duplicate rows are dropped even after triage: a triaged duplicate would otherwise be ranked.
    if (row.notes.has('triage') && !dupOfApplied && !dupOfRow) continue;
    let reason = null;
    if (dupOfApplied) reason = `already applied (${dupOfApplied}) under another URL`;
    else if (dupOfRow) reason = `duplicate of ${dupOfRow} (same job id)`;
    const ladder = LADDER.test(title);
    for (const [re, why] of ABOVE_ENTRY) {
      if (reason) break;
      if (re.test(title) && !(why === 'level III+' && ladder)) reason = why;
    }
    if (!reason && PHD.test(title) && !MS_OK.test(title)) reason = 'PhD role';
    if (!reason && anyMatch(merged?.title_rules?.exclude, title)) reason = 'excluded title';
    if (!reason && anyMatch(config?.dealbreakers, `${title} ${row.company}`)) reason = 'dealbreaker';
    if (!reason && merged?.early_career && !new RegExp(merged.early_career, 'i').test(title)) reason = 'not an early-career title';
    if (!reason && namesOnlyOutOfCycleTerm(title, cycle)) reason = 'term not in cycle';
    if (reason) lines.push(`TRIAGE: FAIL | ${url} | 0.0/5 | Title pre-filter: ${reason} (${title.replace(/[|;]/g, ',').slice(0, 80)})`);
  }
  return lines;
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2), { flags: {} });
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const config = await loadStudentConfig({ root: paths.root });
  if (!config) throw new Error('config/student.yml is missing: start the personalization interview first');
  const read = (name) => (existsSync(join(paths.dataDir, name)) ? readFileSync(join(paths.dataDir, name), 'utf8') : '');
  const lines = prefilter({
    pipelineText: read('pipeline.md'),
    applicationsText: read('applications.md'),
    preset: loadMerged(config.presets),
    config,
    cycle: readCycle(join(paths.dataDir, 'student-cycle.json')),
  });
  if (lines.length) console.log(lines.join('\n'));
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(main);
