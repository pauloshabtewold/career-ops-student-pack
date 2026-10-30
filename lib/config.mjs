// config/student.yml loader: defaults deep-merged under the student's file, then validated.
// Unknown keys fail loudly because a typo in a limit or switch name must not silently do nothing.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { resolvePaths } from './paths.mjs';
import { PLAN_IDS } from './usage-cost.mjs';

export class ConfigError extends Error {
  constructor(path, message) {
    super(`config ${path}: ${message}`);
    this.name = 'ConfigError';
    this.path = path;
  }
}

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

const str = { t: 'string' };
const bool = { t: 'boolean' };
const int = (min = 0) => ({ t: 'int', min });
const num = { t: 'number' };
const positive = { t: 'positive' };
// A row budget: a whole number of 0 or more, or the string "all".
const count = { t: 'count' };
const enm = (...v) => ({ t: 'enum', v });
const list = (item) => ({ t: 'array', item });
const obj = (props) => ({ t: 'object', props });

const SCHEMA = obj({
  onboarding: obj({ complete: bool }),
  presets: list(str),
  tracks: list(obj({ kind: enm('internship', 'coop', 'newgrad'), graduation: { t: 'pattern', re: YM }, resume_variant: str })),
  experience_years: int(0),
  us_citizen: bool,
  timezone: { t: 'timezone' },
  locations: list(str),
  switches: obj({ outreach: enm('on', 'drafts', 'off'), handshake: enm('on', 'off'), submission: enm('user', 'agent') }),
  automation: enm('manual', 'scheduled-discovery', 'scheduled-discovery-plus-triage'),
  agent: enm('claude', 'codex'),
  spend_tier: enm('standard', 'premium'),
  daily_target: int(1),
  score_floor: num,
  linkedin_tier: enm('free', 'premium'),
  limits: { t: 'numberMap' },
  triage_budget: obj({ daily: count, first_run: count, measured_pct_per_100_rows: positive, measured_window: enm('5-hour', 'weekly') }),
  plan: enm(...PLAN_IDS),
  resume_variants: list(obj({ name: str, track: str, graduation: { t: 'pattern', re: YM }, page_limit: int(1) })),
  mailbox: obj({ backend: enm('connector', 'paste', 'gmail-plugin') }),
  schedule: obj({ time: { t: 'pattern', re: HM } }),
  rank: obj({
    weights: { t: 'numberMap' },
    metros: list(str),
    marquee: list(str),
    parent_companies: { t: 'any' },
    company_caps: { t: 'intMap', min: 0 },
    intern_only: list(str),
    one_track_per_company: bool,
    ignore_words: list({ t: 'pattern', re: /^[A-Za-z0-9]+$/ }),
    easy_apply_hosts: list({ t: 'pattern', re: /^[A-Za-z0-9.-]+$/ }),
    contacts_format: enm('stage', 'status-notes'),
    metro_match: enm('word', 'substring'),
    hold_on_pending_connect: bool,
  }),
  dealbreakers: list({ t: 'regex' }),
  judgment_keywords: list(str),
  audit: obj({ exclude_reasons: list({ t: 'regex' }), require_triage: bool, keyword_match: enm('word', 'substring'), duplicate_reason: enm('first', 'last') }),
});

function check(node, value, path) {
  const fail = (m) => {
    throw new ConfigError(path || '(root)', m);
  };
  switch (node.t) {
    case 'string':
      if (typeof value !== 'string') fail('expected a string');
      break;
    case 'boolean':
      if (typeof value !== 'boolean') fail('expected true or false');
      break;
    case 'int':
      if (!Number.isInteger(value) || value < node.min) fail(`expected an integer >= ${node.min}`);
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail('expected a number');
      break;
    case 'positive':
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail('expected a number above 0');
      break;
    case 'count':
      if (value !== 'all' && !(Number.isInteger(value) && value >= 0)) fail('expected a whole number of 0 or more, or "all"');
      break;
    case 'enum':
      if (!node.v.includes(value)) fail(`expected one of ${node.v.join(', ')}`);
      break;
    case 'pattern':
      if (typeof value !== 'string' || !node.re.test(value)) fail('value has the wrong format');
      break;
    case 'timezone':
      if (value !== '') {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: value });
        } catch {
          fail('expected an IANA time zone such as America/Chicago');
        }
      }
      break;
    case 'regex':
      try {
        new RegExp(value);
      } catch {
        fail('expected a valid regular expression');
      }
      break;
    case 'numberMap':
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected a map of numbers');
      for (const [k, v] of Object.entries(value)) check(num, v, `${path}.${k}`);
      break;
    // Keys are free-form (company names), so only the values are checked; min 0 lets a cap of 0 block a company outright.
    case 'intMap':
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected a map of whole numbers');
      for (const [k, v] of Object.entries(value)) check(int(node.min), v, `${path}.${k}`);
      break;
    case 'array':
      if (!Array.isArray(value)) fail('expected a list');
      value.forEach((v, i) => check(node.item, v, `${path}[${i}]`));
      break;
    case 'object':
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail('expected a map');
      for (const k of Object.keys(value)) {
        if (!node.props[k]) throw new ConfigError(path ? `${path}.${k}` : k, 'unknown key');
        check(node.props[k], value[k], path ? `${path}.${k}` : k);
      }
      break;
    default:
      break;
  }
}

export function validateConfig(cfg) {
  check(SCHEMA, cfg, '');
  return cfg;
}

export function deepMerge(base, over) {
  if (over === undefined) return base;
  const plain = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if (!plain(base) || !plain(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = deepMerge(base[k], v);
  return out;
}

export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

export function parseConfig(text, defaultsText) {
  // js-yaml 5 throws on an empty document, and an empty student.yml is a valid "all defaults" file.
  const read = (s) => (s.trim() ? yaml.load(s) ?? {} : {});
  const defaults = read(defaultsText);
  const given = read(text);
  const merged = deepMerge(defaults, given);
  validateConfig(merged);
  return deepFreeze(merged);
}

// Returns null when config/student.yml is missing: that is the interview trigger.
export async function loadStudentConfig(opts = {}) {
  const { packRoot, configDir } = resolvePaths(opts);
  const file = join(configDir, 'student.yml');
  if (!existsSync(file)) return null;
  const defaults = readFileSync(join(packRoot, 'templates', 'student.defaults.yml'), 'utf8');
  return parseConfig(readFileSync(file, 'utf8'), defaults);
}
