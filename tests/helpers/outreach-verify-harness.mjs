// SYNTHETIC FIXTURE: placeholder people, companies and cv text only.
// Shared harness for the outreach drafting tests of the fix 10 design (warm prose body + code frame + hard rails + a
// separate verifier call). One round runs the real outreachDrafts in a scratch root with an injected headless runner
// that answers drafting steps from `drafts` and the 'outreach-verify' step from `verdict`; every call is recorded with
// its step and prompt. No real model, network, Gmail or LinkedIn.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readBatch } from '../../lib/batch-file.mjs';
import { sendEmail } from '../../lib/gmail-chrome.mjs';
import { resolvePaths } from '../../lib/paths.mjs';
import { serializeTsv } from '../../lib/tsv.mjs';
import { outreachDrafts } from '../../scripts/outreach-drafts.mjs';
import { makeRoot } from './script-harness.mjs';

export const DAY = '2026-11-22';
export const ACME = 'Acme Example';
export const GLOBEX = 'Globex Example';
export const INITECH = 'Initech Example';
export const TITLE = 'Software Engineering Intern';
export const GLOBEX_APP = 'https://jobs.example.com/globex/swe-intern';

// The live-round student cv (synthetic).
export const CV = `# Sam Placeholder

Computer science student at Example State University, graduating May 2027. GPA 3.6.

## Experience
- Software engineering intern at Sample Labs (summer 2026): built a Python script that cut a weekly report from 2 hours to 10 minutes.
- Teaching assistant for Data Structures at Example State University (2025 to 2026).

## Projects
- Campus Bus Tracker: a small web app in JavaScript and Python that shows live bus times.

## Skills
Python, JavaScript, SQL, Git
`;
export const PROFILE = 'candidate:\n  full_name: "Sam Placeholder"\n  email: "sam@example.com"\n';

export const person = (name, company, action = 'warm-opener', extra = {}) => ({ action, channel: 'linkedin', contact: { name, company }, signature: 'Sam Placeholder', ...extra });
export const ALICE = person('Alice Alpha', ACME);
export const APP = { action: 'application-follow-up', channel: 'email', to: 'recruiter@example.com', contact: { name: 'Hiring team', company: GLOBEX }, application: { target: GLOBEX_APP, company: GLOBEX, submitted: '2026-11-14', title: TITLE }, signature: 'Sam Placeholder' };
export const SOURCES = `${CV}\nSam Placeholder\nsam@example.com`;

// One round. due: outreach-state due items; followups: application follow-ups; replies: incoming replies.
// drafts(opts, n) answers the n-th drafting call (0-based); verdict(prompt, n) answers the n-th verify call.
// send: also send item 1 (an email) through sendEmail and return the body the thread archive kept.
export async function round({ due = [], followups = [], replies = [], drafts, verdict = () => '{"unsupported": []}', cv = CV, send = false, extraFiles = {} }) {
  const r = makeRoot();
  r.write('cv.md', cv);
  r.write('config/profile.yml', PROFILE);
  r.write('data/contacts.tsv', serializeTsv(['date', 'company', 'name', 'stage', 'role'], []));
  r.write('data/pipeline.md', `# Pipeline\n\n## Processed\n\n- [x] ${GLOBEX_APP} | ${GLOBEX} | ${TITLE} | Remote\n`);
  for (const [file, text] of Object.entries(extraFiles)) r.write(file, text);
  const calls = [];
  let nDraft = 0;
  let nVerify = 0;
  const headless = async (opts) => {
    calls.push({ step: opts.step, feature: opts.feature, prompt: String(opts.prompt) });
    const text = opts.step === 'outreach-verify' ? verdict(String(opts.prompt), nVerify++) : typeof drafts === 'function' ? drafts(opts, nDraft++) : drafts[Math.min(nDraft++, drafts.length - 1)];
    return { text, model: 'sonnet', usage: null };
  };
  const said = [];
  try {
    const paths = resolvePaths({ root: r.root, dataDir: r.data });
    const res = await outreachDrafts({ paths, today: DAY, replies, deps: { headless, state: { due, followups }, t6On: false }, say: (s) => said.push(String(s)) });
    const items = res.ids.flatMap((id) => readBatch(r.data, id).items);
    let sentBody = null;
    if (send && items.length) {
      const passAll = () => ({ code: 0, stdout: 'ok', stderr: '' });
      const out = await sendEmail({ paths, port: 9, email: { batchId: res.ids[0], item: 1, target: GLOBEX_APP, company: GLOBEX, followup: { target: GLOBEX_APP, company: GLOBEX } }, date: DAY, runner: passAll, browser: async () => 'sent' });
      if (out.code !== 0) throw new Error(`send failed: ${JSON.stringify(out)}`);
      const dir = r.file('data/threads');
      const archived = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
      const mark = `Subject: ${items[0].subject}\n\n`;
      sentBody = archived.slice(archived.indexOf(mark) + mark.length).replace(/\n+$/, '');
    }
    const drafting = calls.filter((c) => c.step !== 'outreach-verify');
    const verifies = calls.filter((c) => c.step === 'outreach-verify');
    return { res, items, calls, drafting, verifies, said, sentBody };
  } finally {
    r.cleanup();
  }
}

const FOLLOWUP = { target: GLOBEX_APP, company: GLOBEX, submitted: '2026-11-14', email: 'recruiter@example.com' };
export const dueOf = (job) => ({ name: job.contact.name, company: job.contact.company, action: job.action });

// A round for one job: a contact draft (warm opener, connect, follow-up), a reply (job.replyText) or the Globex
// application follow-up.
export function roundFor(job, opts) {
  if (job.action === 'application-follow-up') return round({ followups: [FOLLOWUP], ...opts });
  if (job.action === 'reply') return round({ replies: [{ name: job.contact.name, company: job.contact.company, text: job.replyText, channel: job.channel }], ...opts });
  return round({ due: [dueOf(job)], ...opts });
}

// One fenced block of a prompt (<<<NAME-tag>>> ... <<<END-NAME-tag>>>), or null.
export const blockIn = (prompt, name) => new RegExp(`\\n<<<${name}-([0-9a-f]+)>>>\\n([\\s\\S]*?)\\n<<<END-${name}-\\1>>>(?:\\n|$)`).exec(prompt)?.[2] ?? null;
// The DRAFT block of a verify prompt.
export const draftIn = (prompt) => blockIn(prompt, 'DRAFT');

// The KNOWN TRUE block of a verify prompt (the facts code built from the student's records).
export const knownIn = (prompt) => blockIn(prompt, 'KNOWN');
