// Ranked postings the autopilot keeps off the daily rank slots: a form given up after EMPTY_READ_TRIES empty reads (until
// a read saves its fields), and a row fill-plan kept out for no job text (data/kept-out.json, until job text is saved or
// KEPT_OUT_DAYS pass, when it is tried again). Such a row would otherwise be kept out again every day while holding one
// of the submit_per_day slots; the digest names each one with the guided offer instead.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMPTY_READ_TRIES, FIELDS_DIR, formGaveUp, gaveUpCount } from './ats-fields.mjs';
import { jdFileName, load as loadJd } from './jd-store.mjs';
import { writeAtomic } from './tsv.mjs';

export const KEPT_OUT_FILE = 'kept-out.json';
// The kept-out reason of a row with no job text from any source.
export const NO_JOB_TEXT = 'no job text';
export const KEPT_OUT_DAYS = 7;
export const KEPT_OUT_REPLY = 'read my kept-out postings';
export const KEPT_OUT_OFFER = `I'll read these postings in a session, approve? Type: ${KEPT_OUT_REPLY}`;

const keyOf = (url) => jdFileName(url).replace(/\.txt$/, '');
const DAY_MS = 24 * 60 * 60 * 1000;
export const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

function readAll(dataDir) {
  try {
    return JSON.parse(readFileSync(join(dataDir, KEPT_OUT_FILE), 'utf8')) ?? {};
  } catch {
    return {};
  }
}

// Records that fill-plan kept the posting out today for reason.
export function recordKeptOut(dataDir, { url, reason, date }) {
  const all = readAll(dataDir);
  all[keyOf(url)] = { url, reason, date };
  writeAtomic(join(dataDir, KEPT_OUT_FILE), `${JSON.stringify(all, null, 2)}\n`);
}

// Why the posting is kept off today's rank slots, or null.
export function keptOutReason(dataDir, url, today) {
  if (formGaveUp(join(dataDir, FIELDS_DIR), url)) return `no application form found in ${EMPTY_READ_TRIES} reads`;
  const entry = readAll(dataDir)[keyOf(url)];
  if (entry?.reason === NO_JOB_TEXT && !loadJd(dataDir, url).trim() && daysBetween(entry.date, today) < KEPT_OUT_DAYS) return NO_JOB_TEXT;
  return null;
}

// At most how many ranked rows can be kept out, so the rank step asks rank-queue for that many more.
export const keptOutCount = (dataDir) => Object.keys(readAll(dataDir)).length + gaveUpCount(join(dataDir, FIELDS_DIR));
