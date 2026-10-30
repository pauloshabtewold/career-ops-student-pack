#!/usr/bin/env node
// Deterministic half of the personalization interview: validates the answers file and writes everything the
// interview decides. The conversation (interview.md) is LLM-driven; this step is not, so five synthetic answer sets
// can be applied in CI without a model. Nothing is written when validation fails, and onboarding.complete flips to
// true only after every other file and the cycle computation succeeded.
// Usage: apply-answers.mjs <answers.json> [--root R] [--today YYYY-MM-DD] [--dry-run]
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import * as yaml from 'js-yaml';
import { UsageError, parseArgs, runCli, isMain } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { deepMerge, validateConfig } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { effectiveTitleRules, loadMerged, toUpstreamTerms } from '../lib/presets.mjs';
import { writeAtomic } from '../lib/tsv.mjs';
import { runCycle } from '../scripts/cycle.mjs';
import { CEILINGS, effectiveLimits } from '../scripts/budget.mjs';

export class AnswersError extends Error {
  constructor(problems) {
    super(`answers file is not valid:\n- ${problems.join('\n- ')}`);
    this.problems = problems;
  }
}

// Small JSON Schema subset: type, enum, pattern, minLength, minItems, maxItems, minimum, required, properties,
// additionalProperties (boolean or schema), items. Enough for answers.schema.json without a validator dependency.
export function validateAgainst(schema, value, path = '$') {
  const errs = [];
  const type = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v);
  const t = type(value);
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: must be one of ${schema.enum.join(', ')}`);
  if (schema.type) {
    const ok = schema.type === t || (schema.type === 'number' && t === 'integer');
    if (!ok) return [`${path}: expected ${schema.type}`];
  }
  if (typeof value === 'string') {
    if (schema.minLength && value.length < schema.minLength) errs.push(`${path}: too short`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: wrong format`);
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) errs.push(`${path}: below ${schema.minimum}`);
  if (Array.isArray(value)) {
    if (schema.minItems && value.length < schema.minItems) errs.push(`${path}: needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems && value.length > schema.maxItems) errs.push(`${path}: at most ${schema.maxItems} item(s)`);
    if (schema.items) value.forEach((v, i) => errs.push(...validateAgainst(schema.items, v, `${path}[${i}]`)));
  }
  if (t === 'object') {
    for (const k of schema.required ?? []) if (!(k in value)) errs.push(`${path}.${k}: required`);
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k];
      if (sub) errs.push(...validateAgainst(sub, v, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}.${k}: unknown key`);
      else if (typeof schema.additionalProperties === 'object') errs.push(...validateAgainst(schema.additionalProperties, v, `${path}.${k}`));
    }
  }
  return errs;
}

const bullets = (items) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- none stated');
const fill = (template, values) => template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in values ? values[k] : m));
const MD_BLOCK = /<!-- student-pack:start -->[\s\S]*?<!-- student-pack:end -->/;

// Writes the pack block in place of an existing one, or appends one after user content; text outside the markers is never changed.
export function upsertMarkdownBlock(text, body) {
  const block = `<!-- student-pack:start -->\n${body.trim()}\n<!-- student-pack:end -->`;
  if (MD_BLOCK.test(text)) return text.replace(MD_BLOCK, () => block);
  const lead = text && !text.endsWith('\n') ? '\n' : '';
  return `${text}${lead}${text ? '\n' : ''}${block}\n`;
}

// Fills the markers of a template and returns just the pack-marked part plus the cycle spans after it.
function renderCustom(template, values) {
  return fill(template, values);
}

function yamlBlockRe(name) {
  return new RegExp(`^([ \\t]*)# student-pack:start ${name}\\n[\\s\\S]*?^[ \\t]*# student-pack:end ${name}[ \\t]*$`, 'm');
}

