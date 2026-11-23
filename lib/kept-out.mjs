// Ranked postings the autopilot keeps off the daily rank slots: a form given up after EMPTY_READ_TRIES empty reads (until
// a read saves its fields), a saved form read with no submit (noSubmitReason; until a read saves one), and a row fill-plan kept out for no job text (data/kept-out.json, until job text is saved or
// KEPT_OUT_DAYS pass, when it is tried again). Such a row would otherwise be kept out again every day while holding one
// of the submit_per_day slots; the digest names each one with the guided offer instead.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EMPTY_READS_FILE, EMPTY_READ_TRIES, FIELDS_DIR, formGaveUp, gaveUpCount, readFormDoc } from './ats-fields.mjs';
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

// A form read that recorded its form but saved no submit can never be submitted by script: these are its reasons.
export const UPLOAD_OUTSIDE = 'the resume upload sits outside the form; attach your resume and cover letter and submit it yourself';
export const NO_SAFE_SUBMIT = 'no safe submit button found in the form read';

// Why a saved read ({ form, submit, uploadOutside? }) or a plan ({ formSelector, submitSelector, uploadOutside? }) can
// never be submitted by script, or null. A read or plan with no recorded form is not judged here.
export function noSubmitReason(read) {
  if (!read || typeof read !== 'object' || Array.isArray(read)) return null;
  const plan = 'formSelector' in read;
  const form = plan ? read.formSelector : read.form;
  if (form === undefined || (plan ? read.submitSelector : read.submit)) return null;
  return read.uploadOutside === true ? UPLOAD_OUTSIDE : NO_SAFE_SUBMIT;
}

// The student-facing finish-yourself line of a posting that can never be submitted by script: the reason, then the
// guided next step, the reply and why.
export function finishGuide(company, url, reason) {
  const why = reason === UPLOAD_OUTSIDE
    ? 'a submit from here would send the application without your resume and cover letter'
    : 'nothing is clicked unless the form read found that form\'s own submit button';
  return `finish these yourself: ${company} (${url}): ${reason}. Next: open the link and finish the application there yourself. Type: ${KEPT_OUT_REPLY} (only if the page has changed; it reads the form again). Why: ${why}.`;
}

// Why the posting is kept off today's rank slots, or null.
export function keptOutReason(dataDir, url, today) {
  if (formGaveUp(join(dataDir, FIELDS_DIR), url)) return `no application form found in ${EMPTY_READ_TRIES} reads`;
  const read = readFormDoc(join(dataDir, FIELDS_DIR), url);
  const noSubmit = read.fields.length ? noSubmitReason(read) : null;
  if (noSubmit) return noSubmit;
  const entry = readAll(dataDir)[keyOf(url)];
  if (entry?.reason === NO_JOB_TEXT && !loadJd(dataDir, url).trim() && daysBetween(entry.date, today) < KEPT_OUT_DAYS) return NO_JOB_TEXT;
  return null;
}

// How many saved form reads can never be submitted by script (an unreadable file counts as none).
function noSubmitCount(dataDir) {
  const dir = join(dataDir, FIELDS_DIR);
  let names;
  try {
    names = readdirSync(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return 0;
    throw err;
  }
  return names.filter((n) => n.endsWith('.json') && n !== EMPTY_READS_FILE).filter((n) => {
    try {
      return Boolean(noSubmitReason(JSON.parse(readFileSync(join(dir, n), 'utf8'))));
    } catch (err) {
      if (err instanceof SyntaxError) return false;
      throw err;
    }
  }).length;
}

// At most how many ranked rows can be kept out, so the rank step asks rank-queue for that many more.
export const keptOutCount = (dataDir) => Object.keys(readAll(dataDir)).length + gaveUpCount(join(dataDir, FIELDS_DIR)) + noSubmitCount(dataDir);
