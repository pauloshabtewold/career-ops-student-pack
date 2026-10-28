#!/usr/bin/env node
// Deterministic half of the personalization interview: validates the answers file and writes everything the
// interview decides. The conversation (interview.md) is LLM-driven; this step is not, so five synthetic answer sets
// can be applied in CI without a model. Nothing is written when validation fails, and onboarding.complete flips to
// true only after every other file and the cycle computation succeeded.
// Usage: apply-answers.mjs <answers.json> [--root R] [--today YYYY-MM-DD] [--dry-run]
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import { UsageError, parseArgs, runCli } from '../lib/args.mjs';
import { createClock } from '../lib/clock.mjs';
import { deepMerge, validateConfig } from '../lib/config.mjs';
import { resolvePaths } from '../lib/paths.mjs';
import { loadMerged } from '../lib/presets.mjs';
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
  const keyRe = new RegExp(`^${key}:[ \\t]*$`, 'm');
  if (key === 'tracked_companies') {
    const m = keyRe.exec(text);
    if (m) {
      const at = m.index + m[0].length;
      return { text: `${text.slice(0, at)}\n${wrap('  ', lines.join('\n'))}${text.slice(at)}`, kept: false };
    }
    return { text: `${text}${text && !text.endsWith('\n') ? '\n' : ''}${key}:\n${wrap('  ', lines.join('\n'))}\n`, kept: false };
  }
  if (new RegExp(`^${key}:`, 'm').test(text)) return { text, kept: true };
  return { text: `${text}${text && !text.endsWith('\n') ? '\n' : ''}${wrap('', `${key}:\n${lines.join('\n')}`)}\n`, kept: false };
}

const q = (s) => JSON.stringify(s);
function portalLines(answers, merged) {
  const positive = [...new Set([...(merged?.title_rules.include ?? []), ...answers.archetypes])].filter((p) => !/[\\()|?*+[\]]/.test(p));
  const location = answers.locations;
  const seeds = [...(merged?.seed_employers ?? []), ...(answers.target_employers ?? [])];
  const unique = [...new Map(seeds.map((e) => [e.name.toLowerCase(), e])).values()];
  return {
    title: ['  positive:', ...positive.map((p) => `    - ${q(p)}`), '  negative:', ...(merged?.title_rules.exclude ?? []).filter((p) => !/[\\()|?*+[\]]/.test(p)).map((p) => `    - ${q(p)}`)],
    location: ['  allow:', ...location.map((l) => `    - ${q(l)}`)],
    companies: unique.flatMap((e) => [`  - name: ${q(e.name)}`, `    careers_url: ${e.careers_url}`, '    enabled: true']),
  };
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
      timezone: answers.timezone,
      locations: answers.locations,
      switches: answers.switches ?? {},
      automation: answers.automation ?? 'manual',
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
      },
      dealbreakers: answers.dealbreakers ?? [],
      judgment_keywords: [],
      audit: { exclude_reasons: [], require_triage: false, keyword_match: 'word' },
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

function writeConfigAndProfile({ answers, packRoot, cfg, out }) {
  out('config/student.yml', asYaml(cfg));
  const cvText = answers.cv_markdown ?? (answers.cv_path ? readFileSync(resolve(packRoot, answers.cv_path), 'utf8') : '');
  if (cvText) out('cv.md', cvText, { keep: true });
  const id = answers.identity;
  out(
    'config/profile.yml',
    yaml.dump({
      candidate: { full_name: id.name, email: id.email, phone: id.phone ?? '', location: id.location ?? answers.locations[0], linkedin: id.linkedin ?? '', github: id.github ?? '' },
      target_roles: { primary: answers.archetypes, archetypes: answers.archetypes.map((a, i) => ({ name: a, level: 'Entry', fit: i === 0 ? 'primary' : 'secondary' })) },
      application_answers: { work_authorization: answers.work_authorization, requires_sponsorship: answers.needs_sponsorship ?? false },
    }),
    { keep: true },
  );
}

// portals.yml: marked blocks inside whatever the student already has.
function writePortals({ answers, merged, out, read }) {
  const lines = portalLines(answers, merged);
  let portals = read('portals.yml');
  const notes = [];
  for (const [name, key, body] of [['title_filter', 'title_filter', lines.title], ['location_filter', 'location_filter', lines.location], ['tracked_companies', 'tracked_companies', lines.companies]]) {
    const res = upsertPortalsBlock(portals, name, key, body);
    portals = res.text;
    if (res.kept) notes.push(`kept your existing ${key} in portals.yml`);
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
function writeSources({ answers, merged, paths, today, out, read }) {
  const chosen = new Set(answers.sources_chosen ?? []);
  const registryFile = join(paths.dataDir, 'student-github-sources.json');
  const prior = existsSync(registryFile) ? readJson(registryFile) : { version: 1, sources: [] };
  const have = new Set(prior.sources.map((s) => `${s.repo}/${s.path}`));
  const fresh = (merged?.sources.github_lists ?? [])
    .filter((g) => !chosen.size || chosen.has('github-lists') || chosen.has(g.name))
    .filter((g) => !have.has(`${g.repo}/${g.path}`))
    .map((g) => ({ name: g.name, repo: g.repo, branch: 'HEAD', path: g.path, format: g.format, kind: g.kind, field_map: g.field_map ?? {}, status: 'trial', added: today, last_push: null, last_unique: null, failed_parses: 0, notes: 'preset' }));
  out('data/student-github-sources.json', `${JSON.stringify({ version: 1, rules: { ...merged?.title_rules, early_career: merged?.early_career ?? '' }, sources: [...prior.sources, ...fresh] }, null, 2)}\n`);
  const entries = [...(answers.blacklist ?? []).map((n) => [n, 'user blacklist']), ...(answers.priority_companies ?? []).map((n) => [n, 'priority company'])];
  if (entries.length) out('data/blacklist.md', blacklistRows(read('data/blacklist.md'), entries, today));
}

export function applyAnswers({ answers, root, packRoot, today, dryRun = false }) {
  packRoot ??= resolvePaths({ root }).packRoot;
  const schema = readJson(join(packRoot, 'interview', 'answers.schema.json'));
  const problems = validateAgainst(schema, answers);
  if (problems.length) throw new AnswersError(problems);

  const paths = resolvePaths({ root });
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
  writeConfigAndProfile({ answers, packRoot, cfg, out });
  const notes = writePortals({ answers, merged, out, read });
  writeModes({ answers, merged, packRoot, cfg, out, read });
  writeSources({ answers, merged, paths, today, out, read });

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
    const res = applyAnswers({ answers, root: paths.root, packRoot: paths.packRoot, today, dryRun: flags.dryRun });
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) await runCli(main);
