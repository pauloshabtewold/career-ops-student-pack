// data/student-cycle.json: computed by scripts/cycle.mjs, read by the ingest plugin,
// which runs as a hashed copy and so cannot import pack code.
import { existsSync, readFileSync } from 'node:fs';
import { isIsoDate } from './clock.mjs';
import { writeAtomic } from './tsv.mjs';

export class CycleFileError extends Error {}

// Shape only: a calendar check here would start rejecting cycle files that load today.
const isDate = isIsoDate;
const intList = (a) => Array.isArray(a) && a.every(Number.isInteger);

export function validateCycle(c) {
  const bad = (m) => {
    throw new CycleFileError(`student-cycle.json: ${m}`);
  };
  if (!c || typeof c !== 'object') bad('not an object');
  if (typeof c.computed_at !== 'string') bad('computed_at must be a string');
  if (!isDate(c.today)) bad('today must be YYYY-MM-DD');
  if (typeof c.phase !== 'string') bad('phase must be a string');
  if (!Array.isArray(c.terms) || !c.terms.every((t) => t && typeof t.name === 'string' && Number.isInteger(t.year) && isDate(t.start))) {
    bad('terms must be [{name, year, start}]');
  }
  if (!intList(c.newgrad_years)) bad('newgrad_years must be integers');
  if (!intList(c.internship_years)) bad('internship_years must be integers');
  if (!Number.isInteger(c.experience_ceiling_years)) bad('experience_ceiling_years must be an integer');
  return c;
}

export function readCycle(file) {
  if (!existsSync(file)) return null;
  return validateCycle(JSON.parse(readFileSync(file, 'utf8')));
}

export function writeCycle(file, cycle) {
  validateCycle(cycle);
  writeAtomic(file, `${JSON.stringify(cycle, null, 2)}\n`);
}