// Inserts or replaces a marked block in portals.yml without touching anything else. A top-level key the user
// already owns (no markers) is left alone and reported, because a second copy of the key is invalid YAML.
export function upsertPortalsBlock(text, name, key, lines) {
  const wrap = (ind, body) => `${ind}# student-pack:start ${name}\n${body}\n${ind}# student-pack:end ${name}`;
  const re = yamlBlockRe(name);
  const hit = re.exec(text);
  if (hit) {
    const ownsKey = new RegExp(`^${key}:`, 'm').test(hit[0]);
    const body = key === 'tracked_companies' && !ownsKey ? lines : [`${key}:`, ...lines];
    return { text: text.replace(re, (m, ind) => wrap(ind, body.join('\n'))), kept: false };
  }
  const keyRe = new RegExp(`^${key}:[ \\t]*(#[^\\n]*)?$`, 'm');
  if (key === 'tracked_companies') {
    const m = keyRe.exec(text);
    if (m) {
      const at = m.index + m[0].length;
      return { text: `${text.slice(0, at)}\n${wrap('  ', lines.join('\n'))}${text.slice(at)}`, kept: false };
    }
    // A second tracked_companies key is invalid YAML. upstream's example file and the first-run copy can carry the
    // empty flow form, which holds nothing to lose; any other flow-style value holds the student's entries.
    const empty = /^tracked_companies:[ \t]*\[[ \t]*\](?:[ \t]*(#[^\n]*))?$/m.exec(text);
    if (empty) {
      const head = `${text.slice(0, empty.index)}tracked_companies:${empty[1] ? ` ${empty[1]}` : ''}`;
      return { text: `${head}\n${wrap('  ', lines.join('\n'))}${text.slice(empty.index + empty[0].length)}`, kept: false };
    }
    if (/^tracked_companies:/m.test(text)) return { text, kept: true };
    return { text: `${text}${text && !text.endsWith('\n') ? '\n' : ''}${key}:\n${wrap('  ', lines.join('\n'))}\n`, kept: false };
  }
  if (new RegExp(`^${key}:`, 'm').test(text)) return { text, kept: true };
  return { text: `${text}${text && !text.endsWith('\n') ? '\n' : ''}${wrap('', `${key}:\n${lines.join('\n')}`)}\n`, kept: false };
}

const q = (s) => JSON.stringify(s);
const STOP_WORDS = new Set(['a', 'an', 'and', 'or', 'of', 'the', 'for', 'in', 'to', 'at']);
const NOTE_LIST_MAX = 10;
// Note lists name at most NOTE_LIST_MAX items so a long preset list stays readable in the interview output.
const listFor = (items) => `${items.slice(0, NOTE_LIST_MAX).join(', ')}${items.length > NOTE_LIST_MAX ? ` (+${items.length - NOTE_LIST_MAX} more)` : ''}`;

// A role name becomes upstream ' + ' entries: every significant word must appear in a title, in any order. An
// abbreviation (RN) is kept in one entry and spelled out in another, because a real title may use either; a spelled-out
// phrase stays together so a title naming it matches as written.
function archetypeEntries(name, abbreviations) {
  const words = name.toLowerCase().split(/[^a-z0-9+#]+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  const phrases = Object.entries(abbreviations).map(([abbr, full]) => ({ abbr, full, parts: full.split(' ') })).sort((x, y) => y.parts.length - x.parts.length);
  const units = [];
  for (let i = 0; i < words.length; ) {
    const hit = phrases.find((p) => p.parts.every((part, k) => words[i + k] === part));
    if (hit) {
      units.push(hit);
      i += hit.parts.length;
    } else {
      const full = abbreviations[words[i]];
      units.push({ abbr: words[i], full: full ?? words[i] });
      i += 1;
    }
  }
  if (!units.length) return [];
  const dedupe = (list) => [...new Set(list)];
  return dedupe([dedupe(units.map((u) => u.abbr)).join(' + '), dedupe(units.map((u) => u.full)).join(' + ')]);
}

// upstream's location filter is a plain substring match, and boards write a city as "Boston-MA", "Boston, MA" or "Boston,
// Massachusetts". A "City, ST" answer therefore also allows the bare city so no board spelling hides its postings.
export function locationTerms(locations) {
  const terms = locations.flatMap((l) => {
    const city = l.includes(',') ? l.split(',')[0].trim() : '';
    return city.length > 2 ? [l, city] : [l];
  });
  return [...new Set(terms)];
}

function portalLines(answers, merged, cfg, abbreviations) {
  const rules = effectiveTitleRules(merged, cfg);
  const skipped = new Set();
  const expand = (patterns) => patterns.flatMap((p) => {
    const res = toUpstreamTerms(p);
    res.skipped.forEach((x) => skipped.add(x));
    return res.terms;
  });
  const positive = [...new Set([...expand(rules.include), ...answers.archetypes.flatMap((a) => archetypeEntries(a, abbreviations))])];
  const negative = [...new Set(expand(rules.exclude))];
  const seeds = [...(merged?.seed_employers ?? []), ...(answers.target_employers ?? [])];
  const unique = [...new Map(seeds.map((e) => [e.name.toLowerCase(), e])).values()];
  return {
    positive,
    negative,
    rules,
    title: ['  positive:', ...positive.map((p) => `    - ${q(p)}`), '  negative:', ...negative.map((p) => `    - ${q(p)}`)],
    location: ['  allow:', ...locationTerms(answers.locations).map((l) => `    - ${q(l)}`)],
    companies: unique.flatMap((e) => [`  - name: ${q(e.name)}`, `    careers_url: ${e.careers_url}`, '    enabled: true']),
    notes: [...skipped].map((r) => `title rule ${r} cannot be written as an upstream title term, so it was skipped`),
  };
}

// Removes a top-level key and its indented body. Comment and blank lines that sit just above the next key are left
// in place because they usually introduce that key.
function dropTopLevelKey(text, key) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (start === -1) return text;
  let next = lines.findIndex((l, i) => i > start && /^[A-Za-z_][\w-]*:/.test(l));
  if (next === -1) next = lines.length;
  let end = next;
  while (end > start + 1 && (lines[end - 1].trim() === '' || lines[end - 1].startsWith('#'))) end--;
  return [...lines.slice(0, start), ...lines.slice(end)].join('\n');
}

// upstream's first run copies templates/portals.example.yml into portals.yml. A block that still parses equal to the
// template's holds nothing the student wrote, so the pack takes it over; an edited block is the student's and stays.
function ownsTemplateBlock(portals, key, templateText) {
  if (!templateText || !new RegExp(`^${key}:`, 'm').test(portals) || yamlBlockRe(key).test(portals)) return false;
  const theirs = yaml.load(portals)?.[key];
  return theirs !== undefined && isDeepStrictEqual(theirs, yaml.load(templateText)?.[key]);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function buildConfig(answers) {
  const { values: limits } = effectiveLimits({ limits: answers.limits ?? {} });
  // A limit looser than its ceiling is written as the ceiling, so the file never claims more than budget.mjs allows.
  const written = Object.fromEntries(Object.keys(answers.limits ?? {}).filter((k) => k in CEILINGS).map((k) => [k, limits[k]]));
  const floor = Math.max(answers.score_floor ?? CEILINGS.score_floor.value, CEILINGS.score_floor.value);
  const cfg = deepMerge(
    {},
    {
      onboarding: { complete: false },
      presets: answers.presets,
      tracks: answers.tracks,
      experience_years: answers.experience_years ?? 0,
      us_citizen: answers.us_citizen ?? false,
      timezone: answers.timezone,
      locations: answers.locations,
      switches: answers.switches ?? {},
      automation: answers.automation ?? 'manual',
      agent: answers.agent ?? 'claude',
      spend_tier: answers.spend_tier ?? 'standard',
      daily_target: answers.daily_target ?? 10,
      score_floor: floor,
      linkedin_tier: answers.linkedin_tier ?? 'free',
      limits: written,
      resume_variants: answers.resume_variants,
      mailbox: { backend: answers.mailbox_backend ?? 'connector' },
      schedule: { time: answers.schedule_time },
      // Knob defaults are no-ops; written out so a student can find each key in a fresh student.yml.
      rank: {
        weights: {},
        metros: answers.locations,
        marquee: answers.priority_companies ?? [],
        parent_companies: {},
        company_caps: {},
        intern_only: [],
        one_track_per_company: false,
        ignore_words: [],
        easy_apply_hosts: ['greenhouse', 'ashby', 'lever'],
        contacts_format: 'stage',
        metro_match: 'word',
        hold_on_pending_connect: true,
      },
      dealbreakers: answers.dealbreakers ?? [],
      judgment_keywords: [],
      audit: { exclude_reasons: [], require_triage: false, keyword_match: 'word', duplicate_reason: 'first' },
    },
  );
  validateConfig(cfg);
  return cfg;
}

function blacklistRows(existing, entries, today) {
  const header = '| Company | Reason | Added |\n|---|---|---|\n';
  const have = new Set(existing.split('\n').map((l) => l.split('|')[1]?.trim().toLowerCase()).filter(Boolean));
  const rows = entries.filter(([n]) => !have.has(n.toLowerCase())).map(([n, why]) => `| ${n.replace(/\|/g, '/')} | ${why} | ${today} |`);
  if (!rows.length) return existing;
  const base = existing || header;
  return `${base}${base.endsWith('\n') ? '' : '\n'}${rows.join('\n')}\n`;
}

const asYaml = (c) => yaml.dump(c, { lineWidth: -1, quotingType: '"', noRefs: true });

// Resume text from the answers: pasted text wins, else the file named by cv_path, resolved against the career-ops
// folder because that is where a student's relative path starts.
function resolveCvText(answers, root) {
  if (answers.cv_markdown !== undefined) return answers.cv_markdown;
  if (!answers.cv_path) return '';
  try {
    return readFileSync(resolve(root, answers.cv_path), 'utf8');
  } catch (err) {
    throw new AnswersError([`cv_path ${answers.cv_path} cannot be read (${err.code ?? err.message}); give a file path inside the career-ops folder or paste the resume`]);
  }
}

// Whitespace-only text counts as missing, so a blank resume cannot mark onboarding complete.
const nonEmptyFile = (file) => existsSync(file) && readFileSync(file, 'utf8').trim() !== '';

// config/student.yml is rewritten on every run. config/profile.yml is a keep file: when it exists the application
// answers are not written and one note per unwritten answer tells the student.
function writeConfigAndProfile({ answers, cvText, cfg, paths, out }) {
  out('config/student.yml', asYaml(cfg));
  if (cvText.trim() && !nonEmptyFile(join(paths.root, 'cv.md'))) out('cv.md', cvText);
  const id = answers.identity;
  const profileExists = existsSync(join(paths.root, 'config', 'profile.yml'));
  const apply = answers.application_profile;
  out(
    'config/profile.yml',
    yaml.dump({
      candidate: { full_name: id.name, email: id.email, phone: id.phone ?? '', location: id.location ?? answers.locations[0], linkedin: id.linkedin ?? '', github: id.github ?? '' },
      target_roles: { primary: answers.archetypes, archetypes: answers.archetypes.map((a, i) => ({ name: a, level: 'Entry', fit: i === 0 ? 'primary' : 'secondary' })) },
      application_answers: {
        work_authorization: answers.work_authorization,
        requires_sponsorship: answers.needs_sponsorship ?? false,
        start_date: apply.start_date,
        relocation: apply.relocation,
        eeo: apply.eeo,
        how_did_you_hear: apply.how_did_you_hear,
      },
    }),
    { keep: true },
  );
  // profile.yml is a keep file the student may have edited, so a rerun reports the answers and does not merge them.
  return profileExists ? Object.keys(apply).map((k) => `config/profile.yml already exists and was kept, so application_answers.${k} (${apply[k]}) was not written`) : [];
}

// portals.yml: marked blocks inside whatever the student already has.
function writePortals({ answers, merged, cfg, abbreviations, paths, out, read }) {
  const lines = portalLines(answers, merged, cfg, abbreviations);
  const templateFile = join(paths.root, 'templates', 'portals.example.yml');
  const templateText = existsSync(templateFile) ? readFileSync(templateFile, 'utf8') : '';
  let portals = read('portals.yml');
  const notes = [...lines.notes];
  const unapplied = {
    title_filter: () => `preset title rules not applied: include ${lines.rules.include.join(', ')}; exclude ${lines.rules.exclude.join(', ')}`,
    location_filter: () => `locations not applied: ${listFor(answers.locations)}`,
  };
  for (const [name, key, body] of [['title_filter', 'title_filter', lines.title], ['location_filter', 'location_filter', lines.location], ['tracked_companies', 'tracked_companies', lines.companies]]) {
    if (key !== 'tracked_companies' && ownsTemplateBlock(portals, key, templateText)) portals = dropTopLevelKey(portals, key);
    const res = upsertPortalsBlock(portals, name, key, body);
    portals = res.text;
    if (!res.kept) continue;
    if (key === 'tracked_companies') notes.push('tracked_companies in portals.yml is a flow-style list, so the company block was not written; add the employers by hand or rewrite the list in block form');
    else notes.push(`warning: kept your existing ${key} in portals.yml because it differs from upstream's template; ${unapplied[key]()}`);
  }
  yaml.load(portals);
  out('portals.yml', portals);
  return notes;
}

function writeModes({ answers, merged, packRoot, cfg, out, read }) {
  const id = answers.identity;
  const archetypeText = bullets(answers.archetypes);
  const auth = { status: answers.work_authorization, requires_sponsorship: answers.needs_sponsorship ?? false };
  out('modes/_profile.md', upsertMarkdownBlock(read('modes/_profile.md'), `## Target roles and proof\n\n${archetypeText}\n\n## Work authorization\n\n${auth.status}. Sponsorship needed: ${auth.requires_sponsorship ? 'yes' : 'no'}.\n\n## Hard no\n\n${bullets(answers.dealbreakers ?? [])}`));
  out(
    'modes/_brief.md',
    upsertMarkdownBlock(
      read('modes/_brief.md'),
      `## Identity\n\n${id.name}, ${id.location ?? answers.locations[0]}. ${auth.status}. Sponsorship needed: ${auth.requires_sponsorship ? 'yes' : 'no'}.\n\n## Target archetypes\n\n${archetypeText}\n\n## Hard no\n\n${bullets(answers.dealbreakers ?? [])}\n\n## Priority companies\n\n${bullets(answers.priority_companies ?? [])}`,
    ),
  );
  const template = readFileSync(join(packRoot, 'templates', '_custom.template.md'), 'utf8');
  const tier = cfg.spend_tier === 'premium' ? 'Use the premium model tier for triage and evaluation.' : 'Use the standard model tier for triage and evaluation. Never use an economy tier.';
  const customFilled = renderCustom(template, {
    MODEL_TIER: tier,
    ARCHETYPES: bullets(answers.archetypes),
    DEALBREAKERS: bullets(answers.dealbreakers ?? []),
    COMPANY_RULES: bullets((merged?.employer_policies ?? []).map((p) => `${p.company}: at most ${p.max} per ${p.period_days} days (${p.source_url})`)),
  });
  const existingCustom = read('modes/_custom.md');
  out('modes/_custom.md', existingCustom ? upsertMarkdownBlock(existingCustom, /<!-- student-pack:start -->([\s\S]*?)<!-- student-pack:end -->/.exec(customFilled)[1]) : customFilled);
}

// Registry of GitHub lists: trial status, so the monthly discovery rules decide which stay.
function writeSources({ answers, merged, cfg, paths, today, out, read }) {
  const chosen = new Set(answers.sources_chosen ?? []);
  const registryFile = join(paths.dataDir, 'student-github-sources.json');
  const prior = existsSync(registryFile) ? readJson(registryFile) : { version: 1, sources: [] };
  const have = new Set(prior.sources.map((s) => `${s.repo}/${s.path}`));
  const fresh = (merged?.sources.github_lists ?? [])
    .filter((g) => !chosen.size || chosen.has('github-lists') || chosen.has(g.name))
    .filter((g) => !have.has(`${g.repo}/${g.path}`))
    .map((g) => ({ name: g.name, repo: g.repo, branch: 'HEAD', path: g.path, format: g.format, kind: g.kind, field_map: g.field_map ?? {}, status: 'trial', added: today, last_push: null, last_unique: null, failed_parses: 0, notes: 'preset' }));
  out('data/student-github-sources.json', `${JSON.stringify({ version: 1, rules: { ...effectiveTitleRules(merged, cfg), early_career: merged?.early_career ?? '' }, sources: [...prior.sources, ...fresh] }, null, 2)}\n`);
  // Only the do-not-apply names: upstream's scan and the ingest skip every company listed here, so a priority company must not be.
  const entries = (answers.blacklist ?? []).map((n) => [n, 'user blacklist']);
  if (entries.length) out('data/blacklist.md', blacklistRows(read('data/blacklist.md'), entries, today));
}

// A portals.yml the YAML parser rejects is reported before anything is written, so cv.md and student.yml are not left
// behind by a run that then stops on a raw parser stack.
function checkPortalsParses(file) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, 'utf8');
  if (!text.trim()) return;
  try {
    yaml.load(text);
  } catch (err) {
    throw new AnswersError([`portals.yml cannot be parsed (${err.reason ?? err.name}${err.mark ? ` at line ${err.mark.line + 1}` : ''}); fix it or move it aside, then apply again`]);
  }
}

export async function applyAnswers({ answers, root, packRoot, today, dryRun = false }) {
  packRoot ??= resolvePaths({ root }).packRoot;
  if (answers?.application_profile === undefined) {
    throw new AnswersError(['$.application_profile is missing: this answers file predates the application profile; re-run interview Phase 3 (resume variants and application profile) and apply again']);
  }
  const schema = readJson(join(packRoot, 'interview', 'answers.schema.json'));
  const problems = validateAgainst(schema, answers);
  if (problems.length) throw new AnswersError(problems);

  const paths = resolvePaths({ root });
  const cvText = resolveCvText(answers, paths.root);
  // Without resume facts every later evaluation has nothing to work from, so onboarding must not complete.
  if (!cvText.trim() && !nonEmptyFile(join(paths.root, 'cv.md'))) throw new AnswersError(['resume is empty: paste the resume or give the path of a resume file, then apply again']);
  checkPortalsParses(join(paths.root, 'portals.yml'));
  const merged = loadMerged(answers.presets);
  const written = [];
  const out = (rel, text, { keep = false } = {}) => {
    const file = join(paths.root, rel);
    if (keep && existsSync(file)) return;
    written.push(rel);
    if (!dryRun) writeAtomic(file, text);
  };
  const read = (rel) => (existsSync(join(paths.root, rel)) ? readFileSync(join(paths.root, rel), 'utf8') : '');

  const cfg = buildConfig(answers);
  const profileNotes = writeConfigAndProfile({ answers, cvText, cfg, paths, out });
  const abbreviations = readJson(join(packRoot, 'interview', 'field-keywords.json')).abbreviations ?? {};
  const notes = [...writePortals({ answers, merged, cfg, abbreviations, paths, out, read }), ...profileNotes];
  const employers = (answers.target_employers ?? []).length;
  if (employers < 10) notes.push(`target_employers has ${employers} entries; 10 to 20 give the daily scan more to read`);
  writeModes({ answers, merged, packRoot, cfg, out, read });
  writeSources({ answers, merged, cfg, paths, today, out, read });

  if (!dryRun) {
    runCycle({ paths, config: cfg, merged, today, dryRun: false });
    written.push('data/student-cycle.json');
    const done = { ...cfg, onboarding: { complete: true } };
    validateConfig(done);
    writeAtomic(join(paths.root, 'config', 'student.yml'), asYaml(done));
  }
  return { written, notes, clamped: effectiveLimits({ limits: answers.limits ?? {} }).clamps.map((c) => c.key) };
}

async function main() {
  const { command, positionals: rest, flags } = parseArgs(process.argv.slice(2), { flags: {} });
  const positionals = command ? [command, ...rest] : [];
  if (positionals.length > 1) throw new UsageError('usage: apply-answers.mjs [<answers.json>] [--root R] [--data-dir D] [--today YYYY-MM-DD] [--dry-run]');
  const paths = resolvePaths({ root: flags.root, dataDir: flags.dataDir });
  const answersFile = positionals[0] ?? join(paths.dataDir, 'interview-answers.json');
  let answers;
  try {
    answers = JSON.parse(readFileSync(answersFile, 'utf8'));
  } catch (err) {
    throw new UsageError(`cannot read ${answersFile}: ${err.message}`);
  }
  const today = createClock({ today: flags.today, timezone: answers.timezone }).today();
  try {
    const res = await applyAnswers({ answers, root: paths.root, packRoot: paths.packRoot, today, dryRun: flags.dryRun });
    console.log(`${flags.dryRun ? 'Would write' : 'Wrote'}:\n${res.written.map((f) => `  ${f}`).join('\n')}`);
    for (const n of res.notes) console.log(n);
    if (res.clamped.length) console.log(`Limits set to their ceilings: ${res.clamped.join(', ')}`);
    return 0;
  } catch (err) {
    if (err instanceof AnswersError) {
      console.error(err.message);
      return 1;
    }
    throw err;
  }
}

if (isMain(import.meta.url)) await runCli(main);
