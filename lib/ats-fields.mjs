// Field maps for the four ATS hosts students meet most (Greenhouse, Lever, Ashby, Workday): each form field's label or
// name is matched to one canonical answer key, so a known field is filled by code with zero model calls. Matching is
// exact on the normalized label, never fuzzy, and each EEO key matches only its own question, because a wrong match on
// a voluntary disclosure question is worse than asking (a gender answer must never fill a transgender question).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSensitive, normalize } from './profile-answers.mjs';
import { writeAtomic } from './tsv.mjs';

export const ATS_HOSTS = Object.freeze({
  greenhouse: /(^|\.)greenhouse\.io$/,
  lever: /(^|\.)lever\.co$/,
  ashby: /(^|\.)ashbyhq\.com$/,
  workday: /\.myworkdayjobs\.com$/,
});

// Names the ATS from the host of url.
export function atsOf(url) {
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return Object.keys(ATS_HOSTS).find((k) => ATS_HOSTS[k].test(host)) ?? null;
}

// Normalized label -> canonical key, shared by all four hosts; host maps below add their own field names.
const COMMON = {
  'first name': 'candidate.first_name',
  'last name': 'candidate.last_name',
  'full name': 'candidate.full_name',
  name: 'candidate.full_name',
  email: 'candidate.email',
  'email address': 'candidate.email',
  phone: 'candidate.phone',
  'phone number': 'candidate.phone',
  'linkedin profile': 'candidate.linkedin',
  'linkedin url': 'candidate.linkedin',
  linkedin: 'candidate.linkedin',
  website: 'candidate.portfolio',
  'portfolio url': 'candidate.portfolio',
  location: 'candidate.location',
  'current location': 'candidate.location',
  'are you legally authorized to work in the united states': 'work_authorization',
  'are you authorized to work in the united states': 'work_authorization',
  'will you now or in the future require sponsorship for employment visa status': 'requires_sponsorship',
  'will you now or in the future require visa sponsorship': 'requires_sponsorship',
  'do you require sponsorship': 'requires_sponsorship',
  'when can you start': 'start_date',
  'earliest start date': 'start_date',
  'are you willing to relocate': 'relocation',
  'how did you hear about us': 'how_did_you_hear',
  'how did you hear about this job': 'how_did_you_hear',
  resume: 'upload.resume',
  'resume cv': 'upload.resume',
  'cover letter': 'upload.cover_letter',
};

const HOST_MAPS = {
  greenhouse: { first_name: 'candidate.first_name', last_name: 'candidate.last_name', email: 'candidate.email', phone: 'candidate.phone', resume: 'upload.resume', cover_letter: 'upload.cover_letter' },
  lever: { name: 'candidate.full_name', email: 'candidate.email', phone: 'candidate.phone', 'urls linkedin': 'candidate.linkedin', resume: 'upload.resume', comments: 'upload.cover_letter' },
  ashby: { _systemfield_name: 'candidate.full_name', _systemfield_email: 'candidate.email', _systemfield_phone: 'candidate.phone', _systemfield_resume: 'upload.resume' },
  workday: { 'legalnamesection firstname': 'candidate.first_name', 'legalnamesection lastname': 'candidate.last_name', email: 'candidate.email', 'phone number': 'candidate.phone' },
};

// Each EEO key has its own question patterns; transgender is checked before gender so "gender identity" questions
// about being transgender never reach the gender key.
const EEO_PATTERNS = [
  ['eeo.transgender', /\btransgender\b|\btrans experience\b/],
  ['eeo.sexual_orientation', /\bsexual orientation\b/],
  ['eeo.pronouns', /\bpronouns?\b/],
  ['eeo.hispanic_latino', /\bhispanic\b|\blatin[oax]\b/],
  ['eeo.race_ethnicity', /\brace\b|\bethnicity\b/],
  ['eeo.veteran', /\bveteran\b|\bprotected veteran\b/],
  ['eeo.disability', /\bdisabilit(y|ies)\b/],
  ['eeo.gender', /^(gender|what is your gender|gender identity)$/],
];

const REQUIRED = /\*\s*$|\(required\)/i;

export const LEARNED_FILE = 'ats-maps.json';

// Learned per-ATS form maps from dataDir; empty when none exist.
export function readLearned(dataDir) {
  const file = join(dataDir, LEARNED_FILE);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

// The key of a field the student fills themselves (password, SSN, card, bank): never filled, typed, asked or learned.
export const SENSITIVE_KEY = 'sensitive';

// field = { id, name, label, type, autocomplete?, required? }; returns { key, required, slot } where key is null for an
// unknown field and SENSITIVE_KEY for a sensitive one.
export function mapField(field, { ats, learned = null } = {}) {
  const label = normalize(field.label);
  const name = normalize(field.name);
  const required = Boolean(field.required) || REQUIRED.test(String(field.label ?? ''));
  if (isSensitive(field)) return { key: SENSITIVE_KEY, required, slot: null };
  const eeo = EEO_PATTERNS.find(([, re]) => re.test(label));
  if (eeo) return { key: eeo[0], required, slot: null };
  const key = HOST_MAPS[ats]?.[name] ?? HOST_MAPS[ats]?.[label] ?? COMMON[label] ?? learned?.[ats]?.[label] ?? null;
  const slot = key === 'upload.resume' ? 'resume' : key === 'upload.cover_letter' ? 'cover' : null;
  return { key, required, slot };
}

// Maps every field of a form. learned is read only when the learned-maps lever (T3) is on.
export function mapForm(fields, { url, dataDir, learnedOn = false } = {}) {
  const ats = atsOf(url);
  const learned = learnedOn && dataDir ? readLearned(dataDir) : null;
  const mapped = fields.map((f) => ({ ...f, ...mapField(f, { ats, learned }) }));
  return { ats, fields: mapped, hasCoverSlot: mapped.some((f) => f.slot === 'cover'), unknown: mapped.filter((f) => !f.key), sensitive: mapped.filter((f) => f.key === SENSITIVE_KEY) };
}

// Stores a label answered in this session as a learned entry for its ATS (T3 on only); EEO and sensitive labels are
// never stored.
export function learnField(dataDir, { ats, label, key, learnedOn }) {
  if (!learnedOn || !ats || !key || key.startsWith('eeo.') || key === SENSITIVE_KEY || isSensitive(label)) return false;
  const all = readLearned(dataDir);
  all[ats] = { ...(all[ats] ?? {}), [normalize(label)]: key };
  writeAtomic(join(dataDir, LEARNED_FILE), `${JSON.stringify(all, null, 2)}\n`);
  return true;
}
