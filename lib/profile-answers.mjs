// The saved application answers in config/profile.yml (the application_answers block): the keys forms ask for again and
// again, how a single key is checked and set, and a merge that rewrites only that block so everything else the student
// keeps in the file stays byte for byte. Node built-ins plus js-yaml.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { resolvePaths } from './paths.mjs';

export const EEO_KEYS = Object.freeze(['gender', 'race_ethnicity', 'hispanic_latino', 'veteran', 'disability', 'pronouns']);
export const CANONICAL_KEYS = Object.freeze(['work_authorization', 'requires_sponsorship', 'start_date', 'relocation', 'how_did_you_hear', ...EEO_KEYS.map((k) => `eeo.${k}`)]);

export class ProfileParseError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'ProfileParseError';
  }
}

export class ProfileAnswerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProfileAnswerError';
  }
}

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const BLOCK_START = /^application_answers:/;

// application_answers parsed from the file text. A parse error, or two application_answers keys, is a ProfileParseError:
// the merge must not guess which copy the student meant.
function parseAnswers(text) {
  let doc;
  try {
    doc = yaml.load(text);
  } catch (err) {
    // js-yaml's message echoes a snippet of the file, which can hold EEO values; keep only the line number.
    throw new ProfileParseError(Number.isInteger(err?.mark?.line) ? `YAML syntax error at line ${err.mark.line + 1}` : 'YAML syntax error');
  }
  if (text.split('\n').filter((l) => BLOCK_START.test(l)).length > 1) throw new ProfileParseError('application_answers appears twice');
  const answers = isMap(doc) ? doc.application_answers : undefined;
  if (answers !== undefined && answers !== null && !isMap(answers)) throw new ProfileParseError('application_answers is not a map');
  return answers ?? {};
}

// The saved answers, or null when config/profile.yml does not exist.
export function readProfileAnswers(root) {
  const file = join(resolvePaths({ root }).configDir, 'profile.yml');
  return existsSync(file) ? parseAnswers(readFileSync(file, 'utf8')) : null;
}

// The patch's items replace the existing ones key by key; eeo is merged item by item. A legacy eeo string (leave-blank,
// ask-each-time) is replaced by a map only when the patch carries eeo items, so a patch without them keeps it.
function mergeMaps(existing, patch) {
  const merged = { ...existing, ...patch };
  if (isMap(patch.eeo)) merged.eeo = { ...(isMap(existing.eeo) ? existing.eeo : {}), ...patch.eeo };
  else if (patch.eeo === undefined && existing.eeo !== undefined) merged.eeo = existing.eeo;
  return merged;
}

// Line range of the top-level application_answers block. It starts at a column-0 'application_answers:' line (block or
// one-line flow style) and ends before the next column-0 line that is not blank, indented or part of the block; a
// column-0 comment ends it. Blank lines that only separate it from what follows stay outside.
function blockRange(lines) {
  const start = lines.findIndex((l) => BLOCK_START.test(l));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && /^(\s|$)/.test(lines[end])) end++;
  while (end > start + 1 && /^\r?$/.test(lines[end - 1])) end--;
  return { start, end };
}

// Returns the file text with only the application_answers block replaced by the merged map (appended when absent).
export function mergeProfileAnswers(text, patch) {
  const merged = mergeMaps(parseAnswers(text), patch);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const dumped = yaml.dump({ application_answers: merged }, { lineWidth: -1, quotingType: '"', noRefs: true }).trimEnd().split('\n');
  const lines = text.split('\n');
  const range = blockRange(lines);
  if (!range) return `${text}${text && !text.endsWith('\n') ? eol : ''}${dumped.join(eol)}${eol}`;
  const replaced = dumped.map((l) => (eol === '\r\n' ? `${l}\r` : l));
  return [...lines.slice(0, range.start), ...replaced, ...lines.slice(range.end)].join('\n');
}

export const valueAt = (answers, key) => (key.startsWith('eeo.') ? (isMap(answers.eeo) ? answers.eeo[key.slice(4)] : undefined) : answers[key]);
export const blank = (v) => v === undefined || v === null || v === '';

// Every canonical key with no usable saved answer. A legacy eeo string saves no item, so all six eeo keys are listed.
export function needsConfirmation(answers) {
  return CANONICAL_KEYS.filter((key) => blank(valueAt(answers ?? {}, key)));
}

// Checks one key and value from the command line and returns the value as it is stored, or throws a
// ProfileAnswerError that names the key.
export function validateAnswer(key, value) {
  const text = String(value ?? '').trim();
  if (!CANONICAL_KEYS.includes(key)) throw new ProfileAnswerError(`${key} is not a saved answer; use one of: ${CANONICAL_KEYS.join(', ')}`);
  if (!text) throw new ProfileAnswerError(`${key} needs a value`);
  if (key === 'start_date' && !/^(\d{4}-(0[1-9]|1[0-2])|immediately)$/.test(text)) throw new ProfileAnswerError('start_date must be YYYY-MM or immediately');
  if (key === 'relocation' && !['yes', 'no', 'within-locations'].includes(text)) throw new ProfileAnswerError('relocation must be yes, no or within-locations');
  if (key === 'requires_sponsorship') {
    if (!['yes', 'no'].includes(text)) throw new ProfileAnswerError('requires_sponsorship must be yes or no');
    return text === 'yes';
  }
  return text;
}

// The merge patch for one key: eeo.<item> becomes {eeo: {<item>: value}}.
export const patchFor = (key, value) => (key.startsWith('eeo.') ? { eeo: { [key.slice(4)]: value } } : { [key]: value });
