// One-page batches the student approves in one reply: data/batches/<date>-<kind>-<n>.md holds one numbered line per item
// (company, role, fit score, one-line letter or message preview, link), at most approval_batch_max items per page, a
// "finish these yourself" section for jobs a CAPTCHA stopped, and the guided footer. A JSON twin beside it keeps the
// items for batch.mjs and chrome.mjs, so the page itself stays short.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { guidedFooter } from './next-step.mjs';
import { writeAtomic } from './tsv.mjs';

export const BATCH_DIR = 'batches';
export const PAGE_MAX = 10;
const PREVIEW_CHARS = 90;

const oneLine = (s, n) => {
  const flat = String(s ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n - 3)}...` : flat;
};

const VERB = { apply: 'approve', outreach: 'send', followup: 'send' };

// Markdown page for one batch: header, then one line per item.
export function renderBatch(batch) {
  const verb = VERB[batch.kind] ?? 'approve';
  const lines = [`# Batch ${batch.id} (${batch.kind})`, ''];
  batch.items.forEach((it, i) => {
    const fit = typeof it.score === 'number' ? `fit ${it.score.toFixed(1)}` : 'fit n/a';
    lines.push(`${i + 1}. ${it.company} | ${it.role} | ${fit} | "${oneLine(it.preview, PREVIEW_CHARS)}" | ${it.link}`);
  });
  if (!batch.items.length) lines.push('(no items)');
  if (batch.finishYourself?.length) {
    lines.push('', '## Finish these yourself', '');
    for (const f of batch.finishYourself) lines.push(`- ${f.company} | ${f.role} | ${f.link} (${f.reason ?? 'CAPTCHA'})`);
  }
  const next = { step: `${verb} this batch`, prompt: `${verb} all, or all except 3, 7`, why: 'nothing is submitted or sent until you approve it, and only the items you approve go out.' };
  lines.push('', ...guidedFooter(next), '');
  return lines.join('\n');
}

const jsonFile = (dataDir, id) => join(dataDir, BATCH_DIR, `${id}.json`);
const mdFile = (dataDir, id) => join(dataDir, BATCH_DIR, `${id}.md`);

function save(dataDir, batch) {
  writeAtomic(jsonFile(dataDir, batch.id), `${JSON.stringify(batch, null, 2)}\n`);
  writeAtomic(mdFile(dataDir, batch.id), renderBatch(batch));
}

// Batches stored under dataDir; empty when the directory does not exist.
export function listBatches(dataDir) {
  const dir = join(dataDir, BATCH_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort();
}

// Batch by id, or null when absent.
export function readBatch(dataDir, id) {
  const file = jsonFile(dataDir, id);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

// Splits items into pages of at most pageMax and writes each as its own batch; returns the batch ids.
export function writeBatches(dataDir, { date, kind, items, finishYourself = [], pageMax = PAGE_MAX }) {
  const taken = new Set(listBatches(dataDir));
  let n = 1;
  const nextId = () => {
    while (taken.has(`${date}-${kind}-${n}`)) n++;
    const id = `${date}-${kind}-${n}`;
    taken.add(id);
    return id;
  };
  const pages = [];
  for (let i = 0; i < Math.max(items.length, finishYourself.length ? 1 : 0); i += pageMax) pages.push(items.slice(i, i + pageMax));
  return pages.map((page, i) => {
    const batch = { id: nextId(), date, kind, items: page, finishYourself: i === 0 ? finishYourself : [], approved: null };
    save(dataDir, batch);
    return batch.id;
  });
}

// Applies change to the stored batch; throws when the batch does not exist.
export function updateBatch(dataDir, id, change) {
  const batch = readBatch(dataDir, id);
  if (!batch) throw new Error(`no batch ${id}`);
  const next = change(batch);
  save(dataDir, next);
  return next;
}

// A job stopped by a CAPTCHA or bot check joins the finish-yourself list with its link. Before approval it also leaves
// the numbered list; after approval the numbers stay as approved, because the logged approval names items by number.
export function addFinishYourself(dataDir, id, { company, role, link, reason = 'CAPTCHA' }) {
  return updateBatch(dataDir, id, (b) => ({
    ...b,
    items: b.approved ? b.items : b.items.filter((it) => it.link !== link),
    finishYourself: [...(b.finishYourself ?? []).filter((f) => f.link !== link), { company, role, link, reason }],
  }));
}
