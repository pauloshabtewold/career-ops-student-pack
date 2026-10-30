// presets/<id>.yml: a field's employer lists, title rules and recruiting calendar.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { resolvePaths } from './paths.mjs';

export class PresetError extends Error {
  constructor(id, path, message) {
    super(`preset ${id} ${path}: ${message}`);
    this.name = 'PresetError';
  }
}

const COVERAGE = ['automated', 'semi-automated', 'discovery-only'];
const FORMATS = ['simplify-json', 'html-table', 'markdown-table', 'json-array', 'csv'];
const KINDS = ['internship', 'newgrad'];

export function validatePreset(p, expectedId = p?.id) {
  const fail = (path, m) => {
    throw new PresetError(expectedId ?? '?', path, m);
  };
  const need = (cond, path, m) => {
    if (!cond) fail(path, m);
  };
  const strs = (a, path) => need(Array.isArray(a) && a.every((s) => typeof s === 'string'), path, 'expected a list of strings');
  const regexes = (a, path) => {
    strs(a, path);
    for (const r of a) {
      try {
        new RegExp(r);
      } catch {
        fail(path, `invalid regex ${r}`);
      }
    }
  };
  need(p && typeof p === 'object', '(root)', 'expected a map');
  need(p.id === expectedId && /^[a-z0-9-]+$/.test(p.id), 'id', 'must match the file name');
  need(typeof p.name === 'string' && p.name, 'name', 'required');
  need(p.coverage && COVERAGE.includes(p.coverage.level) && typeof p.coverage.note === 'string', 'coverage', `level one of ${COVERAGE.join(', ')} and a note`);
  need(p.title_rules, 'title_rules', 'required');
  regexes(p.title_rules.include ?? [], 'title_rules.include');
  regexes(p.title_rules.exclude ?? [], 'title_rules.exclude');
  regexes(p.title_rules.exclude_unless_citizen ?? [], 'title_rules.exclude_unless_citizen');
  regexes([p.early_career], 'early_career');
  const cal = p.recruiting_calendar;
  need(cal && Number.isInteger(cal.rollover_month) && cal.rollover_month >= 1 && cal.rollover_month <= 12, 'recruiting_calendar.rollover_month', '1-12');
  need(Number.isInteger(cal.lead_months) && cal.lead_months >= 0, 'recruiting_calendar.lead_months', 'integer');
  need(Array.isArray(cal.terms) && cal.terms.every((t) => t.name && t.start_month >= 1 && t.start_month <= 12), 'recruiting_calendar.terms', '[{name, start_month}]');
  const src = p.sources ?? {};
  for (const [i, g] of (src.github_lists ?? []).entries()) {
    const at = `sources.github_lists[${i}]`;
    need(g.name && g.repo && g.path, at, 'name, repo and path required');
    need(FORMATS.includes(g.format), `${at}.format`, `one of ${FORMATS.join(', ')}`);
    need(KINDS.includes(g.kind), `${at}.kind`, `one of ${KINDS.join(', ')}`);
  }
  for (const [i, a] of (src.alerts ?? []).entries()) need(a.name && a.how, `sources.alerts[${i}]`, 'name and how required');
  strs(p.search_terms ?? [], 'search_terms');
  for (const [i, e] of (p.seed_employers ?? []).entries()) {
    // Exactly name and careers_url: upstream portals.yml needs nothing else.
    need(Object.keys(e).sort().join() === 'careers_url,name', `seed_employers[${i}]`, 'exactly name and careers_url');
    need(/^https?:\/\//.test(e.careers_url), `seed_employers[${i}].careers_url`, 'http(s) URL');
  }
  strs(p.assessment_domains ?? [], 'assessment_domains');
  strs(p.archetypes ?? [], 'archetypes');
  for (const [i, e] of (p.employer_policies ?? []).entries()) {
    need(e.company && e.max > 0 && e.period_days > 0 && /^https?:\/\//.test(e.source_url ?? ''), `employer_policies[${i}]`, `company, max, period_days and source_url required (company: ${e.company ?? 'missing'})`);
  }
  return p;
}

export function loadPreset(id, opts = {}) {
  const { packRoot } = resolvePaths(opts);
  const text = readFileSync(join(packRoot, 'presets', `${id}.yml`), 'utf8');
  return validatePreset(yaml.load(text), id);
}

const byKey = (items, keyFn) => [...new Map(items.map((x) => [keyFn(x), x])).values()];

// Calendar and archetypes come from the primary preset; everything else is the union.
export function mergePresets(primary, secondary = []) {
  const all = [primary, ...secondary];
  const cat = (f) => all.flatMap((p) => f(p) ?? []);
  return {
    id: primary.id,
    ids: all.map((p) => p.id),
    name: primary.name,
    coverage: primary.coverage,
    recruiting_calendar: primary.recruiting_calendar,
    archetypes: primary.archetypes ?? [],
    early_career: all.map((p) => p.early_career).join('|'),
    title_rules: {
      include: [...new Set(cat((p) => p.title_rules.include))],
      exclude: [...new Set(cat((p) => p.title_rules.exclude))],
      exclude_unless_citizen: [...new Set(cat((p) => p.title_rules.exclude_unless_citizen))],
    },
    sources: {
      github_lists: byKey(cat((p) => p.sources?.github_lists), (g) => `${g.repo}/${g.path}`),
      alerts: byKey(cat((p) => p.sources?.alerts), (a) => a.name),
    },
    search_terms: [...new Set(cat((p) => p.search_terms))],
    seed_employers: byKey(cat((p) => p.seed_employers), (e) => e.name.toLowerCase()),
    assessment_domains: [...new Set(cat((p) => p.assessment_domains))],
    employer_policies: byKey(cat((p) => p.employer_policies), (e) => e.company.toLowerCase()),
  };
}

// Primary preset first; returns null when the student has not chosen any yet.
export function loadMerged(ids, opts = {}) {
  const [primary, ...rest] = ids.map((id) => loadPreset(id, opts));
  return primary ? mergePresets(primary, rest) : null;
}

// Clearance and citizenship titles are only a dead end for students who are not US citizens, so those excludes join
// the plain ones unless the student says they are a citizen. Every title filter reads rules through this function.
export function effectiveTitleRules(merged, config) {
  const rules = merged?.title_rules ?? {};
  const citizen = config?.us_citizen === true;
  return { include: rules.include ?? [], exclude: [...(rules.exclude ?? []), ...(citizen ? [] : (rules.exclude_unless_citizen ?? []))] };
}

// Signals that a pattern needs more than literal text; toUpstreamTerms reports it as skipped, since writing it would produce a wrong term.
class Unconvertible extends Error {}

const MAX_VARIANTS = 64;

// Parses alternatives up to the closing parenthesis of a group (or the end of the text) and returns every literal
// string the pattern can match. Anything beyond literals, escapes of punctuation, groups, alternation and `?`
// is not expressible as an upstream title term.
function expandAlternatives(src, start, inGroup) {
  const done = [];
  let current = [''];
  let pos = start;
  while (pos < src.length) {
    const ch = src[pos];
    if (ch === ')') {
      if (!inGroup) throw new Unconvertible();
      break;
    }
    if (ch === '|') {
      done.push(...current);
      current = [''];
      pos++;
      continue;
    }
    let atoms;
    if (ch === '(') {
      const inner = expandAlternatives(src, pos + (src.startsWith('?:', pos + 1) ? 3 : 1), true);
      if (src[inner.pos] !== ')') throw new Unconvertible();
      atoms = inner.variants;
      pos = inner.pos + 1;
    } else if (ch === '\\') {
      const next = src[pos + 1];
      if (next === undefined || /[A-Za-z0-9]/.test(next)) throw new Unconvertible();
      atoms = [next];
      pos += 2;
    } else if ('[]{}*+?^$.'.includes(ch)) {
      throw new Unconvertible();
    } else {
      atoms = [ch];
      pos++;
    }
    if (src[pos] === '?') {
      atoms = ['', ...atoms];
      pos++;
    } else if (pos < src.length && '*+{'.includes(src[pos])) {
      throw new Unconvertible();
    }
    current = current.flatMap((c) => atoms.map((a) => c + a));
    if (current.length > MAX_VARIANTS) throw new Unconvertible();
  }
  done.push(...current);
  return { variants: done, pos };
}

// Upstream's title_filter matches substrings, not regexes, so a preset regex is rewritten as the literal terms it
// accepts (co-?op becomes co-op and coop). A pattern that needs more than literals comes back in skipped.
export function toUpstreamTerms(source) {
  const bare = source.replace(/^\\b/, '').replace(/\\b$/, '');
  try {
    const { variants } = expandAlternatives(bare, 0, false);
    return { terms: [...new Set(variants.map((t) => t.trim()).filter(Boolean))], skipped: [] };
  } catch (err) {
    if (!(err instanceof Unconvertible)) throw err;
    return { terms: [], skipped: [source] };
  }
}
